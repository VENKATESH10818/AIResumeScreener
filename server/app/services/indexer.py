"""
FAISS vector index wrapper.

Persists the index to disk so it survives container restarts.
Supports:
  - add(vector, doc_id)      → insert with an external integer ID
  - search(vector, top_k)    → return [(doc_id, similarity_score), …]
  - remove(doc_id)           → mark as deleted (soft delete via ID map)
  - save() / load()          → persist to / restore from disk

Index type: IndexFlatIP (inner-product on normalised vecs = cosine similarity).
For > 100k vectors, swap to IndexIVFFlat or IndexHNSWFlat for speed.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

import faiss
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default paths — overridden by env vars or constructor kwargs
# ---------------------------------------------------------------------------

_DEFAULT_RESUME_INDEX_PATH = os.getenv(
    "FAISS_INDEX_PATH", "./storage/faiss_index/resume_index.faiss"
)
_DEFAULT_RESUME_IDS_PATH = os.getenv(
    "FAISS_IDS_PATH", "./storage/faiss_index/resume_ids.npy"
)
_DEFAULT_JD_INDEX_PATH = os.getenv(
    "FAISS_JD_INDEX_PATH", "./storage/faiss_index/jd_index.faiss"
)
_DEFAULT_JD_IDS_PATH = os.getenv(
    "FAISS_JD_IDS_PATH", "./storage/faiss_index/jd_ids.npy"
)


class FAISSIndexer:
    """
    Thread-safe FAISS index with external ID mapping.

    IndexIDMap2 allows arbitrary external integer IDs (our DB primary keys).
    Uses IndexFlatIP (inner product) — equivalent to cosine similarity when
    vectors are L2-normalised.
    """

    def __init__(
        self,
        dim: int = 384,
        index_path: str = _DEFAULT_RESUME_INDEX_PATH,
        ids_path: str = _DEFAULT_RESUME_IDS_PATH,
    ):
        self.dim = dim
        self.index_path = index_path
        self.ids_path = ids_path
        self._lock = threading.Lock()
        self._ids: list[int] = []
        self._loaded = False
        # Build a fresh index — load_or_create() will overwrite if files exist
        flat = faiss.IndexFlatIP(dim)
        self._index: faiss.IndexIDMap2 = faiss.IndexIDMap2(flat)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load_or_create(self) -> None:
        """Load existing index from disk, or start fresh."""
        idx_path = Path(self.index_path)
        ids_path = Path(self.ids_path)

        if idx_path.exists() and ids_path.exists():
            try:
                loaded_index = faiss.read_index(str(idx_path))
                loaded_ids = np.load(str(ids_path)).tolist()
                with self._lock:
                    self._index = loaded_index
                    self._ids = loaded_ids
                logger.info(
                    "FAISS index loaded from %s (%d vectors)", idx_path, len(self._ids)
                )
            except Exception as exc:
                logger.warning("Failed to load FAISS index, starting fresh: %s", exc)
                self._reset()
        else:
            logger.info("No existing FAISS index at %s — starting fresh.", idx_path)
            self._reset()

        self._loaded = True

    def _reset(self) -> None:
        """Create a clean empty index."""
        flat = faiss.IndexFlatIP(self.dim)
        self._index = faiss.IndexIDMap2(flat)
        self._ids = []

    def save(self) -> None:
        """Persist index and ID list to disk."""
        idx_path = Path(self.index_path)
        ids_path = Path(self.ids_path)
        idx_path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            faiss.write_index(self._index, str(idx_path))
            np.save(str(ids_path), np.array(self._ids, dtype=np.int64))
        logger.debug("FAISS index saved to %s (%d vectors).", idx_path, len(self._ids))

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def add(self, vector: np.ndarray, doc_id: int) -> None:
        """
        Insert a single vector with an external doc_id.

        Args:
            vector: 1-D float32 array of shape (dim,).
            doc_id: External DB primary key (must be unique per index).
        """
        vec = np.array(vector, dtype=np.float32).reshape(1, -1)
        ids = np.array([doc_id], dtype=np.int64)
        with self._lock:
            self._index.add_with_ids(vec, ids)
            if doc_id not in self._ids:
                self._ids.append(doc_id)
        self.save()

    def add_batch(self, vectors: np.ndarray, doc_ids: list[int]) -> None:
        """
        Insert multiple vectors at once.

        Args:
            vectors: 2-D float32 array of shape (N, dim).
            doc_ids: List of N external IDs.
        """
        vecs = np.array(vectors, dtype=np.float32)
        ids = np.array(doc_ids, dtype=np.int64)
        with self._lock:
            self._index.add_with_ids(vecs, ids)
            for doc_id in doc_ids:
                if doc_id not in self._ids:
                    self._ids.append(doc_id)
        self.save()

    def search(
        self, query_vector: np.ndarray, top_k: int = 10
    ) -> list[tuple[int, float]]:
        """
        Find the top_k most similar vectors.

        Returns:
            List of (doc_id, similarity_score) sorted by score desc.
            Returns an empty list if the index is empty.
        """
        if self._index.ntotal == 0:
            return []

        top_k = min(top_k, self._index.ntotal)
        qvec = np.array(query_vector, dtype=np.float32).reshape(1, -1)

        with self._lock:
            scores, ids = self._index.search(qvec, top_k)

        results = []
        for score, idx in zip(scores[0], ids[0]):
            if idx == -1:
                continue  # FAISS padding for empty slots
            results.append((int(idx), float(score)))

        return sorted(results, key=lambda x: x[1], reverse=True)

    def remove(self, doc_id: int) -> None:
        """Remove a vector by its external doc_id."""
        ids_array = np.array([doc_id], dtype=np.int64)
        ids_selector = faiss.IDSelectorArray(ids_array.size, faiss.swig_ptr(ids_array))
        with self._lock:
            self._index.remove_ids(ids_selector)
            if doc_id in self._ids:
                self._ids.remove(doc_id)
        self.save()

    def count(self) -> int:
        """Total number of vectors currently indexed."""
        return self._index.ntotal

    def all_ids(self) -> list[int]:
        """Return a copy of all stored external IDs."""
        with self._lock:
            return list(self._ids)


# ---------------------------------------------------------------------------
# Module-level singletons — one for resumes, one for job descriptions
# ---------------------------------------------------------------------------

_RESUME_INDEX: FAISSIndexer | None = None
_JD_INDEX: FAISSIndexer | None = None


def get_resume_index(dim: int = 384) -> FAISSIndexer:
    """Return (and lazily initialise) the global resume FAISS index."""
    global _RESUME_INDEX
    if _RESUME_INDEX is None:
        _RESUME_INDEX = FAISSIndexer(
            dim=dim,
            index_path=_DEFAULT_RESUME_INDEX_PATH,
            ids_path=_DEFAULT_RESUME_IDS_PATH,
        )
        _RESUME_INDEX.load_or_create()
    elif _RESUME_INDEX.dim != dim:
        # Dim mismatch after a model change — rebuild the index
        logger.warning(
            "Resume index dim mismatch (stored=%d, requested=%d). Rebuilding.",
            _RESUME_INDEX.dim, dim,
        )
        _RESUME_INDEX = FAISSIndexer(
            dim=dim,
            index_path=_DEFAULT_RESUME_INDEX_PATH,
            ids_path=_DEFAULT_RESUME_IDS_PATH,
        )
        _RESUME_INDEX.load_or_create()
    return _RESUME_INDEX


def get_jd_index(dim: int = 384) -> FAISSIndexer:
    """Return (and lazily initialise) the global job-description FAISS index."""
    global _JD_INDEX
    if _JD_INDEX is None:
        _JD_INDEX = FAISSIndexer(
            dim=dim,
            index_path=_DEFAULT_JD_INDEX_PATH,
            ids_path=_DEFAULT_JD_IDS_PATH,
        )
        _JD_INDEX.load_or_create()
    elif _JD_INDEX.dim != dim:
        # Dim mismatch after a model change — rebuild the index
        logger.warning(
            "JD index dim mismatch (stored=%d, requested=%d). Rebuilding.",
            _JD_INDEX.dim, dim,
        )
        _JD_INDEX = FAISSIndexer(
            dim=dim,
            index_path=_DEFAULT_JD_INDEX_PATH,
            ids_path=_DEFAULT_JD_IDS_PATH,
        )
        _JD_INDEX.load_or_create()
    return _JD_INDEX
