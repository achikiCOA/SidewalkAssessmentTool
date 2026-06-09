# Security Notes

## Data Collected

This app may collect the following data during field use:

- GPS coordinates for point inspections
- GPS walking paths for Recorder Mode
- Sidewalk condition selections and measurements
- Notes and comments entered by the user
- Photo files and photo metadata
- Optional name and email/contact information
- Locally generated report/session identifiers

Recorder GeoJSON exports omit inspector names by default. Inspector names are included only when the user explicitly enables that option before export.

## Where Data Is Stored

- Point inspection drafts and saved reports are stored in the browser using `localStorage`.
- Recorder sessions, raw GPS points, generated segments, notes, and photo metadata are stored in the browser using `localStorage`.
- Photos selected for point inspections may be resized in the browser and sent to the configured upload endpoint when one is configured.
- Recorder photos are currently stored as metadata only, not full image data.
- If an upload endpoint is configured, submitted point inspection data may be sent to that endpoint.

The browser storage is local to the device/browser profile. Clearing browser data may remove saved reports and recorder sessions.

## Risk Notes

- GPS paths can reveal where a field user walked and when.
- Photos may contain people, vehicles, addresses, or other sensitive details.
- Name/email fields are optional but may identify the inspector.
- Public frontend code must not contain secrets, API keys, tenant IDs, bearer tokens, usernames, passwords, or private service endpoints.
- Upload endpoint URLs should be treated as configuration and should not be hardcoded into the public frontend.
- `localStorage` is not encrypted and should not be used for secrets.
- Large photos or too many local sessions may exceed browser storage limits.

## Current Hardening

- Upload URLs must be valid HTTPS URLs before being saved or used.
- Recorder GeoJSON export validates `FeatureCollection` and `LineString` geometry before download.
- Photo uploads are limited by file count, file type, per-file size, and total size.
- The app warns when local browser storage gets large.
- Recorder Mode warns before leaving while recording or paused.
- User-entered values rendered in review panels use DOM text assignment where practical.

## Future Authentication Recommendations

- Add authenticated backend upload endpoints before accepting sensitive production submissions.
- Use Microsoft Entra ID / Azure AD for Microsoft Lists or SharePoint integration.
- Use server-side token handling for ArcGIS or Microsoft Graph; do not place bearer tokens in the frontend.
- Consider role-based access for administrators, reviewers, and field inspectors.
- Consider a backend API that validates payloads, rate-limits submissions, strips unexpected fields, and writes to ArcGIS/Microsoft systems.
- Consider moving recorder storage from `localStorage` to IndexedDB for larger offline datasets.
- Consider encryption-at-rest on managed devices if recorder sessions may include sensitive locations or photos.
