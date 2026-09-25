"""
Scoring & ranking service.

Heuristic formula (transparent, no training data required):

  score = 0.50 * embedding_cosine_similarity
        + 0.30 * skill_match_ratio
        + 0.15 * experience_match_score
        + 0.05 * education_bonus

Each component is normalised to [0, 1].  The final score is in [0, 1].

Hard filters:
  - If a required skill is completely absent → deprioritise (score penalty).

Explanation JSON is produced alongside every score for full transparency.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ScoringWeights:
    embedding: float = 0.50
    skill_match: float = 0.30
    experience: float = 0.15
    education: float = 0.05

    def validate(self) -> None:
        total = self.embedding + self.skill_match + self.experience + self.education
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise ValueError(f"Weights must sum to 1.0, got {total}")


DEFAULT_WEIGHTS = ScoringWeights()


@dataclass
class ScoreExplanation:
    """Full breakdown of a candidate's score for a given job."""

    # Sub-scores (each in [0, 1])
    embedding_similarity: float = 0.0
    skill_match_ratio: float = 0.0
    experience_match_score: float = 0.0
    education_bonus: float = 0.0

    # Final composite
    final_score: float = 0.0

    # Penalty flags
    missing_required_skills: list[str] = field(default_factory=list)
    hard_filter_applied: bool = False
    hard_filter_penalty: float = 0.0

    # Human-readable details
    matched_skills: list[str] = field(default_factory=list)
    missing_skills: list[str] = field(default_factory=list)
    candidate_years_exp: float = 0.0
    required_years_exp: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Individual scoring components
# ---------------------------------------------------------------------------


def score_embedding(cosine_sim: float) -> float:
    """
    Clip cosine similarity to [0, 1].
    Normalised embeddings can produce small negative values for very
    dissimilar texts — treat those as 0.
    """
    return max(0.0, min(1.0, float(cosine_sim)))


def score_skill_match(
    candidate_skills: list[str],
    required_skills: list[str],
    desired_skills: list[str],
) -> tuple[float, list[str], list[str]]:
    """
    Compute a weighted skill match ratio.

    Required skills count double vs desired skills.
    Returns (ratio [0,1], matched_list, missing_required_list).
    """
    if not required_skills and not desired_skills:
        return 0.0, [], []

    cand_set = {s.lower() for s in candidate_skills}
    req_set = {s.lower() for s in required_skills}
    des_set = {s.lower() for s in desired_skills}

    matched_req = req_set & cand_set
    missing_req = req_set - cand_set
    matched_des = des_set & cand_set

    # Weighted sum
    total_weight = 2 * len(req_set) + len(des_set)
    if total_weight == 0:
        return 0.0, [], []

    matched_weight = 2 * len(matched_req) + len(matched_des)
    ratio = matched_weight / total_weight

    all_matched = sorted(matched_req | matched_des)
    return min(1.0, ratio), all_matched, sorted(missing_req)


def score_experience(
    candidate_years: float, required_years: float
) -> float:
    """
    Compare candidate experience to job requirement.

    - If required_years == 0 → neutral score of 0.5
    - candidate >= required  → 1.0
    - candidate < required   → linear decay down to 0
    """
    if required_years <= 0:
        return 0.5
    if candidate_years >= required_years:
        return 1.0
    return max(0.0, candidate_years / required_years)


def score_education(
    candidate_education: list[str],
    jd_education: list[str],
) -> float:
    """
    Simple bonus: +1.0 if any degree keyword from the JD appears in candidate
    education, +0.5 if any education at all, 0 otherwise.
    """
    if not candidate_education:
        return 0.0

    if not jd_education:
        # JD doesn't specify education requirements → neutral bonus
        return 0.3

    cand_lower = " ".join(candidate_education).lower()
    for edu_req in jd_education:
        if edu_req.lower() in cand_lower:
            return 1.0

    # Has education but it doesn't match JD keywords
    return 0.2


# ---------------------------------------------------------------------------
# Hard filter
# ---------------------------------------------------------------------------

HARD_FILTER_PENALTY = 0.4  # multiply final score by (1 - penalty)


def apply_hard_filter(
    missing_required_skills: list[str],
) -> float:
    """
    If required skills are missing, apply a multiplicative penalty.

    Returns the penalty fraction (0 = no penalty, HARD_FILTER_PENALTY = full).
    Scales with number of missing required skills (caps at penalty constant).
    """
    if not missing_required_skills:
        return 0.0
    # Each missing required skill adds 10% penalty up to the cap
    raw = len(missing_required_skills) * 0.10
    return min(HARD_FILTER_PENALTY, raw)


# ---------------------------------------------------------------------------
# Composite scorer
# ---------------------------------------------------------------------------


def score_candidate(
    cosine_similarity: float,
    candidate_parsed: dict[str, Any],
    jd_parsed: dict[str, Any],
    weights: ScoringWeights = DEFAULT_WEIGHTS,
) -> ScoreExplanation:
    """
    Compute the full score and explanation for one candidate–job pair.

    Args:
        cosine_similarity: Pre-computed cosine similarity between
                           the candidate and JD embeddings.
        candidate_parsed:  Parsed resume dict from parser.parse_resume().
        jd_parsed:         Parsed JD dict from parser.parse_job_description().
        weights:           Optional override of scoring weights.

    Returns:
        ScoreExplanation with final_score and full breakdown.
    """
    weights.validate()

    # --- 1. Embedding similarity ---
    emb_score = score_embedding(cosine_similarity)

    # --- 2. Skill match ---
    candidate_skills: list[str] = candidate_parsed.get("skills", [])
    required_skills: list[str] = jd_parsed.get("required_skills", [])
    desired_skills: list[str] = jd_parsed.get("desired_skills", [])

    skill_ratio, matched_skills, missing_req = score_skill_match(
        candidate_skills, required_skills, desired_skills
    )

    # --- 3. Experience match ---
    candidate_years: float = float(candidate_parsed.get("years_experience", 0) or 0)
    required_years: float = float(
        jd_parsed.get("years_experience_required", 0) or 0
    )
    exp_score = score_experience(candidate_years, required_years)

    # --- 4. Education bonus ---
    candidate_edu: list[str] = candidate_parsed.get("education", [])
    jd_edu: list[str] = jd_parsed.get("education", [])
    edu_score = score_education(candidate_edu, jd_edu)

    # --- 5. Weighted sum ---
    raw_score = (
        weights.embedding * emb_score
        + weights.skill_match * skill_ratio
        + weights.experience * exp_score
        + weights.education * edu_score
    )

    # --- 6. Hard filter penalty ---
    penalty = apply_hard_filter(missing_req)
    final_score = raw_score * (1.0 - penalty)
    final_score = max(0.0, min(1.0, final_score))

    # Missing skills (all, not just required)
    all_jd_skills = set(required_skills + desired_skills)
    cand_set = {s.lower() for s in candidate_skills}
    all_missing = sorted(all_jd_skills - cand_set)

    return ScoreExplanation(
        embedding_similarity=round(emb_score, 4),
        skill_match_ratio=round(skill_ratio, 4),
        experience_match_score=round(exp_score, 4),
        education_bonus=round(edu_score, 4),
        final_score=round(final_score, 4),
        missing_required_skills=missing_req,
        hard_filter_applied=penalty > 0,
        hard_filter_penalty=round(penalty, 4),
        matched_skills=matched_skills,
        missing_skills=all_missing,
        candidate_years_exp=candidate_years,
        required_years_exp=required_years,
    )


def rank_candidates(
    scored: list[tuple[int, ScoreExplanation]],
) -> list[dict[str, Any]]:
    """
    Sort (candidate_id, ScoreExplanation) pairs by final_score desc and
    attach rank numbers (1 = best).

    Returns a list of dicts ready for API serialisation.
    """
    sorted_candidates = sorted(
        scored, key=lambda x: x[1].final_score, reverse=True
    )
    results = []
    for rank, (candidate_id, explanation) in enumerate(sorted_candidates, start=1):
        results.append(
            {
                "rank": rank,
                "candidate_id": candidate_id,
                "score": explanation.final_score,
                "explanation": explanation.to_dict(),
            }
        )
    return results
