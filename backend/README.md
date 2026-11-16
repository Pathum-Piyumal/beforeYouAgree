# Before You Agree backend

## Setup

From the repository root, copy `.env.example` to `backend/.env`, start the local
PostgreSQL service with `docker compose -f infra/compose.yaml up -d postgres`,
then run:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
alembic upgrade head
```

## Run

```powershell
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs`. `GET /health/live` checks the process and
`GET /health/ready` checks PostgreSQL connectivity.

To load synthetic demo data after the migration:

```powershell
python -m scripts.seed
```

The seed contains no real user or agreement data. Raw extracted page text is
not part of the database schema; only evidence excerpts and source metadata are
retained for findings.
