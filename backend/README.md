# Before You Agree backend

See [the release runbook](../docs/runbook.md) for complete startup, provider,
container and packaging instructions, and [the data model](../docs/database.md)
for ownership and cascade behavior.

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

## Account API

The guest analysis endpoint remains available without signing in. Account routes
use the existing `users` and `refresh_sessions` tables; apply the initial
migration before using them. The synthetic seed user cannot log in; register a
new account to try authentication.

| Route under `/api/v1` | Request | Result |
| --- | --- | --- |
| `POST /auth/register` | `name`, `email`, `password` | Profile and token pair (201) |
| `POST /auth/login` | `email`, `password` | Profile and token pair |
| `POST /auth/refresh` | `refresh_token` | Replacement token pair |
| `POST /auth/logout` | `refresh_token` | Revoke that session (204) |
| `GET /users/me` | `Authorization: Bearer <access_token>` | Current profile |
| `PATCH /users/me` | Bearer access token and JSON `name` | Updated profile |
| `DELETE /users/me` | Bearer access token and JSON `password` | Delete own account and account data (204) |

Passwords must contain 12–128 characters and are hashed with Argon2id. Emails are
normalized to lowercase for registration and login. Token responses have
`access_token`, `refresh_token`, `token_type`, `expires_in` (seconds), and `user`.
The profile contains only the account ID, name, and email.

Access tokens expire after 15 minutes by default; refresh sessions expire after
30 days. Configure `ACCESS_TOKEN_EXPIRE_MINUTES` and `REFRESH_TOKEN_EXPIRE_DAYS`
to change those durations. Only a SHA-256 digest of each random refresh token
is stored. Refresh consumes the old session atomically and returns a new token
pair. The client must replace both tokens and serialize its refresh requests;
reusing the old refresh token returns 401. Access tokens tied to the old session
also become invalid after refresh or logout. Logout is idempotent and leaves
other login sessions active.

Use HTTPS for deployed clients. The extension's dashboard uses these JSON token
endpoints and keeps tokens in Chrome session storage. A separately hosted
first-party dashboard would need its own cookie/token-storage policy. Password reset,
email verification, and email address changes are not implemented yet.

Profile editing accepts only a display name of 1–120 characters, trims leading
and trailing whitespace, and rejects blank names. The response has the same
`id`, `name`, and `email` fields as `GET /users/me` and disables caching. Extra
fields, including email, password, and account IDs, return 422. Only the
authenticated user's name changes; existing sessions remain valid. No schema
migration is needed. The dashboard's **Your profile** section edits this name
and updates the shared extension session under the account Web Lock.

Account deletion requires a valid access token and the current password in a
JSON body. It deletes the authenticated user's profile, all saved analyses,
findings, commitments, account reminders, and every refresh session in one
transaction. Access and refresh tokens from all that account's sessions become
invalid. A missing or expired session returns 401; an incorrect current password
returns 403 with `ACCOUNT_PASSWORD_INCORRECT`, preserving the client's session.
Invalid input returns 422. Requests cannot choose another account ID, and deletion attempts
share the auth rate limit described below. No schema migration is needed.

Deletion is permanent. Clients must show the affected data and obtain explicit
confirmation before calling this endpoint, then clear their stored account
tokens after success. Browser-local reminders remain on the device and must be
managed separately. The dashboard's **Delete your account** section explains
the effects, requires the current password and explicit confirmation, and clears
local account tokens after a successful deletion.

Set a unique random `JWT_SECRET` of at least 32 bytes outside development; the
service rejects the shipped placeholder values in other environments. Signing
and validation are restricted to HS256 with issuer, audience, expiration, and
session checks. Token and profile responses disable caching.

Auth requests share a per-client-IP limit of 20 per minute, configurable using
`AUTH_RATE_LIMIT_PER_MINUTE`; a blocked request returns 429 and `Retry-After`.
The bounded limiter is process-local and uses the ASGI client address. For
multiple workers or replicas, configure shared rate limiting at the trusted
ingress and configure trusted proxy addresses before using forwarded client IPs.

Run `python -m pytest` from `backend/` for all tests. Authentication tests use an
isolated SQLite database and cover registration, password verification, claim
validation, refresh races/reuse, expiration, logout, and session isolation.
SQLite runs by default; PostgreSQL migration and account integration checks,
and the browser account suite, are described below.

Run `python -m ruff check app tests` for backend lint checks. Backend CI enforces
these checks before running migrations and tests.

Backend CI starts an isolated PostgreSQL service and checks migration upgrade,
downgrade, and re-upgrade. It runs the full suite with SQLite, then repeats the
account, history, and account deletion API tests with PostgreSQL. For that second run, set
`TEST_DATABASE_URL` to a PostgreSQL database whose name ends in `_test`. Tests
create and delete their own temporary schemas in that database; use a dedicated
test database.

Frontend CI also runs `npm run test:integration` from `extension/` against the
real FastAPI app, using the deterministic AI provider and an isolated temporary
SQLite database. It covers registration, sign-in, guest analysis, explicit
saving, report display, ownership, deletion, and logout through the dashboard
and its shared clients. See `extension/README.md` for local setup. This suite
does not replace PostgreSQL migration checks or manual popup permission checks.

## Saved analyses and dashboard

Run `alembic upgrade head` before using history. Migration `0002_saved_reports`
adds a nullable JSON snapshot of the server-generated structured report to each
analysis. Existing records remain available in history with
`report_available: false`; they can be deleted but have no full report to open.

`POST /api/v1/analyses` saves only when `save_to_history` is explicitly `true`
and a valid bearer access token is supplied. Guest saves return 401. The default
remains an ephemeral guest analysis, including when a user is signed in. The
saved response contains its `analysis_id`. Snapshots retain findings, evidence
excerpts, timeline rules, and score explanations; submitted page sections are
not persisted. Relative commitments remain relative until a user confirms a time.

| Authenticated route | Behavior |
| --- | --- |
| `GET /api/v1/analyses` | Own history; `offset`, `limit` (1–100), `risk_band`, `date_from`, `date_to` |
| `GET /api/v1/analyses/{id}` | Own full saved report |
| `DELETE /api/v1/analyses/{id}` | Delete own analysis and related findings, commitments, account reminders |
| `GET /api/v1/dashboard/summary` | Own counts, average scored risk, and risk distribution |

Date filters use inclusive UTC calendar dates. Results sort newest first with an
ID tie-breaker. Missing records and another user's records both return 404.
The average excludes analyses with no score. All history responses disable caching.
Deleting account data has no effect on browser-local reminders; the dashboard
explains this before deletion. Repeated explicit saved analyses create separate
history entries.

The extension's **Sign in / dashboard** link opens its full-page dashboard.
It provides registration, sign-in, filters, pagination, report inspection,
deletion, and browser reminder management. The local development version is at
`http://localhost:5173/#dashboard` after starting the extension's Vite dev server.
Account tests cover history ownership, explicit save consent, filtering,
pagination, summary calculations, and cascading deletion using SQLite. Offline
PostgreSQL migration SQL can be checked with `alembic upgrade head --sql`.

## Account reminders

Migration `0003_account_reminders` adds confirmed event times, IANA timezones,
event notes and per-user idempotency keys. Apply migrations before using them.

| Route under `/api/v1` | Behavior |
| --- | --- |
| `GET /commitments` | Own saved commitments, with bounded offset/limit pagination |
| `GET /reminders` | Own reminders; catches up due times; paginated |
| `POST /reminders` | Confirmed commitment reminder with unique UUID `idempotency_key` |
| `PATCH /reminders/{id}` | Edit active reminder and reset it to scheduled |
| `DELETE /reminders/{id}` | Idempotently cancel own reminder |
| `POST /reminders/{id}/acknowledge` | Mark a due reminder reviewed; repeat-safe |

Create requires `commitment_id`, aware `event_at` and `remind_at` timestamps,
an IANA `timezone`, an `event_description`, `confirmed: true`, and the UUID key.
Edits use the same time/note fields and confirmation, without IDs or a key.
Reminder times must be future and earlier than the confirmed event. All times
are normalized to UTC before storage. Identical create retries return the same
record; changed payloads with the same key return 409. Another owner's records
and unknown IDs return 404. Responses disable caching.

Run `python -m scripts.reminders --loop` as a separate scheduler, or omit
`--loop` for one pass. An atomic scheduled-to-due update is the in-app delivery
mechanism and can be safely retried concurrently. A due notice is not an
acknowledgement; `sent_at` is set only when the user marks it reviewed. No
email or desktop notification is sent. The dashboard polls once per minute
while open. Cancelled rows remain until their report/account is deleted.

## Hosted extraction and input limits

Mock mode is the default. The optional OpenAI adapter is selected with
`LLM_PROVIDER=openai` plus a model, backend-only key, and input/output token
prices. See the runbook before enabling it. Tests use mocked HTTP responses,
including budget rejection, refusal, incomplete responses and provider errors.
No live account/key is required to develop or run the synthetic demo.

Bodies are capped at 1 MB before JSON parsing. Analysis text is capped at
50,000 characters and serialized input at 55,000 characters, with bounded
individual sections and unique section IDs. URLs with credentials are rejected.
Analysis requests share a configurable `ANALYSIS_RATE_LIMIT_PER_MINUTE` (30 by
default) per ASGI client address. Limits are process-local; configure shared
limits at a trusted ingress for multiple workers. Quote and structured numeric
attribute checks reduce unsupported claims but do not establish logical
entailment or legal accuracy. Synthetic metrics are in `docs/ai-evaluation.md`.
