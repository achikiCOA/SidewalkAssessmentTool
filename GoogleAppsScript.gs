const PHOTO_URL_COLUMN = 23;
const PHOTO_STATUS_COLUMN = 28;
const ARCGIS_STATUS_COLUMN = 29;
const ARCGIS_OBJECT_ID_COLUMN = 30;
const ARCGIS_ERROR_COLUMN = 31;
const BACKEND_VERSION = "2026-06-02-header-mapped-v2";
const REQUIRED_HEADERS = [
  "reportId",
  "submittedAt",
  "reporterName",
  "email",
  "latitude",
  "longitude",
  "locationAccuracy",
  "locationConfirmed",
  "gpsLocked",
  "address",
  "condition",
  "severity",
  "verticalDisplacement",
  "gapWidth",
  "runningSlope",
  "crossSlope",
  "obstructionType",
  "passableWidth",
  "curbRampCondition",
  "detectableWarning",
  "pedestrianVolume",
  "schoolTransitProximity",
  "comments",
  "photoName",
  "photoType",
  "photoUrl",
  "score",
  "conditionClass",
  "priorityScore",
  "priorityClass",
  "photoStatus",
  "arcgisStatus",
  "arcgisObjectId",
  "arcgisError",
  "backendVersion"
];

function doGet() {
  return ContentService
    .createTextOutput("Sidewalk Assessment upload endpoint is running. Backend version: " + BACKEND_VERSION)
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
  const ss = SpreadsheetApp.openById(getRequiredProperty("SPREADSHEET_ID"));
  const sheet = ss.getSheetByName(getRequiredProperty("SHEET_NAME")) || ss.getSheets()[0];
  ensureSheetHeaders(sheet, REQUIRED_HEADERS);
  console.log("Report upload received. reportId=" + data.reportId + ", spreadsheetId=" + ss.getId() + ", sheetName=" + sheet.getName());

  appendObjectRow(sheet, {
    reportId: data.reportId,
    submittedAt: data.submittedAt,
    reporterName: data.reporterName,
    email: data.email,
    latitude: data.latitude,
    longitude: data.longitude,
    locationAccuracy: data.locationAccuracy,
    locationConfirmed: data.locationConfirmed,
    gpsLocked: data.gpsLocked,
    address: data.address,
    condition: data.condition,
    severity: data.severity,
    verticalDisplacement: data.verticalDisplacement,
    gapWidth: data.gapWidth,
    runningSlope: data.runningSlope,
    crossSlope: data.crossSlope,
    obstructionType: data.obstructionType,
    passableWidth: data.passableWidth,
    curbRampCondition: data.curbRampCondition,
    detectableWarning: data.detectableWarning,
    pedestrianVolume: data.pedestrianVolume,
    schoolTransitProximity: data.schoolTransitProximity,
    comments: data.comments,
    photoName: data.photoName,
    photoType: data.photoType,
    photoUrl: data.hasPhoto ? "Photo upload pending" : "",
    score: data.score,
    conditionClass: data.conditionClass,
    priorityScore: data.priorityScore,
    priorityClass: data.priorityClass,
    photoStatus: data.hasPhoto ? "Photo upload pending" : "No photo",
    arcgisStatus: "ArcGIS pending",
    arcgisObjectId: "",
    arcgisError: "",
    backendVersion: BACKEND_VERSION
  });

  const rowNumber = sheet.getLastRow();
  console.log("Report row appended. reportId=" + data.reportId + ", rowNumber=" + rowNumber);

  try {
    const arcgisResult = addArcGISFeature(data, "");
    setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS created", ARCGIS_STATUS_COLUMN);
    setRowValue(sheet, rowNumber, "arcgisObjectId", arcgisResult.objectId || "", ARCGIS_OBJECT_ID_COLUMN);
    setRowValue(sheet, rowNumber, "arcgisError", "", ARCGIS_ERROR_COLUMN);
  } catch (arcgisErr) {
    setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS failed", ARCGIS_STATUS_COLUMN);
    setRowValue(sheet, rowNumber, "arcgisError", arcgisErr.message, ARCGIS_ERROR_COLUMN);
    console.error("ArcGIS add feature failed: " + (arcgisErr.stack || arcgisErr.message));
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, action: "report" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handlePhotoUpload(data) {
  const ss = SpreadsheetApp.openById(getRequiredProperty("SPREADSHEET_ID"));
  const sheet = ss.getSheetByName(getRequiredProperty("SHEET_NAME")) || ss.getSheets()[0];
  ensureSheetHeaders(sheet, REQUIRED_HEADERS);

  const rowNumber = findReportRow(sheet, data.reportId);
  if (!rowNumber) {
    throw new Error("Could not find report row for photo: " + data.reportId);
  }

  try {
    const photoLabel = data.photoTotal ? `${data.photoIndex || 1}/${data.photoTotal}` : "1/1";
    setRowValue(sheet, rowNumber, "photoStatus", "Photo upload received " + photoLabel, PHOTO_STATUS_COLUMN);

    const folder = DriveApp.getFolderById(getRequiredProperty("PHOTO_FOLDER_ID"));
    const match = String(data.photoData || "").match(/^data:([^;]+);base64,(.+)$/);

    if (!match) throw new Error("Invalid photo data.");

    const contentType = match[1] || "image/jpeg";
    const bytes = Utilities.base64Decode(match[2]);
    const safeName = `${data.reportId}-${data.photoIndex || 1}-${data.photoName}`.replace(/[\\/:*?"<>|]/g, "-");
    const file = folder.createFile(Utilities.newBlob(bytes, contentType, safeName));
    const photoUrl = file.getUrl();
    const combinedPhotoUrls = appendCellValue(sheet, rowNumber, "photoUrl", photoUrl, PHOTO_URL_COLUMN);

    setRowValue(sheet, rowNumber, "photoStatus", "Photo uploaded " + photoLabel, PHOTO_STATUS_COLUMN);

    try {
      updateArcGISPhotoUrl(data.reportId, combinedPhotoUrls);
    } catch (arcgisErr) {
      setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS photo update failed", ARCGIS_STATUS_COLUMN);
      setRowValue(sheet, rowNumber, "arcgisError", arcgisErr.message, ARCGIS_ERROR_COLUMN);
      console.error("ArcGIS photo URL update failed: " + (arcgisErr.stack || arcgisErr.message));
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: "photo", photoUrl: photoUrl }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    setRowValue(sheet, rowNumber, "photoStatus", "Photo upload failed", PHOTO_STATUS_COLUMN);
    setRowValue(sheet, rowNumber, "photoUrl", "Photo upload failed: " + err.message, PHOTO_URL_COLUMN);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, action: "photo", error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function authorizeDrive() {
  const folder = DriveApp.getFolderById(getRequiredProperty("PHOTO_FOLDER_ID"));
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

function retryArcGISSync(reportId) {
  const ss = SpreadsheetApp.openById(getRequiredProperty("SPREADSHEET_ID"));
  const sheet = ss.getSheetByName(getRequiredProperty("SHEET_NAME")) || ss.getSheets()[0];
  ensureSheetHeaders(sheet, REQUIRED_HEADERS);
  const rowNumber = findReportRow(sheet, reportId);

  if (!rowNumber) {
    throw new Error("Could not find report row for ArcGIS retry: " + reportId);
  }

  const rowData = getReportDataFromRow(sheet, rowNumber);
  const photoUrl = textValue(rowData.photoUrl);

  try {
    const existing = findArcGISObject(reportId);

    if (existing) {
      updateArcGISPhotoUrl(reportId, photoUrl);
      setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS updated", ARCGIS_STATUS_COLUMN);
      setRowValue(sheet, rowNumber, "arcgisObjectId", existing.objectId, ARCGIS_OBJECT_ID_COLUMN);
    } else {
      const result = addArcGISFeature(rowData, photoUrl);
      setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS created", ARCGIS_STATUS_COLUMN);
      setRowValue(sheet, rowNumber, "arcgisObjectId", result.objectId || "", ARCGIS_OBJECT_ID_COLUMN);
    }

    setRowValue(sheet, rowNumber, "arcgisError", "", ARCGIS_ERROR_COLUMN);
    return { ok: true, reportId: reportId };
  } catch (err) {
    setRowValue(sheet, rowNumber, "arcgisStatus", "ArcGIS failed", ARCGIS_STATUS_COLUMN);
    setRowValue(sheet, rowNumber, "arcgisError", err.message, ARCGIS_ERROR_COLUMN);
    throw err;
  }
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

  const result = arcGISPost(getRequiredProperty("ARCGIS_LAYER_URL") + "/addFeatures", {
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

  const photoUrlField = getArcGISActualFieldName("photoUrl");
  if (!photoUrlField) return null;

  const attributes = {};
  attributes[photoUrlField] = photoUrl;
  attributes[objectInfo.objectIdFieldName] = objectInfo.objectId;

  const result = arcGISPost(getRequiredProperty("ARCGIS_LAYER_URL") + "/updateFeatures", {
    features: JSON.stringify([{ attributes: attributes }])
  });

  if (!result.updateResults || !result.updateResults[0] || !result.updateResults[0].success) {
    throw new Error("ArcGIS updateFeatures failed: " + JSON.stringify(result));
  }

  return result.updateResults[0];
}

function findArcGISObject(reportId) {
  const safeReportId = String(reportId).replace(/'/g, "''");
  const reportIdField = getArcGISActualFieldName("reportId");
  if (!reportIdField) {
    throw new Error("ArcGIS layer is missing a reportId field.");
  }

  const result = arcGISPost(getRequiredProperty("ARCGIS_LAYER_URL") + "/query", {
    where: reportIdField + "='" + safeReportId + "'",
    returnIdsOnly: "true"
  });

  if (!result.objectIds || !result.objectIds.length) return null;

  return {
    objectId: result.objectIds[result.objectIds.length - 1],
    objectIdFieldName: result.objectIdFieldName || "OBJECTID"
  };
}

function filterArcGISAttributes(attributes) {
  const fieldMap = getArcGISFieldNameMap();
  const filtered = {};

  Object.keys(attributes).forEach((key) => {
    const actualFieldName = fieldMap[canonicalHeader(key)];
    if (actualFieldName) {
      filtered[actualFieldName] = attributes[key];
    }
  });

  return filtered;
}

function getArcGISActualFieldName(fieldName) {
  return getArcGISFieldNameMap()[canonicalHeader(fieldName)] || "";
}

function getArcGISFieldNameMap() {
  const result = arcGISPost(getRequiredProperty("ARCGIS_LAYER_URL"), {});
  if (!result.fields || !result.fields.length) {
    throw new Error("ArcGIS layer fields could not be read.");
  }

  const fieldMap = {};
  result.fields.forEach((field) => {
    fieldMap[canonicalHeader(field.name)] = field.name;
  });

  return fieldMap;
}

function buildArcGISAttributes(data, photoUrl) {
  const attributes = {
    reportId: textValue(data.reportId),
    submittedAt: textValue(data.submittedAt),
    reporterName: textValue(data.reporterName),
    email: textValue(data.email),
    latitude: numberValue(data.latitude),
    longitude: numberValue(data.longitude),
    locationAccuracy: intValue(data.locationAccuracy),
    locationConfirmed: textValue(data.locationConfirmed),
    gpsLocked: textValue(data.gpsLocked),
    address: textValue(data.address),
    condition: textValue(data.condition),
    severity: intValue(data.severity),
    verticalDisplacement: numberValue(data.verticalDisplacement),
    gapWidth: numberValue(data.gapWidth),
    runningSlope: numberValue(data.runningSlope),
    crossSlope: numberValue(data.crossSlope),
    obstructionType: textValue(data.obstructionType),
    passableWidth: numberValue(data.passableWidth),
    curbRampCondition: textValue(data.curbRampCondition),
    detectableWarning: textValue(data.detectableWarning),
    pedestrianVolume: textValue(data.pedestrianVolume),
    schoolTransitProximity: textValue(data.schoolTransitProximity),
    comments: textValue(data.comments),
    photoName: textValue(data.photoName),
    photoType: textValue(data.photoType),
    photoUrl: textValue(photoUrl),
    score: intValue(data.score),
    conditionClass: textValue(data.conditionClass),
    priorityScore: intValue(data.priorityScore),
    priorityClass: textValue(data.priorityClass)
  };

  return filterArcGISAttributes(attributes);
}

function arcGISPost(url, extraPayload) {
  const requestPayload = Object.assign({
    f: "json",
    token: getArcGISToken()
  }, extraPayload);

  const options = {};
  options.method = "post";
  options.payload = requestPayload;
  options.muteHttpExceptions = true;

  const response = UrlFetchApp.fetch(url, options);

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

function getRequiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);

  if (!value) {
    throw new Error("Missing Apps Script property " + name + ".");
  }

  return value;
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

  const reportIdColumn = getColumnByHeader(sheet, "reportId", 1);
  const ids = sheet.getRange(2, reportIdColumn, lastRow - 1, 1).getValues();

  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(reportId)) {
      return i + 2;
    }
  }

  return 0;
}

function getReportDataFromRow(sheet, rowNumber) {
  const headers = getSheetHeaders(sheet);
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = {};

  headers.forEach((header, index) => {
    const canonical = canonicalHeader(header);
    if (canonical) data[canonical] = values[index];
  });

  return data;
}

function appendObjectRow(sheet, rowObject) {
  const headers = getSheetHeaders(sheet);
  const row = headers.map((header) => {
    const canonical = canonicalHeader(header);
    return Object.prototype.hasOwnProperty.call(rowObject, canonical) ? rowObject[canonical] : "";
  });
  sheet.appendRow(row);
}

function getSheetHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((header) => String(header || "").trim());
}

function getColumnByHeader(sheet, headerName, fallbackColumn) {
  const headers = getSheetHeaders(sheet);
  const canonicalName = canonicalHeader(headerName);
  const index = headers.findIndex((header) => canonicalHeader(header) === canonicalName);
  return index === -1 ? fallbackColumn : index + 1;
}

function setRowValue(sheet, rowNumber, headerName, value, fallbackColumn) {
  sheet.getRange(rowNumber, getColumnByHeader(sheet, headerName, fallbackColumn)).setValue(value);
}

function ensureSheetHeaders(sheet, requiredHeaders) {
  const headers = getSheetHeaders(sheet);
  const existing = headers.map(canonicalHeader);
  const missing = requiredHeaders.filter((header) => existing.indexOf(canonicalHeader(header)) === -1);

  if (!missing.length) return;

  sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
}

function canonicalHeader(header) {
  const raw = String(header || "").trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");

  const aliases = {
    reportid: "reportId",
    submittedat: "submittedAt",
    reportername: "reporterName",
    locationaccuracy: "locationAccuracy",
    locationconfirmed: "locationConfirmed",
    gpslocked: "gpsLocked",
    verticaldisplacement: "verticalDisplacement",
    gapwidth: "gapWidth",
    runningslope: "runningSlope",
    crossslope: "crossSlope",
    obstructiontype: "obstructionType",
    passablewidth: "passableWidth",
    curbrampcondition: "curbRampCondition",
    detectablewarning: "detectableWarning",
    pedestrianvolume: "pedestrianVolume",
    schooltransitproximity: "schoolTransitProximity",
    photoname: "photoName",
    phototype: "photoType",
    photourl: "photoUrl",
    conditionclass: "conditionClass",
    priorityscore: "priorityScore",
    priorityclass: "priorityClass",
    photostatus: "photoStatus",
    arcgisstatus: "arcgisStatus",
    arcgisobjectid: "arcgisObjectId",
    arcgiserror: "arcgisError"
  };

  return aliases[normalized] || normalized;
}

function appendCellValue(sheet, rowNumber, headerName, value, fallbackColumn) {
  const column = getColumnByHeader(sheet, headerName, fallbackColumn);
  const range = sheet.getRange(rowNumber, column);
  const existing = String(range.getValue() || "").trim();
  const combined = existing && existing.indexOf("Photo upload pending") === -1
    ? existing + "\n" + value
    : value;

  range.setValue(combined);
  return combined;
}

function isSpamSubmission(data) {
  return false;
}
