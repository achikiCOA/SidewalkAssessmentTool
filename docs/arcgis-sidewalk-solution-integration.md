# ArcGIS Sidewalk Solution Integration Guide

This guide explains how to use the deployed ArcGIS Sidewalk Solution as the official sidewalk system while keeping the existing Sidewalk Assessment Tool as a lightweight public/staff intake app.

## Recommended Architecture

Use ArcGIS as the system of record:

```text
Public/staff user
  -> Sidewalk Assessment Tool
  -> Google Apps Script backend
  -> ArcGIS Sidewalk Solution feature layers
  -> ArcGIS dashboards, viewers, managers, and field maps
```

Keep Google Sheets as a backup/log, not the authoritative GIS database.

## Item Review

| Item | Type | Purpose | Recommended Use |
| --- | --- | --- | --- |
| Compliance Viewer | Experience Builder app | Public/internal compliance view | Use for leadership/public review after data is loaded. |
| Management Center | Experience Builder app | Central management hub | Use as staff home base for dashboards, maps, assignments, and review. |
| Defect and Request Manager | Instant Apps Manager | Triage defects and requests | Use for staff review of public requests and defects. |
| Sidewalk Editor | ArcGIS item/app | Editing interface | Use for GIS/staff edits to sidewalk assets. |
| Request Dashboard | Dashboard | Request metrics and status | Use for monitoring incoming requests and backlog. |
| Sidewalk Request Survey Form | Survey123 form | Esri-provided request form | Keep as fallback or internal option; your app can remain the custom public intake form. |
| Sidewalk audit quick capture | QuickCapture project | Fast staff field capture | Use for staff rapid capture if it fits the workflow. |
| Sidewalk Score Notebook | Notebook | Scoring/data processing | Use for batch scoring after data is in the solution layers. |
| Sidewalk Data Management | ArcGIS item/app | Data management tool | Use for admin/data stewardship tasks. |
| Curb Ramp Compliance Viewer | Viewer app | Curb ramp compliance view | Use for curb ramp-specific review. |
| Sidewalk Assignments | Workforce/project item | Assignment management | Use for assigning inspections to staff. |
| Sidewalk Assignments Dispatcher Map | Web map | Dispatcher map | Use to create/manage staff assignments. |
| Sidewalk Audit Map | Web map | Audit collection map | Use with Field Maps/QuickCapture for staff audits. |
| Sidewalk Compliance Viewer | Web map/app | Sidewalk compliance view | Use for viewing compliance results. |
| Sidewalk Defect and Request Manager Map | Web map | Manager map backing request manager | Keep as the operational map for request/defect triage. |
| Sidewalk Editor Map | Web map | Editor map backing sidewalk editor | Use for staff editing. |
| Sidewalk Field Map | Web map | Field Maps collection map | Use for staff field collection. |
| Sidewalk Management Curb Ramps Map | Web map | Curb ramp management | Use for curb ramp assets and compliance. |
| Sidewalk Management Sidewalks Map | Web map | Sidewalk management | Use for sidewalk assets and compliance. |
| Sidewalk Request Dashboard Map | Web map | Dashboard map | Use as the spatial source for dashboard widgets. |

## Feature Layer Review

These are the FeatureServer services you listed. Open each service URL in a browser and click each layer number to confirm geometry type and fields.

| Service | Likely Purpose | Use As Write Target? | Notes |
| --- | --- | --- | --- |
| `Requests_sidewalk_.../FeatureServer` | Managed sidewalk requests/defects | Probably yes, after field review | Use if this is the authoritative request layer. |
| `Requests_submit_.../FeatureServer` | Public Survey123/request submission layer | Yes for public intake | Best candidate for your custom public request form. |
| `Sidewalks_view_.../FeatureServer` | Hosted view of sidewalks | Usually no | Use for viewing/filtering. Avoid writing to views unless Esri solution expects it. |
| `Sidewalks_.../FeatureServer` | Authoritative sidewalk assets | Yes for staff/asset updates | Best candidate for official sidewalk line asset storage. |
| `workforce_.../FeatureServer` | Workforce assignments | Only through Workforce workflow unless verified | Use for assignment status, not public requests. |

## Step 1: Identify Exact Layer URLs

The Apps Script can now accept either:

```text
https://.../FeatureServer
```

or:

```text
https://.../FeatureServer/0
```

If you only have the parent `FeatureServer` URL, paste that into the script property. The backend will try to find the first matching point or line layer automatically.

For every FeatureServer service, you can still inspect it manually:

1. Open the service URL.
2. Look under **Layers**.
3. Click each layer number, such as `0`, `1`, or `2`.
4. Confirm:
   - layer name
   - geometry type: point, polyline, polygon, or table
   - fields
   - whether editing is enabled
   - whether attachments are enabled
5. Copy the final layer URL ending in `/FeatureServer/0`, `/FeatureServer/1`, etc.

Example:

```text
https://services2.arcgis.com/.../FeatureServer/0
```

Use the parent `/FeatureServer` URL if that is all ArcGIS shows you. Then run `testArcGISSolutionSetup()` in Apps Script to confirm the backend resolved it to a numbered layer.

## Step 2: Recommended App-to-Layer Mapping

Set the Apps Script properties this way after confirming layer indexes:

| Apps Script Property | Point It To |
| --- | --- |
| `ARCGIS_LAYER_URL` | The solution request/defect point layer, probably `Requests_submit.../FeatureServer/0` or `Requests_sidewalk.../FeatureServer/0`. |
| `ARCGIS_SEGMENT_LAYER_URL` | The official sidewalk line asset layer if you want staff-created line reports to create/update line features. |
| `ARCGIS_RECORDER_SEGMENT_LAYER_URL` | A separate recorder observation line layer if available. Recommended if phone GPS recorder lines should remain review-only. |
| `ARCGIS_BLOCK_LAYER_URL` | The official sidewalk asset/block layer if it has `blockId`/`segmentID` and status fields. |

Recommended: keep recorder segments separate from official sidewalk assets until staff review them.

## Step 3: Configure Corporation Limit

Create or identify a hosted polygon layer for the city corporation limit.

If you already have a corporation limit layer:

1. Open the layer item in ArcGIS Online.
2. Confirm it has one polygon for the current city boundary.
3. Name it clearly, for example `Athens Corporation Limit`.
4. Add it to:
   - Sidewalk Management Sidewalks Map
   - Sidewalk Field Map
   - Sidewalk Audit Map
   - Compliance Viewer maps
   - Management Center maps

If you only have a shapefile/GeoJSON:

1. Go to ArcGIS Online **Content**.
2. Click **New item**.
3. Upload the boundary file.
4. Publish it as a hosted feature layer.
5. Name it `Athens Corporation Limit`.
6. Share it with the same groups as the sidewalk solution.

Use the corporation limit to:

- visually show the working area
- filter dashboards to city limits
- clip or QA sidewalk segments
- avoid accepting requests outside the city

## Step 4: Configure Streets And Block Assignments

The spreadsheet `Athens_Sidewalk_Inventory_Master.xlsx` is useful as a block assignment list, but it does not contain geometry. It can support search and assignment, but it cannot draw block lines unless matched to GIS line geometry.

The current app already includes the spreadsheet-derived static block list in:

```text
src/blockAssignments.js
```

Use this as a lightweight block picker.

Recommended ArcGIS setup:

1. Create a hosted table called `Sidewalk Block Inventory`.
2. Import the spreadsheet tab `Sidewalk Inventory`.
3. Preserve these fields:
   - `segmentID`
   - `streetName`
   - `fromStreet`
   - `toStreet`
   - `sidewalkLocation`
   - `inspectionStatus`
   - `priority`
   - `dateInspected`
   - `inspector`
   - `notes`
   - `lastUpdated`
4. If the official `Sidewalks` line layer has matching segment IDs, relate/join the table to the line layer using:

```text
segmentID
```

If the official sidewalk line layer does not have `segmentID`, add a text field such as:

```text
segmentID
```

Then populate it so the spreadsheet/table and GIS features can be matched.

## Step 5: Decide What Your Existing App Should Do

Keep your app for:

- simple public request intake
- custom plain-language UX
- photo collection
- backup logging to Google Sheets
- lightweight block selection
- optional rough recorder observations

Use ArcGIS apps for:

- official asset editing
- staff assignments
- compliance dashboards
- authoritative sidewalk/curb ramp geometry
- formal field audits

Do not make the custom app the authoritative sidewalk asset editor unless there is a strong reason.

## Step 6: Update Google Apps Script Properties

In Apps Script, go to **Project Settings** -> **Script Properties**.

Required:

```text
SPREADSHEET_ID
SHEET_NAME
PHOTO_FOLDER_ID
ARCGIS_USERNAME
ARCGIS_PASSWORD
ARCGIS_LAYER_URL
ARCGIS_SEGMENT_LAYER_URL
ARCGIS_BLOCK_LAYER_URL
```

Recommended if recorder observations should stay separate:

```text
ARCGIS_RECORDER_SEGMENT_LAYER_URL
```

Point these to the ArcGIS Sidewalk Solution layers after you confirm the exact `/FeatureServer/n` layer URLs.

If you are not sure which numbered layer to use, paste the parent `/FeatureServer` URL. The current backend will resolve it where possible.

After saving properties:

1. Open Apps Script.
2. Select the function `authorizeArcGIS`.
3. Click **Run**.
4. Approve permissions if asked.
5. Select the function `testArcGISSolutionSetup`.
6. Click **Run**.
7. Open **Executions** or **Logs**.
8. Look for `resolvedLayerUrl`.

If `resolvedLayerUrl` appears, that property is working. If an error appears, check the URL, sharing, or ArcGIS credentials.

## Step 7: Field Mapping Strategy

The current Apps Script filters fields before sending to ArcGIS. That means if a field does not exist in the target layer, it is skipped instead of breaking the whole upload.

For the solution layers, use one of these approaches:

### Option A: Add Custom Fields To Solution Layers

Add fields matching the existing app where useful:

```text
reportId
submittedAt
reporterName
email
reportType
latitude
longitude
locationAccuracy
condition
severity
comments
photoUrl
score
conditionClass
priorityClass
blockId
blockName
```

For recorder segment layer:

```text
segmentId
routeId
blockId
blockName
condition
conditionClass
score
priorityClass
lengthMeters
averageAccuracy
startTime
endTime
pointCount
source
reviewed
notes
photoCount
```

### Option B: Map App Fields To Existing Esri Solution Fields

This is cleaner long term, but requires inspecting the actual layer fields. Use this if the solution already has equivalent fields like request type, status, severity, inspection date, or asset ID.

## Step 8: Configure Editing And Attachments

For each target hosted feature layer:

1. Open the layer item.
2. Go to **Settings**.
3. Enable editing.
4. Allow adds for public/request layers.
5. Allow updates only where staff/backend should update status.
6. Enable attachments if photos should live directly in ArcGIS.

Current app photos are saved to Google Drive and the ArcGIS feature receives a `photoUrl`. That can remain for now. Moving photos to ArcGIS attachments is possible later, but is a separate backend change.

## Step 9: Dashboard And Map Configuration

In the solution maps/apps:

1. Add the corporation limit layer.
2. Add the sidewalk block inventory table or joined layer.
3. Symbolize request status:
   - New
   - In Review
   - Assigned
   - Complete
4. Symbolize sidewalk condition:
   - Good/Green
   - Fair/Yellow
   - Poor/Red
   - Failed/Critical
5. Filter maps/dashboards to the city boundary where appropriate.
6. Configure popups to show:
   - street name
   - from/to street
   - side of street
   - condition
   - priority
   - request ID
   - photo link
   - status

## Step 10: Testing Checklist

Before public deployment:

1. Submit one point request from the custom app.
2. Confirm a Google Sheet row is created.
3. Confirm a feature appears in the selected ArcGIS request layer.
4. Attach a photo and confirm `photoUrl` updates.
5. Select a block from inventory and record a short route.
6. Confirm recorder sync log receives:
   - `blockId`
   - `blockName`
   - `blockStreetName`
   - `blockFromStreet`
   - `blockToStreet`
   - `blockSideOfStreet`
7. Confirm recorder segments either go to the review layer or stay local if no recorder layer is configured.
8. Confirm dashboards update.
9. Confirm public users cannot edit authoritative sidewalk assets directly.

## Immediate Recommendation

Use this setup first:

```text
Custom app point reports -> Requests_submit layer
Custom app photos -> Google Drive photo folder, photoUrl in ArcGIS
Recorder Mode -> separate recorder/review segment layer
Block picker -> spreadsheet-derived inventory list for now
Official sidewalk edits -> ArcGIS Sidewalk Editor / Field Maps
Dashboards/viewers -> ArcGIS solution apps
```

This keeps the system practical, reduces risk, and avoids turning phone GPS sketches into official sidewalk geometry before staff review.
