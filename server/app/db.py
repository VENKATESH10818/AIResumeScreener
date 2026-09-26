"""
Database setup: SQLAlchemy async engine + models.

Default: SQLite via aiosqlite (zero-config, local dev).
Swap DATABASE_URL to postgresql+asyncpg://... to move to Postgres.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship

# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

DATABASE_URL = os.getenv(
    "DATABASE_URL", "sqlite+aiosqlite:////tmp/resume_screener.db"
)

# Convert Render Postgres URL (postgres:// or postgresql://) to asyncpg format
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

_is_sqlite = "sqlite" in DATABASE_URL

# For SQLite we need check_same_thread=False in connect_args.
# For Postgres that key is not valid, so we only add it for SQLite.
_connect_args: dict = {"check_same_thread": False} if _is_sqlite else {}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yields a DB session per request."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables on startup (idempotent — safe to call multiple times)."""
    if _is_sqlite:
        db_path = DATABASE_URL.split("///")[-1]
        try:
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# ORM models
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


class Candidate(Base):
    """One uploaded resume with parsed output and embedding reference."""

    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    email_hash = Column(String(64), nullable=True, index=True)   # SHA-256 of email
    name_redacted = Column(String(128), nullable=True)           # e.g. "Alice M."
    resume_file_path = Column(String(512), nullable=False)
    original_filename = Column(String(256), nullable=False)
    file_type = Column(String(16), nullable=False)               # pdf | docx | image
    parsed_json = Column(JSON, nullable=True)                    # full extraction output
    raw_text = Column(Text, nullable=True)                       # cleaned extracted text
    faiss_index_id = Column(Integer, nullable=True, index=True)  # mirrors DB id
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    matches = relationship("Match", back_populates="candidate", cascade="all, delete")


class Job(Base):
    """A job description posted for candidate matching."""

    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(256), nullable=False)
    jd_text = Column(Text, nullable=False)
    required_skills_json = Column(JSON, nullable=True)
    desired_skills_json = Column(JSON, nullable=True)
    faiss_index_id = Column(Integer, nullable=True)
    created_by = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    matches = relationship("Match", back_populates="job", cascade="all, delete")


class Match(Base):
    """Result of matching a candidate to a job."""

    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    score = Column(Float, nullable=False)
    rank = Column(Integer, nullable=True)
    explanation_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    job = relationship("Job", back_populates="matches")
    candidate = relationship("Candidate", back_populates="matches")
    feedback = relationship("Feedback", back_populates="match", cascade="all, delete")


class Feedback(Base):
    """Human reviewer feedback on a match."""

    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    reviewer_id = Column(String(128), nullable=True)
    label = Column(String(32), nullable=False)   # accept | reject | maybe
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    match = relationship("Match", back_populates="feedback")


class AuditLog(Base):
    """Append-only compliance audit trail."""

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    actor_id = Column(String(128), nullable=True)
    target_id = Column(String(128), nullable=True)
    details = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
