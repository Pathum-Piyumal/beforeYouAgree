# Render deployment handoff

The requested target is the user's existing Render account. Account access
must be connected before its existing projects, services, database and plans
can be inspected. No deployed URL is implied by this file.

The release source is published on `codex/release-20261117` in
`Pathum-Piyumal/beforeYouAgree`. Frontend and backend GitHub CI passed for code
commit `82b0765`, and `render.yaml` passed Render's official JSON Schema
validation. The Render integration remains uninstalled/unconnected, so the
account's actual resources and live service URLs have not been inspected.

`render.yaml` is a demo Blueprint for a Docker API, static dashboard and private
PostgreSQL database in Singapore. It is an option for a new project, not an
instruction to overwrite an existing account's services. Existing resources
must be identified and reused where appropriate. Auto deploy is disabled so
deployments can be coordinated with migrations and environment configuration.

The API uses a generated JWT secret, production configuration validation,
database connection references and `/health/ready`. It listens on Render's
assigned PORT. Its single-instance demo command migrates before starting.
For a paid production service, use Render's pre-deploy migration support and
the ordinary `python -m scripts.serve` command instead. Reminder listing catches
up due notices; an always-on separate scheduler needs an appropriate worker
or cron resource and an agreed plan.

Set CORS_ORIGINS on the API to the actual HTTPS dashboard origin. Set
VITE_API_BASE_URL on the dashboard to the actual HTTPS API URL plus `/api/v1`,
then rebuild the dashboard. Obtain these from Render's returned service URLs;
do not guess them from service names. Rebuild the extension with that API URL
and its exact manifest host permission, retaining the local build separately.
Hosted AI stays disabled until the operator deliberately configures credentials,
model, prices and provider data policy.

The demo Blueprint deliberately uses free compute. Render's
[free-service documentation](https://render.com/docs/free) states that free web
services can sleep and free PostgreSQL expires after 30 days and has no backups.
Those limits make this a disposable demo, not durable production hosting.
Inspect the user's existing plans and retention requirements before choosing
resources; changing to paid plans requires the account owner's budget choice.

Before declaring deployment complete, verify a successful deploy status,
public liveness/readiness, dashboard registration and sign-in, a guest analysis,
an explicit saved report, a confirmed account reminder, cross-account ownership,
and cleanup of synthetic test data. Record service URLs/IDs and the deployed
Git commit without recording secrets. The [Blueprint specification](https://render.com/docs/blueprint-spec)
is the authority for resource fields and reference semantics.
