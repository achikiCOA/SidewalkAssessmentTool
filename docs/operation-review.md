# Operation Review - November 9, 2026

## Fixed

- Generic upload failures no longer trigger a second, opaque request that can duplicate submissions or falsely report success.
- Point inspection success messages distinguish confirmed HTTP delivery from unconfirmed Google Apps Script delivery.
- Failed or unconfigured uploads keep the form and selected photos available instead of resetting them.
- Retried submissions retain their report ID and replace their local backup instead of adding a second backup.
- Local storage failures stop submission rather than claiming that a backup exists.
- Saved reports tolerate valid JSON with an unexpected shape without breaking the report count.
- Local backup metadata no longer claims photo data is stored when it is omitted.
- Photo validation wording matches the Severe/Missing severity choices.

## Deployment blockers and limitations

- The working copy of GoogleAppsScript.gs is empty (one byte). This is a pre-existing local change. Do not deploy it. The committed version can be recovered from Git history, but the actual deployed Apps Script should be compared first to avoid replacing newer server work.
- The frontend has no default upload endpoint. A fresh student's browser needs an endpoint configured through settings before reports can be sent. Existing settings on the instructor's phone do not transfer to other phones.
- Google Apps Script requests use no-cors: the browser cannot read server errors or confirm database/photo receipt. Check a practice report in the destination spreadsheet and Drive before field testing. Network success alone is not receipt confirmation.
- Local report backups contain details, not photo bytes. On failed uploads keep the form open; original images remain on the phone. Unconfirmed delivery cannot guarantee photo recovery after leaving the page.
- Generic HTTPS endpoints must support browser CORS. No Microsoft Lists connector is built into this app; a suitable backend is required.
- Recorder and linear assessment accuracy remain experimental; the current student guide recommends Point Issue only.
- No live spreadsheet, Drive, ArcGIS permissions, or Microsoft connection was verified in this pass. Plugin discovery found Google Drive available but not installed; it did not establish backend access. Chat plugins and the app's upload connections are separate.

## Pre-field check

1. Deploy frontend changes through the project's normal release process.
2. On each phone, configure the intended upload endpoint and allow location access.
3. Submit one Point Issue with a photograph. Confirm its report ID, columns, photo file/link, and ArcGIS record at the destination.
4. Test denied GPS permission and manual map positioning.
5. Test with connectivity disabled: report details should save locally, the form should stay open, and the result must not claim upload success.
6. Restore connectivity and retry; confirm the backend handles repeated report IDs without duplicates before using retries in production.

## Verification scope

JavaScript syntax and targeted submission/storage behavior were checked locally. Real phone GPS, camera, touch layout, live backend receipt, and deployment are not certified by these checks.
