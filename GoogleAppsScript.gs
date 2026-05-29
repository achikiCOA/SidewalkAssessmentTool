const SPREADSHEET_ID = "1vjhv8cJTGXBQ8S_e4-2MBbdXDFqGwqhSuIubEJX2NVk";
const PHOTO_FOLDER_ID = "1x3G-tfnqcWpNOA5fkUfZ5_1VhdDzKiNn";
const SHEET_NAME = "Sidewalk Reports";
const PHOTO_URL_COLUMN = 24;

function doGet() {
  return ContentService
    .createTextOutput("Sidewalk Assessment upload endpoint is running.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function parsePayload(e) {
  if (e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  const raw = e.postData && e.postData.contents ? e.postData.contents : "";

  if (raw.indexOf("payload=") === 0) {
    const encoded = raw.substring("payload=".length);
    return JSON.parse(decodeURIComponent(encoded));
  }

  return JSON.parse(raw);
}

function doPost(e) {
  try {
    const data = parsePayload(e);

    if (data.action === "photo") {
      return handlePhotoUpload(data);
    }

    return handleReportUpload(data);
  } catch (err) {
    console.error(err.stack || err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleReportUpload(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  sheet.appendRow([
    data.reportId,
    data.submittedAt,
    data.reporterName,
    data.email,
    data.latitude,
    data.longitude,
    data.locationAccuracy,
    data.gpsLocked,
    data.address,
    data.assetId,
    data.condition,
    data.severity,
    data.verticalDisplacement,
    data.gapWidth,
    data.obstructionType,
    data.passableWidth,
    data.adaRampNearby,
    data.curbRampCondition,
    data.pedestrianVolume,
    data.schoolTransitProximity,
    data.comments,
    data.photoName,
    data.photoType,
    data.hasPhoto ? "Photo upload pending" : "",
    data.score,
    data.conditionClass,
    data.priorityScore,
    data.priorityClass
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, action: "report" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handlePhotoUpload(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const rowNumber = findReportRow(sheet, data.reportId);
  if (!rowNumber) {
    throw new Error("Could not find report row for photo: " + data.reportId);
  }

  try {
    sheet.getRange(rowNumber, PHOTO_URL_COLUMN).setValue("Photo upload received");

    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const match = String(data.photoData || "").match(/^data:([^;]+);base64,(.+)$/);

    if (!match) throw new Error("Invalid photo data.");

    const contentType = match[1] || "image/jpeg";
    const bytes = Utilities.base64Decode(match[2]);
    const safeName = `${data.reportId}-${data.photoName}`.replace(/[\\/:*?"<>|]/g, "-");
    const file = folder.createFile(Utilities.newBlob(bytes, contentType, safeName));

    sheet.getRange(rowNumber, PHOTO_URL_COLUMN).setValue(file.getUrl());

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: "photo", photoUrl: file.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    sheet.getRange(rowNumber, PHOTO_URL_COLUMN).setValue("Photo upload failed: " + err.message);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, action: "photo", error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function authorizeDrive() {
  const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  const blob = Utilities.newBlob("authorization test", "text/plain", "authorization-test.txt");
  const file = folder.createFile(blob);
  file.setTrashed(true);
}

function findReportRow(sheet, reportId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(reportId)) {
      return i + 2;
    }
  }

  return 0;
}
