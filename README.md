# Sidewalk Assessment Tool

Mobile-first municipal sidewalk assessment web app for point inspections and continuous GPS sidewalk recording.

The app uses:

- HTML, CSS, and JavaScript
- Leaflet maps
- Browser geolocation
- Local browser storage for offline resilience
- Optional Google Apps Script / Microsoft Lists / SharePoint style upload endpoints
- ArcGIS-compatible GeoJSON export for recorder segments

No build step is required. GitHub Pages can serve the files directly.

## Project Structure

```text
index.html
SidewalkAssessmentTool.html
src/
  config.js
  map.js
  gpsRecorder.js
  scoring.js
  storage.js
  exportGeoJson.js
  sync.js
  photo.js
  ui.js
docs/
samples/
GoogleAppsScript.gs
SECURITY.md
AGENTS.md
```

`index.html` is the public GitHub Pages entry point. `SidewalkAssessmentTool.html` is kept as a mirrored entry point for the same app and should be deployed with the `src/` folder.

`src/ui.js` currently owns the working application controller and preserves the existing behavior. The other `src/` files provide documented module boundaries and helper APIs for future cleanup by a third-party developer.

## Local Setup

1. Clone or download the repository.
2. Open `index.html` in a browser for a quick static check.
3. For GPS, camera, and local browser permission testing, serve the folder from a local web server or use the GitHub Pages URL.
4. Use a real phone for final QA.

Example local server:

```powershell
npx http-server .
```

The app does not require `npm install` unless you choose to use a local static server package.

## Deployment With GitHub Pages

1. Push the repository to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)` folder.
6. Save.

The public URL will look like:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/
```

After pushing changes, force a fresh browser load with a version query string:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/?v=YYYY-MM-DD
```

## Configuration

Configuration lives in `src/config.js` and user-saved browser settings.

Do not hardcode secrets, usernames, passwords, bearer tokens, tenant IDs, or private endpoints into the public frontend. Public GitHub Pages code is visible to anyone.

Upload endpoints should be entered through the app settings screen or provided by a backend service that is safe to expose.

## Recorder Mode

Recorder Mode continuously tracks GPS after the user taps Start. It stores points locally first, converts them into colored line segments, and exports ArcGIS-compatible GeoJSON.

Recorder conditions:

- Green / Good
- Yellow / Fair
- Red / Poor

Normal mode accepts movement greater than 2 meters. High Detail mode accepts movement greater than 1 meter.

## Point Inspection Mode

Point Inspection mode is the existing detailed inspection workflow. It supports map location, photos, issue types, measurements, scoring, local save, and optional upload.

## Sample Data

Use [samples/sidewalk-segments-example.geojson](samples/sidewalk-segments-example.geojson) to test ArcGIS Online GeoJSON import without collecting a route in the field.

## QA

Use [docs/manual-qa-checklist.md](docs/manual-qa-checklist.md) before public deployment or after changes to maps, GPS, recorder logic, photo handling, upload, or export.

## Maintenance Notes

- Keep changes small and reviewable.
- Preserve Leaflet map stability fixes and `ResizeObserver` behavior.
- Keep DOM selectors centralized through `src/config.js` and `App.dom.field`.
- Validate and sanitize user-entered text before displaying or sending it.
- Keep local save behavior resilient so failed uploads do not destroy field data.
- Avoid adding a build step unless the project truly needs one.
- Keep `index.html` and `SidewalkAssessmentTool.html` in sync when public app behavior changes.

## Useful Checks

Validate JavaScript syntax from the HTML entry points:

```powershell
node -e "const fs=require('fs'); for (const file of ['src/config.js','src/map.js','src/gpsRecorder.js','src/scoring.js','src/storage.js','src/exportGeoJson.js','src/sync.js','src/recorderBlocks.js','src/recorderSync.js','src/photo.js','src/ui.js']) { new Function(fs.readFileSync(file,'utf8')); console.log(file + ' syntax ok'); }"
```

Check for whitespace problems before committing:

```powershell
git diff --check
```
