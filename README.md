# Sidewalk Assessment Tool

A mobile-friendly sidewalk survey form with a Leaflet map, GIS scoring, CSV export, and optional Microsoft 365 spreadsheet upload through Power Automate.

## Publish With GitHub Pages

1. Create a new public GitHub repository.
2. Upload these files to the repository root:
   - `index.html`
   - `SidewalkAssessmentTool.html`
   - `.nojekyll`
   - `README.md`
3. Open the repository settings.
4. Go to **Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the `main` branch and `/ (root)` folder.
7. Save.

After GitHub finishes deployment, the public site URL will look like:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/
```

## Microsoft 365 Upload

The public website needs a backend endpoint to write reports into Excel. The simplest Microsoft 365 option is Power Automate:

1. Create an Excel workbook in OneDrive or SharePoint.
2. Format the report range as a table.
3. Create a Power Automate cloud flow with the trigger **When an HTTP request is received**.
4. Add the Excel action **Add a row into a table**.
5. Map the incoming JSON fields to the Excel table columns.
6. Save the flow and copy the generated HTTP POST URL.
7. Open the published website, expand **Microsoft 365 spreadsheet upload**, paste the URL, and save it.

For a public deployment where every visitor should use the same spreadsheet automatically, put the Power Automate URL directly into `index.html` after the flow is created:

```js
const DEFAULT_UPLOAD_URL = "PASTE-YOUR-POWER-AUTOMATE-URL-HERE";
```

## Report Fields

The form sends these fields:

```text
reportId
submittedAt
reporterName
email
latitude
longitude
address
condition
severity
comments
photoName
photoType
photoData
score
conditionClass
```
