# AI Resume Screener

A local-first, fully open-source resume screening system built with:

- **FastAPI** — async REST API
- **pdfplumber + pytesseract** — PDF and image text extraction
- **python-docx** — DOCX parsing
- **spaCy** — NER (name, titles, companies, education)
- **sentence-transformers** — semantic embeddings (`all-MiniLM-L6-v2`)
- **FAISS** — fast vector similarity search
- **SQLite / SQLAlchemy** — metadata persistence (drop-in Postgres upgrade)

No cloud APIs. No paid services. Runs entirely on your local machine.

---

## Project Structure

```
resume-screener/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── server/
    ├── app/
    │   ├── main.py            # FastAPI app, startup/shutdown, middleware
    │   ├── db.py              # SQLAlchemy models + async session
    │   ├── api/
    │   │   ├── upload.py      # Resume & job CRUD endpoints
    │   │   └── match.py       # Matching & ranking endpoints
    │   └── services/
    │       ├── parser.py      # Text extraction + spaCy NER
    │       ├── embeddings.py  # sentence-transformers wrapper
    │       ├── indexer.py     # FAISS index wrapper
    │       └── scoring.py     # Heuristic scoring + explanations
    └── storage/
        ├── resumes/           # Raw uploaded files (git-ignored)
        └── faiss_index/       # Persisted FAISS index (git-ignored)
```

---

## Quick Start (Docker — recommended)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd resume-screener
cp .env.example .env
```

### 2. Build and start

```bash
docker compose up --build
```

First build takes ~5–10 minutes (downloads Python deps + spaCy model).
Subsequent starts are instant.

### 3. Open the API docs

```
http://localhost:8000/docs
```

---

## Quick Start (Local Python — no Docker)

### Prerequisites
- Python 3.11+
- Tesseract OCR installed:
  - **Windows**: Download installer from https://github.com/UB-Mannheim/tesseract/wiki
  - **macOS**: `brew install tesseract`
  - **Linux**: `sudo apt install tesseract-ocr`

### 1. Set up virtual environment

```bash
cd resume-screener
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

### 2. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work out of the box)
```

### 4. Create storage directories

```bash
# Windows
mkdir server\storage\resumes
mkdir server\storage\faiss_index

# macOS / Linux
mkdir -p server/storage/resumes server/storage/faiss_index
```

### 5. Start the server

```bash
cd server
uvicorn app.main:app --reload --port 8000
```

---

## API Reference

All endpoints are prefixed with `/api/v1`. Interactive docs at `http://localhost:8000/docs`.

### Resumes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/resumes/upload` | Upload a resume (PDF/DOCX/image) |
| `GET` | `/api/v1/resumes/` | List all candidates |
| `GET` | `/api/v1/resumes/{id}` | Get parsed fields for one candidate |
| `DELETE` | `/api/v1/resumes/{id}` | Delete a candidate (right-to-erasure) |

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/jobs/` | Create a job description |
| `GET` | `/api/v1/jobs/` | List all jobs |
| `GET` | `/api/v1/jobs/{id}` | Get job with extracted skills |

### Matching

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/match` | Score & rank candidates against a job |
| `GET` | `/api/v1/match/{job_id}` | Get stored match results for a job |
| `GET` | `/api/v1/match/{job_id}/top` | Fast semantic-only top-N preview |

### Reviewer

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/reviewer/feedback` | Submit accept/reject/maybe feedback |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe (model + FAISS status) |

---

## Example Workflow

### 1. Upload resumes

```bash
curl -X POST http://localhost:8000/api/v1/resumes/upload \
  -F "file=@alice_resume.pdf"

curl -X POST http://localhost:8000/api/v1/resumes/upload \
  -F "file=@bob_resume.docx"
```

### 2. Create a job description

```bash
curl -X POST http://localhost:8000/api/v1/jobs/ \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Senior Python Engineer",
    "jd_text": "We are looking for a Senior Python Engineer with 5+ years of experience. Required skills: Python, FastAPI, PostgreSQL, Docker, AWS. Nice to have: Kubernetes, machine learning, spaCy.",
    "created_by": "hr@company.com"
  }'
```

### 3. Rank candidates

```bash
curl -X POST http://localhost:8000/api/v1/match \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": 1,
    "top_k": 10,
    "use_faiss_prefilter": true
  }'
```

### 4. Submit reviewer feedback

```bash
curl -X POST http://localhost:8000/api/v1/reviewer/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "resume_id": 1,
    "job_id": 1,
    "label": "accept",
    "comment": "Strong Python and cloud background",
    "reviewer_id": "reviewer@company.com"
  }'
```

---

## Scoring Formula

```
score = 0.50 × embedding_cosine_similarity   # semantic fit
      + 0.30 × skill_match_ratio             # required + desired skills
      + 0.15 × experience_match_score        # years of experience
      + 0.05 × education_bonus               # degree / certification match
```

**Hard filter**: Missing required skills apply a multiplicative penalty (up to 40% reduction).

Every score includes a full `explanation` JSON showing matched/missing skills, sub-scores, and whether a hard filter was applied.

---

## Upgrading to PostgreSQL

1. Install and start PostgreSQL
2. Create a database: `createdb resume_screener`
3. Update `.env`:
   ```
   DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/resume_screener
   ```
4. Add `asyncpg` to `requirements.txt` and reinstall
5. Restart the server — tables are created automatically

---

## Upgrading the Embedding Model

For higher accuracy at the cost of speed, change `EMBEDDING_MODEL` in `.env`:

```
EMBEDDING_MODEL=all-mpnet-base-v2   # 768-dim, better quality
```

Then delete the existing FAISS index and re-upload all resumes to rebuild it:
```bash
rm server/storage/faiss_index/*
```

---

## Roadmap (next iterations)

- [ ] React reviewer UI (upload, ranked list, accept/reject)
- [ ] LightGBM ranking model trained on feedback labels
- [ ] Batch upload endpoint (ZIP file with multiple resumes)
- [ ] Fairness metrics dashboard (demographic parity, disparate impact)
- [ ] MLflow model registry for embedding model versioning
- [ ] PostgreSQL + Redis migration for production scale
- [ ] Authentication (API keys / OAuth2)
- [ ] ATS integration (Greenhouse, Lever webhooks)

---

## License

MIT
