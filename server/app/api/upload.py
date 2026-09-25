"""
Upload & resume management API router.

Endpoints:
  POST /api/v1/resumes/upload        → upload a resume file
  GET  /api/v1/resumes/              → list all candidates
  GET  /api/v1/resumes/{id}          → get one candidate + parsed fields
  DELETE /api/v1/resumes/{id}        → delete candidate (right-to-erasure)

  POST /api/v1/jobs/                 → create a job description
  GET  /api/v1/jobs/                 → list all jobs
  GET  /api/v1/jobs/{id}             → get one job

  POST /api/v1/reviewer/feedback     → submit human reviewer feedback
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AuditLog, Candidate, Feedback, Job, Match, get_db
from app.services import embeddings as emb_svc
from app.services import indexer as idx_svc
from app.services import parser as parse_svc

logger = logging.getLogger(__name__)

router = APIRouter()

STORAGE_PATH = os.getenv("STORAGE_PATH", "./storage/resumes")
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp"}
MAX_FILE_SIZE_MB = 10


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class CandidateSummary(BaseModel):
    id: int
    name_redacted: str | None
    original_filename: str
    file_type: str
    created_at: str
    skills: list[str] = []
    years_experience: float = 0.0

    class Config:
        from_attributes = True


class CandidateDetail(CandidateSummary):
    parsed_json: dict[str, Any] | None
    faiss_index_id: int | None


class JobCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=256)
    jd_text: str = Field(..., min_length=10)
    created_by: str | None = None


class JobSummary(BaseModel):
    id: int
    title: str
    created_by: str | None
    created_at: str

    class Config:
        from_attributes = True


class JobDetail(JobSummary):
    jd_text: str
    required_skills_json: list[str] | None
    desired_skills_json: list[str] | None


class FeedbackCreate(BaseModel):
    resume_id: int
    job_id: int
    label: str = Field(..., pattern="^(accept|reject|maybe)$")
    comment: str | None = None
    reviewer_id: str | None = None


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


def _safe_filename(filename: str) -> str:
    """Sanitise filename to prevent path traversal."""
    return Path(filename).name


# ---------------------------------------------------------------------------
# Resume endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/resumes/upload",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a resume (PDF / DOCX / image)",
)
async def upload_resume(
    file: UploadFile = File(...),
    job_id: int | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Upload a resume file. The system will:
    1. Validate the file type and size.
    2. Save the raw file to disk.
    3. Extract text and structured fields (NER).
    4. Generate an embedding and add it to the FAISS index.
    5. Persist everything to the database.

    Returns the new candidate ID and parse status.
    """
    # --- Validation ---
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{suffix}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    file_bytes = await file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {MAX_FILE_SIZE_MB} MB limit ({size_mb:.1f} MB).",
        )

    safe_name = _safe_filename(file.filename or "resume")

    # --- Parse ---
    try:
        parsed_result = parse_svc.parse_resume(file_bytes, safe_name)
    except Exception as exc:
        logger.error("Parsing failed for %s: %s", safe_name, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse resume: {exc}",
        )

    parsed = parsed_result.parsed

    # --- Save raw file ---
    storage_dir = Path(STORAGE_PATH)
    storage_dir.mkdir(parents=True, exist_ok=True)

    # Persist to DB first to get the ID, then rename file with ID prefix
    candidate = Candidate(
        name_redacted=parsed.get("name_redacted"),
        email_hash=parsed.get("email_hash"),
        resume_file_path="",  # filled in after we have the DB id
        original_filename=safe_name,
        file_type=parsed.get("file_type", "unknown"),
        parsed_json=parsed,
        raw_text=parsed_result.raw_text,
    )
    db.add(candidate)
    await db.flush()  # get candidate.id without full commit

    file_path = storage_dir / f"{candidate.id}_{safe_name}"
    file_path.write_bytes(file_bytes)
    candidate.resume_file_path = str(file_path)

    # --- Embed + index ---
    try:
        resume_text = emb_svc.build_resume_text(parsed)
        vector = emb_svc.embed_text(resume_text)
        dim = vector.shape[0]
        index = idx_svc.get_resume_index(dim=dim)
        index.add(vector, doc_id=candidate.id)
        candidate.faiss_index_id = candidate.id
    except Exception as exc:
        logger.error("Embedding/indexing failed for candidate %d: %s", candidate.id, exc)
        # Non-fatal: candidate is still stored, just not searchable via FAISS
        candidate.faiss_index_id = None

    await _audit(
        db,
        event_type="resume_uploaded",
        target_id=str(candidate.id),
        details={"filename": safe_name, "job_id": job_id},
    )

    return {
        "resume_id": candidate.id,
        "parse_status": "success",
        "name_redacted": parsed.get("name_redacted"),
        "skills_found": len(parsed.get("skills", [])),
        "years_experience": parsed.get("years_experience", 0),
        "file_type": parsed.get("file_type"),
        "indexed": candidate.faiss_index_id is not None,
    }


@router.post(
    "/resumes/reparse",
    summary="Re-parse all existing resumes to refresh extracted fields (name, skills, etc.)",
)
async def reparse_all_resumes(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Re-runs the parser on every stored resume file and updates the DB.
    Useful after improving the parser without re-uploading files.
    """
    result = await db.execute(select(Candidate))
    candidates = result.scalars().all()

    updated, failed = 0, 0
    for candidate in candidates:
        try:
            file_path = Path(candidate.resume_file_path)
            if not file_path.exists():
                logger.warning("File missing for candidate %d: %s", candidate.id, file_path)
                failed += 1
                continue

            file_bytes = file_path.read_bytes()
            parsed_result = parse_svc.parse_resume(file_bytes, candidate.original_filename)
            parsed = parsed_result.parsed

            candidate.name_redacted = parsed.get("name_redacted")
            candidate.email_hash    = parsed.get("email_hash")
            candidate.parsed_json   = parsed
            candidate.raw_text      = parsed_result.raw_text
            updated += 1
        except Exception as exc:
            logger.error("Reparse failed for candidate %d: %s", candidate.id, exc)
            failed += 1

    await _audit(db, "resumes_reparsed", details={"updated": updated, "failed": failed})
    return {"updated": updated, "failed": failed, "total": len(candidates)}


@router.get(
    "/resumes/",
    summary="List all candidates",
    response_model=list[CandidateSummary],
)
async def list_resumes(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> list[CandidateSummary]:
    result = await db.execute(
        select(Candidate).order_by(Candidate.created_at.desc()).offset(skip).limit(limit)
    )
    candidates = result.scalars().all()
    return [
        CandidateSummary(
            id=c.id,
            name_redacted=c.name_redacted,
            original_filename=c.original_filename,
            file_type=c.file_type,
            created_at=c.created_at.isoformat(),
            skills=(c.parsed_json or {}).get("skills", []),
            years_experience=(c.parsed_json or {}).get("years_experience", 0.0),
        )
        for c in candidates
    ]


@router.get(
    "/resumes/{resume_id}",
    summary="Get parsed fields for one candidate",
    response_model=CandidateDetail,
)
async def get_resume(
    resume_id: int,
    db: AsyncSession = Depends(get_db),
) -> CandidateDetail:
    candidate = await db.get(Candidate, resume_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    return CandidateDetail(
        id=candidate.id,
        name_redacted=candidate.name_redacted,
        original_filename=candidate.original_filename,
        file_type=candidate.file_type,
        created_at=candidate.created_at.isoformat(),
        skills=(candidate.parsed_json or {}).get("skills", []),
        years_experience=(candidate.parsed_json or {}).get("years_experience", 0.0),
        parsed_json=candidate.parsed_json,
        faiss_index_id=candidate.faiss_index_id,
    )


@router.delete(
    "/resumes/{resume_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a candidate (right-to-erasure)",
)
async def delete_resume(
    resume_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    candidate = await db.get(Candidate, resume_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    # Remove from FAISS index
    try:
        index = idx_svc.get_resume_index()
        index.remove(resume_id)
    except Exception as exc:
        logger.warning("FAISS removal failed for candidate %d: %s", resume_id, exc)

    # Delete file from disk
    try:
        Path(candidate.resume_file_path).unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("File deletion failed: %s", exc)

    await _audit(db, "resume_deleted", target_id=str(resume_id))
    await db.delete(candidate)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Job Description endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/jobs/",
    status_code=status.HTTP_201_CREATED,
    summary="Create a job description",
)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Parse and embed the JD
    jd_parsed = parse_svc.parse_job_description(payload.jd_text)

    job = Job(
        title=payload.title,
        jd_text=payload.jd_text,
        required_skills_json=jd_parsed.get("required_skills", []),
        desired_skills_json=jd_parsed.get("desired_skills", []),
        created_by=payload.created_by,
    )
    db.add(job)
    await db.flush()

    # Embed JD and store in FAISS for future similarity lookups
    try:
        jd_text_for_emb = emb_svc.build_jd_text(jd_parsed, payload.jd_text)
        vector = emb_svc.embed_text(jd_text_for_emb)
        dim = vector.shape[0]
        jd_index = idx_svc.get_jd_index(dim=dim)
        jd_index.add(vector, doc_id=job.id)
        job.faiss_index_id = job.id
    except Exception as exc:
        logger.error("JD embedding failed for job %d: %s", job.id, exc)
        job.faiss_index_id = None

    await _audit(db, "job_created", target_id=str(job.id), details={"title": payload.title})

    return {
        "job_id": job.id,
        "title": job.title,
        "required_skills": jd_parsed.get("required_skills", []),
        "desired_skills": jd_parsed.get("desired_skills", []),
        "indexed": job.faiss_index_id is not None,
    }


@router.get(
    "/jobs/",
    summary="List all jobs",
    response_model=list[JobSummary],
)
async def list_jobs(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> list[JobSummary]:
    result = await db.execute(
        select(Job).order_by(Job.created_at.desc()).offset(skip).limit(limit)
    )
    jobs = result.scalars().all()
    return [
        JobSummary(
            id=j.id,
            title=j.title,
            created_by=j.created_by,
            created_at=j.created_at.isoformat(),
        )
        for j in jobs
    ]


@router.get(
    "/jobs/{job_id}",
    summary="Get a job description with extracted skills",
    response_model=JobDetail,
)
async def get_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
) -> JobDetail:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobDetail(
        id=job.id,
        title=job.title,
        jd_text=job.jd_text,
        required_skills_json=job.required_skills_json,
        desired_skills_json=job.desired_skills_json,
        created_by=job.created_by,
        created_at=job.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Reviewer feedback endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/reviewer/feedback",
    status_code=status.HTTP_201_CREATED,
    summary="Submit human reviewer feedback on a match",
)
async def submit_feedback(
    payload: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Find the match for this (resume, job) pair
    result = await db.execute(
        select(Match).where(
            Match.candidate_id == payload.resume_id,
            Match.job_id == payload.job_id,
        )
    )
    match = result.scalars().first()
    if not match:
        raise HTTPException(
            status_code=404,
            detail="No match found for this resume/job pair. Run /match first.",
        )

    fb = Feedback(
        match_id=match.id,
        reviewer_id=payload.reviewer_id,
        label=payload.label,
        comment=payload.comment,
    )
    db.add(fb)

    await _audit(
        db,
        "feedback_submitted",
        target_id=str(match.id),
        details={
            "label": payload.label,
            "reviewer_id": payload.reviewer_id,
            "resume_id": payload.resume_id,
            "job_id": payload.job_id,
        },
    )

    return {"status": "recorded", "label": payload.label, "match_id": match.id}
