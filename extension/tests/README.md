# Extraction fixtures

These synthetic local pages exercise the first extractor slice:

- `free-trial.html` — trial, recurring charge, and cancellation evidence.
- `subscription.html` — renewal and notice language.
- `refund.html` — refund window and exclusion.
- `privacy.html` — collection and sharing language.
- `irrelevant.html` — non-agreement content that should not create a risk finding.

Load a fixture through a local static server when manually checking the unpacked
extension. The content script only sends bounded visible sections after the
popup requests them.
