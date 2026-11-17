# Release status — 2026-11-17

The locally runnable release is implemented. Render deployment is requested
and prepared, but is not complete until the user's Render account is connected,
the target resources are inspected, source is published and live checks pass.
No production URL or live-model result is claimed.

## Implemented

- MV3 popup, typed messaging, extraction across five fixtures, hidden/private
  field exclusions, manual paste, full text review and explicit analysis consent.
- Bounded API input, a deterministic demo provider and optional OpenAI structured
  extraction adapter, evidence/attribute checks, qualified versioned risk scores
  and source-linked timelines that preserve unknown dates.
- Registration, rotating sessions, logout, display-name editing, password-
  confirmed account deletion, explicit saved history, ownership, filters and
  report inspection.
- Device-local reminders and distinct account reminders, confirmed event/time
  inputs, idempotent creates, edit/cancel, atomic due scheduling and user
  acknowledgement. Account reminders are in-app only.
- Separate extension and standalone dashboard builds, bundled privacy pages,
  container/migration/scheduler commands, release packaging with hashes,
  synthetic evaluation, architecture/ERD, privacy and operating documentation.

## Verified locally

| Check | Result |
| --- | --- |
| Backend pytest | 93 passed |
| PostgreSQL account/history/profile/reminder integration | 55 passed |
| PostgreSQL migration upgrade/downgrade/re-upgrade | Passed through 0003 |
| Extension account/reminder unit tests | 18 passed |
| Chromium unpacked-extension and compiled-dashboard tests | 3 passed |
| Browser workflow against the real API | Passed, including manual analysis and account reminder editing |
| TypeScript and frontend/backend lint | Passed |
| Extension and standalone dashboard builds | Passed |
| Backend Docker image | Built; readiness, guest-analysis and scheduler smoke checks passed |
| Complete-stack Compose configuration | Validated without printing secrets |
| Synthetic mock extraction evaluation | 18 cases; see measured report and limitations |
| Release-branch GitHub Frontend CI | Passed for code commit `82b0765` |
| Release-branch GitHub Backend CI | Passed for code commit `82b0765` |
| Render Blueprint official JSON Schema | Passed; account/resource checks still pending |

Screenshots and build ZIPs with SHA-256 sidecars are generated under `release/`.
The packaging script includes the backend source/configuration and excludes
runtime environments and credentials. The published source is on
`codex/release-20261117`. Both remote workflows for code commit `82b0765` passed:
[Frontend CI](https://github.com/Pathum-Piyumal/beforeYouAgree/actions/runs/44011432581)
and [Backend CI](https://github.com/Pathum-Piyumal/beforeYouAgree/actions/runs/44011432395).
Render's official JSON Schema accepts the Blueprint. This does not verify
account access, resource availability, existing-service compatibility or a
successful external deployment.

## Engineering decisions

The dashboard shares source/types/components with the extension but has an
independent entry/build. Linked policies are opened separately; automatic
crawling is intentionally absent. Reminders use durable in-app state rather
than email or desktop channels. Optional hosted AI is disabled by default.
The initial synthetic corpus is author-labelled; its challenge split is not
an independently held-out scientific evaluation. An existing process-local
limiter design is retained with deployment ingress guidance.

## External acceptance still required

1. Connect the selected Render account and identify/reuse its services/database.
   Choose an appropriate retention/compute plan before provisioning paid or
   disposable resources. Set exact HTTPS origins and deploy verified source.
2. Validate hosted AI with the operator's real account, model, prices and data
   policy. Automated tests mock the HTTP provider; no paid calls were made.
3. Manually invoke the real Chrome action on supported pages and check activeTab
   behavior. The browser suite installs the extension and tests extraction,
   unavailable-page handling and manual-input analysis; it does not simulate
   the browser's actual action-permission gesture.
4. Human peer/security/accessibility review, representative independent AI
   annotation, usability study, demo recording and any university submission.
   No human results, approvals or academic claims have been fabricated.

Email verification, password reset, email-address editing, automatic policy
crawling, desktop/email notifications and the P2 enhancements remain outside
this implemented release. These are recorded as limitations, not working
features.
