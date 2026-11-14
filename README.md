# Before You Agree

Before You Agree is an AI-assisted browser extension that helps people understand
the consequences, risks, and future commitments in online agreements.

The repository is organized as a small monorepo:

- `extension/` — React, TypeScript, Vite, and Chrome Manifest V3 extension.
- `backend/` — FastAPI service and its Python test suite.
- `infra/` — local infrastructure, currently PostgreSQL via Docker Compose.

## Quick start

### 1. Configure the backend

```powershell
Copy-Item .env.example backend/.env
```

Adjust `backend/.env` only when local values need to differ from the defaults.
Never commit that file or real API keys.

### 2. Start PostgreSQL

```powershell
docker compose -f infra/compose.yaml up -d postgres
```

### 3. Start the API

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API exposes interactive documentation at `http://localhost:8000/docs`.
The liveness and database readiness endpoints are:

- `GET /health/live`
- `GET /health/ready`

### 4. Build the extension

```powershell
cd extension
npm ci
npm run build
```

Load `extension/dist` as an unpacked extension in Chrome. Open a normal
`http://` or `https://` page, open the popup, and use **Inspect page** to verify
popup → background worker → content script messaging.

## Development commands

```powershell
npm run build
npm run lint
npm run typecheck
```

Backend tests run from `backend/` after installing `requirements-dev.txt`:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

The product is decision support, not legal advice. Raw page text is not logged
or persisted by the setup foundation.
