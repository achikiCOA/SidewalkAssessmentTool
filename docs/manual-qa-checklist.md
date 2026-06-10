# Manual QA Checklist

Use this checklist before a public deployment or after recorder, map, export, upload, or photo changes. Test on an actual phone when possible, not only desktop responsive mode.

## Test Setup

- Browser: Chrome, Edge, or Safari on a phone.
- Network: test once online and once with poor/offline service.
- Location: test outdoors or near a window for realistic GPS behavior.
- Test files: use one normal photo and one intentionally oversized photo.
- Sample export: `samples/sidewalk-segments-example.geojson`.

## Core App

- [ ] App loads on mobile without console errors.
- [ ] Layout fits the phone screen without tiny buttons or horizontal scrolling.
- [ ] Map renders in Point Inspection mode.
- [ ] Map renders in Recorder Mode.
- [ ] Existing point inspection form still opens and accepts entries.
- [ ] CSV export still works if applicable.

## Recorder Start And Stop

- [ ] Green / Good is the default condition.
- [ ] Start Recording works.
- [ ] Recording status changes visibly after starting.
- [ ] Stop Recording works.
- [ ] Stopping with fewer than 2 accepted GPS points shows an "Are you sure?" confirmation.
- [ ] Recorder controls remain sticky at the bottom of the phone screen.
- [ ] Map remains usable while walking, zooming, and panning.

## GPS Behavior

- [ ] GPS denied behavior shows a clear user-visible error.
- [ ] GPS unavailable behavior shows a clear user-visible error.
- [ ] GPS poor accuracy behavior shows a clear warning and skips poor points.
- [ ] GPS quality indicator is green at 5 m or better.
- [ ] GPS quality indicator is yellow above 5 m through 15 m.
- [ ] GPS quality indicator is red above 15 m.
- [ ] Normal mode records accepted movement greater than 2 meters.
- [ ] High Detail mode records accepted movement greater than 1 meter.
- [ ] Local save survives refresh during an active or paused recording.

## Condition Switching

- [ ] Green, Yellow, and Red buttons are large enough to tap with gloves.
- [ ] Switch Green -> Yellow -> Red -> Green while recording.
- [ ] Current condition display updates prominently after each switch.
- [ ] Haptic feedback occurs on supported phones.
- [ ] New GPS points inherit the current condition after each switch.

## Segments And Review

- [ ] Segments split correctly when condition changes.
- [ ] Segments split correctly after a large GPS gap.
- [ ] Segments split correctly after a long time gap.
- [ ] Segment colors render correctly: Green, Yellow, Red.
- [ ] Yellow/Red review list works.
- [ ] Review filter buttons work.
- [ ] Zoom To fits the selected segment on the map.
- [ ] Mark Reviewed updates the segment review status.
- [ ] Create Detailed Inspection opens the point inspection workflow with segment context.

## Export And Sync Resilience

- [ ] Export Current Session creates valid GeoJSON.
- [ ] Export All Sessions creates valid GeoJSON.
- [ ] Export with no segments shows a useful message instead of a broken file.
- [ ] GeoJSON export imports into ArcGIS Online.
- [ ] Exported GeoJSON coordinates are ordered as longitude, latitude.
- [ ] Sync failure does not lose data.
- [ ] Microsoft Lists / SharePoint upload failure does not delete local data if sync is enabled later.
- [ ] Malformed stored local data shows an error and does not crash the app.

## Photos

- [ ] Capture Photo opens the phone camera or file picker.
- [ ] Normal-size photo attaches successfully.
- [ ] Photo file too large behavior shows a clear warning.
- [ ] Unsupported photo type shows a clear warning.
- [ ] Photo metadata is saved without storing unnecessary personal information in exports.

## Pass Criteria

- [ ] No console errors during normal use.
- [ ] Map loads reliably after switching modes.
- [ ] Recorder starts, pauses, resumes, and stops cleanly.
- [ ] Segments are correctly classified by condition.
- [ ] Yellow and Red segments are reviewable.
- [ ] Exports are valid ArcGIS-compatible GeoJSON.
- [ ] Existing point inspection form still works.
