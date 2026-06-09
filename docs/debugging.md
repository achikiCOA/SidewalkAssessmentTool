# Debugging Guide

## Turning On Debug Logs

The frontend has a `DEBUG` constant in `index.html`.

```js
const DEBUG = false;
```

Set it to `true` only while diagnosing a problem. When `DEBUG` is `true`, `debugLog()` writes structured messages to the browser console.

Set it back to `false` before public deployment.

## Opening Browser Console

On desktop:

1. Open the app in Chrome or Edge.
2. Press `F12`.
3. Click `Console`.
4. Reproduce the problem.
5. Look for messages that start with recorder, GPS, upload, export, or map wording.

On a phone, testing is easier if you first reproduce the problem on a desktop-sized mobile emulator in browser developer tools.

## Common Problems

### Map Does Not Load

Check:

- Internet connection is available.
- Leaflet scripts loaded.
- The map container is visible before map size calculations.
- Console does not show `Map initialization failed`.

Try:

- Refresh the page.
- Open the app with a cache-busting URL, such as `?v=test`.

### GPS Unavailable Or Permission Denied

Check:

- Browser location permission is allowed.
- Device location services are turned on.
- The page is loaded over `https://`.
- The browser console does not show `GPS lookup failed` or `Recorder GPS watch failed`.

Try:

- Tap `Improve GPS`.
- Stand still for a few seconds.
- Move away from buildings or tree cover.

### Poor GPS Accuracy

Recorder Mode rejects GPS points worse than `15 m`.

If the app says poor GPS accuracy:

- Wait a few seconds.
- Move to a clearer outdoor area.
- Use `Improve GPS` before starting.

### Recorder Starts But No Segments Appear

Segments need at least two accepted GPS points.

Check:

- GPS accuracy is `15 m` or better.
- You walked at least `1 m` from the last accepted point.
- You did not stop immediately after starting.

### Export Fails

GeoJSON export validates before download.

Check:

- There is at least one saved or current recorder session.
- The session has generated segments.
- Each segment has at least two coordinates.

If export succeeds, the downloaded file should be named:

```text
sidewalk-segments-YYYY-MM-DD.geojson
```

### Upload Or Sync Fails

Uploads require a valid `https://` endpoint configured in app settings.

Check:

- Open the app with `?settings=1`.
- Confirm the Upload Endpoint URL is present and starts with `https://`.
- Confirm the endpoint is still deployed and available.

If sync fails, data should still remain saved locally in the browser.

### Local Data Looks Wrong

The app reads saved local data defensively. If malformed data is found, it shows a visible error and logs details when `DEBUG` is enabled.

Try:

- Export any needed local data first.
- Clear old local recorder sessions from Recorder Mode.
- Use a fresh browser profile for testing.

## What To Report To A Developer

When asking for help, include:

- The page URL.
- What button you tapped.
- The exact visible error message.
- Whether GPS permission was allowed.
- Whether you were online or offline.
- The browser and device.
- Any console messages shown while `DEBUG = true`.
