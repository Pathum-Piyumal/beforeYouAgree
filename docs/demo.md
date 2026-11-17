# Synthetic demo and acceptance walkthrough

1. Start PostgreSQL, migrate, and run the API in mock mode. Build/load the
   unpacked extension. Serve fixtures from `extension/tests/fixtures` with
   `python -m http.server 8080`.
2. Open `http://localhost:8080/free-trial.html`. Inspect the page, open the full
   text review, confirm it contains the $49.99 clause, and check consent. Analyze.
   Show evidence, the qualified score and the relative seven-day trial timeline.
   Explain that an unknown signup time is not converted into today's date.
3. Open refund and privacy fixtures. Re-inspect and analyze each. Open the
   irrelevant recipe fixture to demonstrate insufficient evidence rather than
   a claim that an agreement is safe. Show manual paste for inaccessible content.
4. Register in the dashboard. Analyze as guest once, then explicitly save a
   second analysis. Verify only the saved report appears in history. Apply filters,
   open the report, and explain which data was retained.
5. On a saved commitment, set an account reminder with a confirmed event time
   and an earlier reminder time. Edit it and cancel it. Show that browser-local
   reminders are a separate device feature. Due account reminders can be marked
   reviewed; the scheduler never equates due status with user acknowledgement.
6. Change the display name and observe another extension dashboard tab update.
   Sign out from one tab and verify the other clears. With a second account,
   confirm that the first account's saved data is absent.
7. Delete a saved report and confirm the related account commitments/reminders
   disappear. Demonstrate account deletion only using a disposable synthetic
   account, after reviewing its password-confirmed deletion form.

Record browser version, backend commit, provider mode, test environment and any
observed limitations alongside a demo recording. Do not claim a live-provider
quality study or production performance result from mock-mode demonstrations.
