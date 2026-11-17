# Chrome extension

This is the Manifest V3 React/TypeScript extension for Before You Agree.

The [release runbook](../docs/runbook.md) covers the standalone dashboard build,
containers and ZIP packages. The popup now includes full text review, explicit
analysis consent, manual paste, and linked policy discovery without automatic
fetching. The full [privacy notice](../docs/privacy.md) is also bundled as
`privacy.html` in both builds.

## Build

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The Vite build emits `dist/index.html`, `dist/background.js`, `dist/content.js`,
and the copied `dist/manifest.json`. Load the `dist` folder as an unpacked
extension in Chrome.

The popup sends a typed request to the service worker. The service worker routes
that request to the content script in the active tab. Only normal HTTP(S) pages
are supported in this setup chunk; Chrome internal pages and PDFs return a safe
unsupported-page message.

## Local reminders

After analyzing a page, use **Set reminder** on a resolved timeline event.
Review the event note, choose a future time, and confirm before saving.
Reminders are stored in Chrome's local extension storage; their timestamps use
UTC and retain the timezone selected when saved. The popup lists reminders for
the active page and lets you edit or cancel them, including reminders already due.

Chrome alarms mark reminders as due. Opening the popup also checks for missed
times, and the service worker restores missing alarms when it starts. Due
reminders appear in the popup; this version does not send operating system,
email, or server notifications. Reminders are not synced between browsers.

`npm test` requires Node 22.13+ and runs mocked Chrome lifecycle tests covering
concurrent saves, retries, validation, editing, cancellation, alarms, and restart
recovery. To check the UI, load `dist` unpacked in Chrome, create a reminder on
a fixture page, reopen the popup, edit it, and let its time pass. Verify the due
state on reopening, then cancel it. Reload the extension to verify that saved
future reminders remain scheduled.

## Accounts and dashboard

Run the backend with its latest dependencies and apply `alembic upgrade head`.
Rebuild and reload the unpacked extension, then use **Sign in / dashboard** in the
popup to open the full-page dashboard. Register a new account, or sign in with an
existing account. The synthetic seeded account has no usable password.

After signing in, select **Save this analysis to my account** in the popup before
analyzing a page. Saving bypasses the popup's analysis cache and performs a new
analysis. The checkbox defaults to off. The dashboard offers paginated history,
risk and UTC date filters, summary totals, full reports, and deletion. Findings,
evidence excerpts, and commitments are retained on an explicit save; raw page
sections are not. Browser reminders remain local and independent of accounts.

Use **Delete your account** near the bottom of the dashboard to permanently
remove your profile and all saved account data. Review the explanation, enter
your current password, and check the confirmation box before selecting
**Permanently delete account**. You can cancel with **Keep my account**. An
incorrect password leaves you signed in and clears the password field for a new
attempt. Success clears account tokens and account views in every open extension
page; all server sessions are revoked. Browser reminders remain on the device
and can still be managed after deletion.

In **Your profile**, edit **Display name** and select **Save name**. Names are
trimmed and must contain 1–120 characters. **Reset** discards an unsaved edit.
Successful changes update the header and profile form in other open extension
tabs without clearing your current report or filters. Email addresses cannot
be edited. Network and validation errors leave the saved profile intact.

Account tokens use `chrome.storage.session`, accessible only to trusted extension
contexts by default, and are cleared when the extension/browser session ends.
They are never put in local storage or sent to content scripts. Token refresh,
account requests, profile updates, logout, and deletion share a Web Lock across extension pages so rotating
refresh tokens are not used concurrently. Account switches clear stale account
views. If logout cannot contact the API, local credentials are still removed and
the dashboard reports that server revocation could not be confirmed.
See the [Chrome session storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)
and [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

For development, run `npm run dev` and open `http://localhost:5173/#dashboard`.
This mode uses tab-scoped `sessionStorage`; its sign-in state is separate from
the installed extension. Browser reminders require the installed extension.
The manifest grants API access to `http://localhost:8000/*`. If changing
`VITE_API_BASE_URL` to a deployed backend, update `host_permissions` to match that
backend origin, configure CORS for any web development origin, and use HTTPS.

Manual acceptance check: register, analyze once without saving, verify history
is empty, then select saving and analyze again. Refresh the dashboard, open the
saved report, create/edit/cancel a browser reminder, apply history filters, and
delete the saved report. Sign out from a second dashboard tab and verify the
first tab clears its account data. Sign in with a second account and verify it
has its own history. Automated session tests exercise refresh coordination,
expired credentials, login, registration, network failures, and logout cleanup.

To run the unpacked-extension browser smoke test, run the following from
`extension/`:

```powershell
npx playwright install chromium --no-shell
npm run build
npm run test:e2e
```

The test serves a synthetic fixture locally and checks content-script extraction
and the popup's unavailable-page state in Playwright's Chromium. A second test
uses mocked API responses to exercise registration, sign-in errors, history
filtering, report display, deletion, and cross-tab logout. Loading the popup as a
tab does not grant `activeTab`; successful popup inspection still requires a
separate check.

The browser suite also verifies the compiled standalone dashboard at its root
URL, all five extraction fixtures, hidden/private input exclusions, and footer
cancellation evidence. The real-API suite exercises manual popup analysis and
account reminder creation, editing and cancellation. Due/reminder-acknowledgement
and scheduler retry/concurrency behavior are covered by backend tests.

## Browser integration with the real API

Install the backend dependencies in a Python environment, install Playwright's
Chromium as above, then run `npm run test:integration` from `extension/`.
The runner uses the repository-root `.venv` when present, otherwise `python` on
PATH. To select another environment in PowerShell:

```powershell
$env:PYTHON = 'C:\path\to\python.exe'
npm run test:integration
```

This suite launches the real FastAPI app with a new temporary SQLite database
and a Vite dashboard on automatically assigned local ports. It checks browser
registration, guest analysis without persistence, explicit account saving,
saved report parsing and display, ownership enforcement, deletion, logout,
and sign-in. It uses the popup's analysis client directly from the dashboard;
it does not automate the browser's `activeTab` permission grant. No API responses
are mocked. The AI provider remains the deterministic mock provider.

The database is created from SQLAlchemy metadata and removed after the server
shuts down; the suite never uses the configured local database. PostgreSQL and
Alembic migration checks run separately in backend CI. Frontend CI runs both
the unpacked-extension smoke tests and this real-API browser suite.
