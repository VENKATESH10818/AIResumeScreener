"""
Matching & ranking API router.

Endpoints:
  POST /api/v1/match                → rank candidates against a job description
  GET  /api/v1/match/{job_id}       → retrieve stored match results for a job
  GET  /api/v1/match/{job_id}/top   → quick top-N candidates for a job
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AuditLog, Candidate, Job, Match, get_db
from app.services import embeddings as emb_svc
from app.services import indexer as idx_svc
from app.services import parser as parse_svc
from app.services import scoring as score_svc

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class MatchRequest(BaseModel):
    job_id: int
    candidate_ids: list[int] | None = Field(
        default=None,
        description=(
            "Optional list of candidate IDs to score. "
            "If omitted, all indexed candidates are scored."
        ),
    )
    top_k: int = Field(default=10, ge=1, le=200)
    use_faiss_prefilter: bool = Field(
        default=True,
        description=(
            "When True, use FAISS to retrieve top_k * 3 candidates first "
            "for speed, then re-score with the full heuristic formula."
        ),
    )


class CandidateResult(BaseModel):
    rank: int
    candidate_id: int
    score: float
    name_redacted: str | None
    original_filename: str
    explanation: dict[str, Any]


class MatchResponse(BaseModel):
    job_id: int
    job_title: str
    total_scored: int
    results: list[CandidateResult]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


async def _audit(
    db: AsyncSession,
    event_type: str,
    target_id: str | None = None,
    details: dict | None = None,
) -> None:
    log = AuditLog(event_type=event_type, target_id=target_id, details=details or {})
    db.add(log)


async def _load_candidates(
    db: AsyncSession, candidate_ids: list[int]
) -> dict[int, Candidate]:
    """Batch-load candidates by ID, return {id: Candidate}."""
    result = await db.execute(
        select(Candidate).where(Candidate.id.in_(candidate_ids))
    )
    return {c.id: c for c in result.scalars().all()}


# ---------------------------------------------------------------------------
# Match endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/match",
    summary="Score and rank candidates against a job description",
    response_model=MatchResponse,
)
async def match_candidates(
    payload: MatchRequest,
    db: AsyncSession = Depends(get_db),
) -> MatchResponse:
    """
    Main matching endpoint.

    Strategy:
    1. Load the job description + its parsed skills / embedding.
    2. If use_faiss_prefilter=True, query the FAISS resume index for the
       top candidates by semantic similarity (fast ANN search).
    3. For each candidate, compute the full heuristic score with explanations.
    4. Rank and persist results to the matches table.
    5. Return the ranked list with score breakdowns.
    """

    # --- Load job ---
    job = await db.get(Job, payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {payload.job_id} not found.")

    # Parse JD to get structured fields for scoring
    jd_parsed = parse_svc.parse_job_description(job.jd_text)

    # Build JD embedding
    jd_emb_text = emb_svc.build_jd_text(jd_parsed, job.jd_text)
    jd_vector = emb_svc.embed_text(jd_emb_text)

    # --- Determine candidate pool ---
    if payload.candidate_ids:
        # Explicit list provided
        candidate_id_pool = payload.candidate_ids
    elif payload.use_faiss_prefilter:
        # Use FAISS to find semantically closest resumes
        resume_index = idx_svc.get_resume_index(dim=jd_vector.shape[0])
        faiss_results = resume_index.search(
            jd_vector, top_k=min(payload.top_k * 3, resume_index.count() or 1)
        )
        candidate_id_pool = [cid for cid, _ in faiss_results]
    else:
        # Score every candidate in the DB (small dataset only)
        result = await db.execute(select(Candidate.id))
        candidate_id_pool = [row[0] for row in result.fetchall()]

    if not candidate_id_pool:
        return MatchResponse(
            job_id=job.id,
            job_title=job.title,
            total_scored=0,
            results=[],
        )

    # --- Load candidate records ---
    candidates_map = await _load_candidates(db, candidate_id_pool)

    # --- Score each candidate ---
    scored: list[tuple[int, score_svc.ScoreExplanation]] = []

    for cid in candidate_id_pool:
        candidate = candidates_map.get(cid)
        if not candidate or not candidate.parsed_json:
            continue

        # Compute cosine similarity between candidate and JD embeddings
        try:
            resume_text = emb_svc.build_resume_text(candidate.parsed_json)
            cand_vector = emb_svc.embed_text(resume_text)
            cosine_sim = emb_svc.cosine_similarity(cand_vector, jd_vector)
        except Exception as exc:
            logger.warning("Embedding failed for candidate %d: %s", cid, exc)
            cosine_sim = 0.0

        explanation = score_svc.score_candidate(
            cosine_similarity=cosine_sim,
            candidate_parsed=candidate.parsed_json,
            jd_parsed=jd_parsed,
        )
        scored.append((cid, explanation))

    # --- Rank ---
    ranked = score_svc.rank_candidates(scored)
    top_ranked = ranked[: payload.top_k]

    # --- Persist match results ---
    for item in top_ranked:
        # Upsert: delete old match for same (job, candidate) pair, insert new
        existing = await db.execute(
            select(Match).where(
                Match.job_id == payload.job_id,
                Match.candidate_id == item["candidate_id"],
            )
        )
        old_match = existing.scalars().first()
        if old_match:
            await db.delete(old_match)

        match = Match(
            job_id=payload.job_id,
            candidate_id=item["candidate_id"],
            score=item["score"],
            rank=item["rank"],
            explanation_json=item["explanation"],
        )
        db.add(match)

    await _audit(
        db,
        "match_run",
        target_id=str(payload.job_id),
        details={"total_scored": len(scored), "top_k": payload.top_k},
    )

    # --- Build response ---
    results = []
    for item in top_ranked:
        c = candidates_map.get(item["candidate_id"])
        results.append(
            CandidateResult(
                rank=item["rank"],
                candidate_id=item["candidate_id"],
                score=item["score"],
                name_redacted=c.name_redacted if c else None,
                original_filename=c.original_filename if c else "unknown",
                explanation=item["explanation"],
            )
        )

    return MatchResponse(
        job_id=job.id,
        job_title=job.title,
        total_scored=len(scored),
        results=results,
    )


# ---------------------------------------------------------------------------
# Retrieve stored results
# ---------------------------------------------------------------------------


@router.get(
    "/match/{job_id}",
    summary="Get all stored match results for a job",
)
async def get_matches(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    result = await db.execute(
        select(Match)
        .where(Match.job_id == job_id)
        .order_by(Match.rank.asc())
        .limit(limit)
    )
    matches = result.scalars().all()

    # Batch load candidates
    cid_list = [m.candidate_id for m in matches]
    candidates_map = await _load_candidates(db, cid_list)

    items = []
    for m in matches:
        c = candidates_map.get(m.candidate_id)
        items.append(
            {
                "rank": m.rank,
                "candidate_id": m.candidate_id,
                "score": m.score,
                "name_redacted": c.name_redacted if c else None,
                "original_filename": c.original_filename if c else "unknown",
                "explanation": m.explanation_json,
                "matched_at": m.created_at.isoformat(),
            }
        )

    return {
        "job_id": job_id,
        "job_title": job.title,
        "total": len(items),
        "results": items,
    }


@router.get(
    "/match/{job_id}/top",
    summary="Quick top-N candidates for a job (FAISS semantic search only)",
)
async def get_top_candidates(
    job_id: int,
    top_k: int = Query(default=10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Fast semantic-only ranking using FAISS (no DB match persistence).
    Useful for real-time previews. Use POST /match for full scoring.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    jd_parsed = parse_svc.parse_job_description(job.jd_text)
    jd_emb_text = emb_svc.build_jd_text(jd_parsed, job.jd_text)
    jd_vector = emb_svc.embed_text(jd_emb_text)

    resume_index = idx_svc.get_resume_index(dim=jd_vector.shape[0])
    if resume_index.count() == 0:
        return {"job_id": job_id, "job_title": job.title, "results": []}

    faiss_results = resume_index.search(jd_vector, top_k=top_k)
    cids = [cid for cid, _ in faiss_results]
    candidates_map = await _load_candidates(db, cids)

    items = []
    for rank, (cid, sim) in enumerate(faiss_results, start=1):
        c = candidates_map.get(cid)
        items.append(
            {
                "rank": rank,
                "candidate_id": cid,
                "semantic_similarity": round(sim, 4),
                "name_redacted": c.name_redacted if c else None,
                "original_filename": c.original_filename if c else "unknown",
            }
        )

    return {"job_id": job_id, "job_title": job.title, "results": items}
