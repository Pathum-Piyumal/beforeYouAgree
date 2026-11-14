# Contributing

## Workflow

1. Create a short-lived `feature/<ticket>-<description>` branch.
2. Keep changes focused on one master-plan chunk or ticket.
3. Add or update tests for behavior and error states.
4. Run the relevant frontend and backend checks locally.
5. Open a pull request against `main` and include manual verification steps.

Do not commit `.env` files, credentials, raw agreement text, generated build
artifacts, or unrelated formatting changes. Review browser permissions, API
authorization, privacy impact, and prompt-injection exposure for every feature
that handles page content.
