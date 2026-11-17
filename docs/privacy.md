# Privacy and permissions

Analysis starts only after you review the extracted text, select consent, and
press Analyze. The extension sends those sections and their source URLs to the
configured backend. In mock mode no external AI service is contacted. If the
operator enables OpenAI, the backend forwards the reviewed text to OpenAI's
Responses API with response storage disabled. Provider-side handling remains
subject to the operator's provider account and data policies; this application
cannot promise zero provider retention. Ask the operator which mode is enabled.

Remove personal information, credentials, payment details and confidential text
before submitting. Extraction excludes forms, editable fields, hidden ancestor
content and marked private elements. It can still include personal information
written in ordinary visible paragraphs; review is essential. Manual paste is
available when extraction is incomplete. Linked policies open separately and
are never fetched automatically. Source URLs may contain query parameters;
remove sensitive query values before manually submitting a URL.

Guest analysis requests do not create database records. A temporary browser
session cache retains structured report excerpts for five minutes; the cache
key is a hash of the URL and sections. Only an explicitly checked account save
creates saved analyses, findings, evidence excerpts and commitments. Full raw
page sections are not retained in the database or application logs. Saved data
remains until you delete the report or account. Database backups can retain
previous snapshots until the operator's stated backup retention period expires.

Account access and refresh tokens are kept in Chrome session storage in the
extension, or tab-scoped sessionStorage in the standalone dashboard. Passwords
are hashed using Argon2id on the backend. Tokens are not sent to content scripts.
Browser-local reminders remain on the device when an account or report is
deleted. Account reminders are stored on the server and cascade with their
commitments. Account deletion requires the current password, deletes owned
records and invalidates every session. Cancelled account reminders remain in
your account until their report or account is deleted.

The extension uses activeTab for the explicitly selected page, storage for
session state and local reminders, and alarms for local reminder timing. Its
content script runs on HTTP(S) pages to respond to inspection requests; it does
not automatically extract, upload, or monitor page contents. The manifest's
host permission is limited to the configured API (localhost by default).
Changing the API origin requires an appropriate host-permission change.

Account and local reminders are in-app notices. There are no email, SMS or
desktop notifications and no delivery guarantee while the browser/dashboard
is closed. The scheduler marks account reminders due; only user acknowledgement
marks them reviewed. This is decision support, not legal advice. Missing
findings, partial coverage and a low score do not establish that an agreement
is safe or enforceable.
