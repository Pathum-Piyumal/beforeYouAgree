# Run and release

## Local Python and PostgreSQL

Copy `.env.example` to `backend/.env`. Start the development PostgreSQL service:

```powershell
docker compose -f infra/compose.yaml up -d postgres
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

In another backend shell, run `python -m scripts.reminders --loop` for periodic
account reminder delivery. Listing reminders also catches up missed times.
Readiness is `/health/ready`; liveness is `/health/live`. API documentation is
`/docs`. Seed data is synthetic and its seed account has no usable password.

## Complete local container stack

Create `backend/.env` as above, copy `infra/app.env.example` to a private local
file such as `infra/app.env`, and replace its PostgreSQL password with a random
URL-safe value. Use the same private interpolation file for all commands:

```powershell
docker compose --env-file infra/app.env -f infra/compose.app.yaml up --build -d
docker compose --env-file infra/app.env -f infra/compose.app.yaml ps
docker compose --env-file infra/app.env -f infra/compose.app.yaml logs api reminders
```

The stack waits for PostgreSQL, applies migrations once, starts the API on
127.0.0.1:8000 and runs the scheduler separately. It creates a dedicated
`app-postgres` volume. `down` stops containers; `down -v` permanently deletes
that database. Do not change a deployed database password only in the file:
update the actual PostgreSQL role and all clients together.

## Extension and standalone dashboard

```powershell
cd extension
npm ci
npm run build
npm run build:dashboard
```

Load `extension/dist` with Chrome's developer-mode **Load unpacked**. Use a
normal HTTP(S) fixture, inspect its text, check consent, then Analyze. For
manual input, provide the real agreement source URL and only the relevant text.
Open **Sign in / dashboard** for the extension dashboard. To serve the separate
dashboard build locally, run `python -m http.server 5173 --directory dashboard-dist`
from `extension/`. Configure CORS for that exact origin (localhost:5173 by
default). The standalone dashboard uses tab-scoped sessions and has account
reminders; browser-local reminders require the installed extension.

For a deployed backend, set VITE_API_BASE_URL before both builds, update the
extension manifest's API host permission, rebuild, and configure exact CORS
origins. The dashboard ZIP can be served by any static HTTPS host.

## Optional hosted AI

The default is LLM_PROVIDER=mock and makes no model requests. To enable OpenAI,
set LLM_PROVIDER=openai, LLM_MODEL to a model supporting structured outputs,
LLM_API_KEY, and positive LLM_INPUT_COST_PER_MILLION and
LLM_OUTPUT_COST_PER_MILLION matching your account's model prices. Review
LLM_MAX_COST_USD, LLM_MAX_OUTPUT_TOKENS, LLM_MAX_RETRIES and LLM_TIMEOUT_SECONDS.
The conservative budget reserves for every retry and may reject large texts.
Prices are operator inputs, not guaranteed billing limits. Set provider account
spend limits as appropriate. No key belongs in extension variables or builds.

The client analysis timeout defaults to 120 seconds, covering the default
three attempts of up to 30 seconds each. If you increase backend timeouts or
retries, rebuild with VITE_ANALYSIS_TIMEOUT_MS set above the total attempt
budget plus backoff (allowed range 10,000–600,000 milliseconds). Ordinary
account requests retain a separate 30-second timeout.

The adapter follows the [OpenAI structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs).
Only mocked HTTP integration is part of automated checks; live model access,
account permissions, supported-model parameters, pricing and provider data
policy must be verified with the operator's configured account.

## Verification and packaging

```powershell
cd backend
python -m ruff check app tests
python -m pytest
python -m scripts.evaluate
cd ../extension
npm run typecheck
npm run lint
npm test
npx playwright install chromium --no-shell
npm run build
npm run build:dashboard
npm run test:e2e
npm run test:integration
cd ..
python scripts/package_release.py
```

Packages and SHA-256 files appear in `release/`. PostgreSQL integration requires
a dedicated database ending `_test` via TEST_DATABASE_URL; tests create and
remove temporary schemas. CI verifies migration upgrades/downgrades separately.
Do not point tests at production data.

## Deployment operations

Before exposing the service, set APP_ENVIRONMENT outside development, a unique
JWT_SECRET of at least 32 random bytes, exact CORS origins, HTTPS at a trusted
reverse proxy, shared rate limiting and restricted database credentials. Bind
the API privately behind that proxy. Back up PostgreSQL before migrations and
test restore procedures. Configure monitoring for readiness failures, request
errors and scheduler logs. Saved evidence is sensitive and belongs in encrypted,
access-controlled backups with an explicit retention policy.

Rollback procedure: stop new writes and the scheduler, restore the last known
application image, and use a tested database backup if the previous schema
cannot read the migrated data. Downgrading 0003 discards confirmed reminder
metadata; downgrading 0002 discards saved report snapshots. Do not downgrade
production merely because a rollback command exists.

Unpacked local delivery is the default release target. Live hosting, Chrome Web
Store publication, human usability studies, an independently annotated AI corpus
and any university submission are separate owner actions; no results or
approvals for those are implied by the source code or synthetic evaluation.

The user has additionally selected Render hosting. See
`docs/render-deployment.md` for the prepared target and `render.yaml` demo
Blueprint; live deployment requires a connected account and verified service
URLs. Use `docs/status.md` for the current verification and deployment state.
