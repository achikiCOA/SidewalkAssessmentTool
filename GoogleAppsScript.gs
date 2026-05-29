const SPREADSHEET_ID = "1vjhv8cJTGXBQ8S_e4-2MBbdXDFqGwqhSuIubEJX2NVk";
const PHOTO_FOLDER_ID = "1x3G-tfnqcWpNOA5fkUfZ5_1VhdDzKiNn";
const SHEET_NAME = "Sidewalk Reports";
const PHOTO_URL_COLUMN = 23;
const ARCGIS_LAYER_URL = "https://services2.arcgis.com/2zE4x6y8cTIstSBE/arcgis/rest/services/Sidewalk_Assessment_Reports/FeatureServer/0";

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

  try {
    addArcGISFeature(data, "");
  } catch (arcgisErr) {
    console.error("ArcGIS add feature failed: " + (arcgisErr.stack || arcgisErr.message));
  }

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
    const photoUrl = file.getUrl();

    sheet.getRange(rowNumber, PHOTO_URL_COLUMN).setValue(photoUrl);

    try {
      updateArcGISPhotoUrl(data.reportId, photoUrl);
    } catch (arcgisErr) {
      console.error("ArcGIS photo URL update failed: " + (arcgisErr.stack || arcgisErr.message));
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: "photo", photoUrl: photoUrl }))
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

function authorizeArcGIS() {
  const token = getArcGISToken();
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, hasToken: Boolean(token) }))
    .setMimeType(ContentService.MimeType.JSON);
}

function addArcGISFeature(data, photoUrl) {
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("ArcGIS feature was not created because latitude/longitude were invalid.");
  }

  const feature = {
    attributes: buildArcGISAttributes(data, photoUrl),
    geometry: {
      x: lng,
      y: lat,
      spatialReference: { wkid: 4326 }
    }
  };

  const result = arcGISPost(ARCGIS_LAYER_URL + "/addFeatures", {
    features: JSON.stringify([feature])
  });

  if (!result.addResults || !result.addResults[0] || !result.addResults[0].success) {
    throw new Error("ArcGIS addFeatures failed: " + JSON.stringify(result));
  }

  return result.addResults[0];
}

function updateArcGISPhotoUrl(reportId, photoUrl) {
  if (!reportId || !photoUrl) return null;

  const objectInfo = findArcGISObject(reportId);
  if (!objectInfo) return null;

  const attributes = { photoUrl: photoUrl };
  attributes[objectInfo.objectIdFieldName] = objectInfo.objectId;

  const result = arcGISPost(ARCGIS_LAYER_URL + "/updateFeatures", {
    features: JSON.stringify([{ attributes: attributes }])
  });

  if (!result.updateResults || !result.updateResults[0] || !result.updateResults[0].success) {
    throw new Error("ArcGIS updateFeatures failed: " + JSON.stringify(result));
  }

  return result.updateResults[0];
}

function findArcGISObject(reportId) {
  const safeReportId = String(reportId).replace(/'/g, "''");
  const result = arcGISPost(ARCGIS_LAYER_URL + "/query", {
    where: "reportId='" + safeReportId + "'",
    returnIdsOnly: "true"
  });

  if (!result.objectIds || !result.objectIds.length) return null;

  return {
    objectId: result.objectIds[result.objectIds.length - 1],
    objectIdFieldName: result.objectIdFieldName || "OBJECTID"
  };
}

function buildArcGISAttributes(data, photoUrl) {
  return {
    reportId: textValue(data.reportId),
    submittedAt: textValue(data.submittedAt),
    reporterName: textValue(data.reporterName),
    email: textValue(data.email),
    locationAccuracy: intValue(data.locationAccuracy),
    gpsLocked: textValue(data.gpsLocked),
    address: textValue(data.address),
    condition: textValue(data.condition),
    severity: intValue(data.severity),
    verticalDisplacement: numberValue(data.verticalDisplacement),
    gapWidth: numberValue(data.gapWidth),
    obstructionType: textValue(data.obstructionType),
    passableWidth: numberValue(data.passableWidth),
    adaRampNearby: textValue(data.adaRampNearby),
    curbRampCondition: textValue(data.curbRampCondition),
    pedestrianVolume: textValue(data.pedestrianVolume),
    schoolTransitProximity: textValue(data.schoolTransitProximity),
    comments: textValue(data.comments),
    photoUrl: textValue(photoUrl),
    score: intValue(data.score),
    conditionClass: textValue(data.conditionClass),
    priorityScore: intValue(data.priorityScore),
    priorityClass: textValue(data.priorityClass)
  };
}

function arcGISPost(url, extraPayload) {
  const payload = Object.assign({
    f: "json",
    token: getArcGISToken()
  }, extraPayload);

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    payload: payload,
    muteHttpExceptions: true
  });

  const text = response.getContentText();
  const result = JSON.parse(text);

  if (result.error) {
    throw new Error("ArcGIS REST error: " + JSON.stringify(result.error));
  }

  return result;
}

function getArcGISToken() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty("ARCGIS_USERNAME");
  const password = props.getProperty("ARCGIS_PASSWORD");

  if (!username || !password) {
    throw new Error("Missing Apps Script properties ARCGIS_USERNAME and ARCGIS_PASSWORD.");
  }

  const response = UrlFetchApp.fetch("https://www.arcgis.com/sharing/rest/generateToken", {
    method: "post",
    payload: {
      f: "json",
      username: username,
      password: password,
      client: "referer",
      referer: "https://script.google.com",
      expiration: 60
    },
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (!result.token) {
    throw new Error("ArcGIS token request failed: " + JSON.stringify(result));
  }

  return result.token;
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function intValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
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
