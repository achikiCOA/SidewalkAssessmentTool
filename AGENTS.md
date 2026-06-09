# AGENTS.md

## Project Context

This repository contains a municipal sidewalk assessment web application using:

- HTML/CSS/JavaScript
- Leaflet map
- Browser geolocation
- `localStorage` / IndexedDB as needed
- Microsoft Lists / SharePoint integration
- Optional ArcGIS-compatible GeoJSON export

The app supports point inspections and a continuous GPS sidewalk recorder. It is intended for mobile field use by municipal staff.

## Engineering Rules

- Make small, reviewable changes.
- Do not rewrite unrelated working code.
- Preserve existing map stability fixes.
- Avoid duplicate map initialization.
- Do not hardcode secrets, API keys, tenant IDs, passwords, tokens, or tenant-specific credentials.
- All external endpoints must come from configuration.
- Validate and sanitize all user input before sending it to a backend.
- Add clear error handling for GPS, network, upload, and export failures.
- Keep UI mobile-first.
- Keep functions small and named clearly.
- Add comments only where they explain non-obvious behavior.

## Map And GPS Rules

- Preserve Leaflet `invalidateSize` timing fixes.
- Preserve `ResizeObserver` behavior for map containers.
- Do not initialize the same map container more than once.
- Keep point inspection location behavior separate from recorder GPS tracking behavior.
- Handle GPS unavailable, GPS timeout, and permission denied states with user-facing messages.
- Do not track location unless the user explicitly starts a GPS action or recording.

## Data And Integration Rules

- Save field data locally first when possible.
- Keep local saved data resilient to malformed or outdated stored records.
- GeoJSON exports must be valid `FeatureCollection` objects.
- Recorder line features must classify segments by condition: Green, Yellow, or Red.
- Yellow and Red recorder segments should remain reviewable later.
- Microsoft Lists / SharePoint upload failures must not destroy local data.
- ArcGIS export/sync fields should be documented and stable.

## Testing Rules

- Test on mobile browser dimensions.
- Test GPS unavailable.
- Test GPS permission denied.
- Test offline mode.
- Test switching Green/Yellow/Red.
- Test export with no segments.
- Test export with multiple condition segments.
- Test Microsoft Lists upload failure.
- Test malformed stored local data.

## Definition Of Done

- No console errors.
- Map loads reliably.
- Recorder starts/stops cleanly.
- Segments are correctly classified by condition.
- Exports valid GeoJSON.
- Existing point inspection form still works.
