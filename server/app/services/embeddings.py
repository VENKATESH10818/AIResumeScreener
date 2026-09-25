"""
Embedding service using sentence-transformers.

Produces dense vector representations for resumes and job descriptions.
The model is loaded once at startup and reused for all requests.

Default: all-MiniLM-L6-v2  (384-dim, fast, good quality)
Upgrade:  all-mpnet-base-v2 (768-dim, higher accuracy, ~3x slower)
"""

from __future__ import annotations

import logging
import os
from typing import Sequence

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_DIM: int = 384  # update if you swap models

# Singleton model instance
_MODEL: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        logger.info("Loading sentence-transformers model: %s", EMBEDDING_MODEL)
        _MODEL = SentenceTransformer(EMBEDDING_MODEL)
        # Warm up — avoids cold-start latency on first real request
        _MODEL.encode(["warm up"], show_progress_bar=False)
        logger.info("Embedding model ready (dim=%d)", _MODEL.get_sentence_embedding_dimension())
    return _MODEL


def embed_text(text: str) -> np.ndarray:
    """
    Produce a single normalised embedding vector for a text string.

    Returns:
        np.ndarray of shape (dim,), dtype float32.
    """
    model = _get_model()
    vec = model.encode(
        text,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return vec.astype(np.float32)


def embed_batch(texts: Sequence[str], batch_size: int = 32) -> np.ndarray:
    """
    Embed a list of texts in batches.

    Returns:
        np.ndarray of shape (N, dim), dtype float32.
    """
    model = _get_model()
    vecs = model.encode(
        list(texts),
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return vecs.astype(np.float32)


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """
    Cosine similarity between two normalised vectors.
    Since both are L2-normalised, this reduces to a dot product.
    """
    return float(np.dot(vec_a, vec_b))


def build_resume_text(parsed: dict) -> str:
    """
    Compose the text that gets embedded for a candidate.

    Combines extracted fields so the embedding captures semantics of the
    whole resume, not just raw text (which may be noisy).
    """
    parts: list[str] = []

    if parsed.get("job_titles"):
        parts.append("Roles: " + ", ".join(parsed["job_titles"]))
    if parsed.get("skills"):
        parts.append("Skills: " + ", ".join(parsed["skills"]))
    if parsed.get("companies"):
        parts.append("Companies: " + ", ".join(parsed["companies"][:5]))
    if parsed.get("education"):
        parts.append("Education: " + "; ".join(parsed["education"][:3]))
    if parsed.get("certifications"):
        parts.append("Certifications: " + ", ".join(parsed["certifications"]))
    if parsed.get("years_experience"):
        parts.append(f"Years of experience: {parsed['years_experience']}")

    return "\n".join(parts)


def build_jd_text(jd_parsed: dict, jd_raw: str) -> str:
    """
    Compose the text that gets embedded for a job description.
    """
    parts: list[str] = []

    if jd_parsed.get("job_titles"):
        parts.append("Role: " + ", ".join(jd_parsed["job_titles"]))
    if jd_parsed.get("required_skills"):
        parts.append("Required skills: " + ", ".join(jd_parsed["required_skills"]))
    if jd_parsed.get("desired_skills"):
        parts.append("Desired skills: " + ", ".join(jd_parsed["desired_skills"]))
    if jd_parsed.get("years_experience_required"):
        parts.append(f"Experience required: {jd_parsed['years_experience_required']} years")

    # Append truncated raw JD for richer semantic context
    parts.append(jd_raw[:1000])

    return "\n".join(parts)


def embedding_dim() -> int:
    """Return the dimensionality of the current model's embeddings."""
    return _get_model().get_sentence_embedding_dimension()
