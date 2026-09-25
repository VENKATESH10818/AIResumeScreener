"""
FastAPI application entry point for the AI Resume Screener.

Start locally:
    cd server
    uvicorn app.main:app --reload --port 8000

Interactive docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.match import router as match_router
from app.api.upload import router as upload_router
from app.db import init_db
from app.services import embeddings as emb_svc
from app.services import indexer as idx_svc

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: initialise DB tables, warm up embedding model, load FAISS index.
    Shutdown: save FAISS index to disk.
    """
    logger.info("=== Resume Screener starting up ===")

    # 1. Create DB tables (idempotent)
    await init_db()
    logger.info("Database tables ready.")

    # 2. Warm up the embedding model first (needed to know the dim)
    try:
        emb_svc.embed_text("warm up")
        dim = emb_svc.embedding_dim()
        logger.info("Embedding model ready (dim=%d).", dim)
    except Exception as exc:
        logger.error("Embedding model warm-up failed: %s", exc)
        dim = 384  # safe fallback

    # 3. Load / create FAISS resume index
    try:
        resume_index = idx_svc.get_resume_index(dim=dim)
        logger.info("FAISS resume index ready (%d vectors).", resume_index.count())
    except Exception as exc:
        logger.error("FAISS index init failed: %s", exc)

    logger.info("=== Startup complete. API is ready at http://localhost:8000/docs ===")
    yield

    # --- Shutdown ---
    logger.info("=== Resume Screener shutting down ===")
    try:
        idx_svc.get_resume_index().save()
        logger.info("FAISS index saved.")
    except Exception as exc:
        logger.warning("FAISS save on shutdown failed: %s", exc)


# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AI Resume Screener",
    description=(
        "Local-first, open-source resume screening system. "
        "Upload resumes, create job descriptions, and rank candidates "
        "using semantic embeddings + heuristic scoring."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow the React UI (and curl) to call the API during local dev
# ---------------------------------------------------------------------------

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request timing middleware
# ---------------------------------------------------------------------------


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed:.1f}"
    return response


# ---------------------------------------------------------------------------
# Global exception handler — keeps 500 responses consistent
# ---------------------------------------------------------------------------


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred. Check server logs."},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

API_PREFIX = "/api/v1"

app.include_router(upload_router, prefix=API_PREFIX, tags=["Resumes & Jobs"])
app.include_router(match_router, prefix=API_PREFIX, tags=["Matching & Ranking"])


# ---------------------------------------------------------------------------
# Health & system endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["System"])
async def health() -> dict:
    """Liveness probe — returns 200 if the server process is up."""
    return {"status": "ok"}


@app.get("/ready", tags=["System"])
async def readiness() -> dict:
    """Readiness probe — verifies embedding model and FAISS index are operational."""
    checks: dict[str, str] = {}

    try:
        emb_svc.embed_text("ping")
        checks["embedding_model"] = "ok"
    except Exception as exc:
        checks["embedding_model"] = f"error: {exc}"

    try:
        count = idx_svc.get_resume_index().count()
        checks["faiss_resume_index"] = f"ok ({count} vectors)"
    except Exception as exc:
        checks["faiss_resume_index"] = f"error: {exc}"

    all_ok = all(v.startswith("ok") for v in checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


@app.get("/", tags=["System"])
async def root() -> dict:
    return {
        "name": "AI Resume Screener",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
        "ready": "/ready",
    }
