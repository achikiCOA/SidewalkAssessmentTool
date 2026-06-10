const PHOTO_URL_COLUMN = 23;
const PHOTO_STATUS_COLUMN = 28;
const ARCGIS_STATUS_COLUMN = 29;
const ARCGIS_OBJECT_ID_COLUMN = 30;
const ARCGIS_ERROR_COLUMN = 31;
const BACKEND_VERSION = "2026-06-10-recorder-sync-cleanup-v1";
const RECORDER_SYNC_LOG_SHEET_NAME = "Recorder Sync Log";
const RECORDER_REQUIRED_FIELDS = [
  "segmentId",
  "routeId",
  "condition",
  "conditionClass",
  "score",
  "priorityClass",
  "lengthMeters",
  "averageAccuracy",
  "startTime",
  "endTime",
  "pointCount",
  "source",
  "reviewed",
  "notes",
  "photoCount"
];
const DEBUG = false;
const REQUIRED_HEADERS = [
  "reportId",
  "submittedAt",
  "reporterName",
  "email",
  "reportType",
  "latitude",
  "longitude",
  "locationAccuracy",
  "locationConfirmed",
  "gpsLocked",
  "address",
  "segmentStartLat",
  "segmentStartLng",
  "segmentEndLat",
  "segmentEndLng",
  "segmentLengthFt",
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
  "photoCaptions",
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

function debugLog(message, data) {
  if (!DEBUG) return;
  if (data === undefined) {
    console.log(message);
  } else {
    console.log(message, data);
  }
}

function doPost(e) {
  try {
    const data = parsePayload(e);

    if (data.action === "photo") {
      return handlePhotoUpload(data);
    }

    if (data.action === "recorderSession") {
      return handleRecorderSessionUpload(data);
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
  debugLog("Report upload received. reportId=" + data.reportId + ", spreadsheetId=" + ss.getId() + ", sheetName=" + sheet.getName());

  appendObjectRow(sheet, {
    reportId: data.reportId,
    submittedAt: data.submittedAt,
    reporterName: data.reporterName,
    email: data.email,
    reportType: data.reportType,
    latitude: data.latitude,
    longitude: data.longitude,
    locationAccuracy: data.locationAccuracy,
    locationConfirmed: data.locationConfirmed,
    gpsLocked: data.gpsLocked,
    address: data.address,
    segmentStartLat: data.segmentStartLat,
    segmentStartLng: data.segmentStartLng,
    segmentEndLat: data.segmentEndLat,
    segmentEndLng: data.segmentEndLng,
    segmentLengthFt: data.segmentLengthFt,
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
    photoCaptions: data.photoCaptions,
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
  debugLog("Report row appended. reportId=" + data.reportId + ", rowNumber=" + rowNumber);

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

function handleRecorderSessionUpload(data) {
  const segments = Array.isArray(data.generatedSegments) ? data.generatedSegments : [];
  if (!segments.length) {
    logRecorderSync(data, {
      added: 0,
      updated: 0,
      failed: 0,
      errors: [{ segmentId: "", error: "No recorder segments were provided." }]
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, action: "recorderSession", error: "No recorder segments were provided." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const result = syncRecorderSegmentsToArcGIS(data, segments);
  logRecorderSync(data, result);

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      action: "recorderSession",
      routeId: data.routeId || data.sessionId || "",
      added: result.added,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors
    }))
    .setMimeType(ContentService.MimeType.JSON);
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

function validateArcGISRecorderLayer() {
  const layerUrl = getRecorderSegmentLayerUrl();
  const fieldMap = getArcGISFieldNameMap(layerUrl);
  const missing = RECORDER_REQUIRED_FIELDS.filter((fieldName) => !fieldMap[canonicalHeader(fieldName)]);

  return {
    ok: missing.length === 0,
    layerUrl: layerUrl,
    missingFields: missing,
    message: missing.length
      ? "Recorder layer is missing recommended fields: " + missing.join(", ")
      : "Recorder layer has the recommended fields."
  };
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
  if (textValue(data.reportType) === "Sidewalk Segment") {
    return addArcGISSegmentFeature(data, photoUrl);
  }

  const lat = Number(data.latitude);
  const lng = Number(data.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("ArcGIS feature was not created because latitude/longitude were invalid.");
  }

  const feature = {
    attributes: buildArcGISAttributes(data, photoUrl, getRequiredProperty("ARCGIS_LAYER_URL")),
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

function addArcGISSegmentFeature(data, photoUrl) {
  const startLat = Number(data.segmentStartLat);
  const startLng = Number(data.segmentStartLng);
  const endLat = Number(data.segmentEndLat);
  const endLng = Number(data.segmentEndLng);

  if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(endLat) || !Number.isFinite(endLng)) {
    throw new Error("ArcGIS segment was not created because start/end coordinates were invalid.");
  }

  const segmentLayerUrl = getRequiredProperty("ARCGIS_SEGMENT_LAYER_URL");
  const feature = {
    attributes: buildArcGISAttributes(data, photoUrl, segmentLayerUrl),
    geometry: {
      paths: [[
        [startLng, startLat],
        [endLng, endLat]
      ]],
      spatialReference: { wkid: 4326 }
    }
  };

  const result = arcGISPost(segmentLayerUrl + "/addFeatures", {
    features: JSON.stringify([feature])
  });

  if (!result.addResults || !result.addResults[0] || !result.addResults[0].success) {
    throw new Error("ArcGIS segment addFeatures failed: " + JSON.stringify(result));
  }

  return result.addResults[0];
}

function syncRecorderSegmentsToArcGIS(session, segments) {
  const layerUrl = getRecorderSegmentLayerUrl();
  const result = {
    added: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  segments.forEach((segment) => {
    try {
      const feature = buildRecorderArcGISFeature(session, segment, layerUrl);
      const existing = findArcGISObjectByField("segmentId", segment.segmentId, layerUrl);

      if (existing) {
        feature.attributes[existing.objectIdFieldName] = existing.objectId;
        updateArcGISFeature(layerUrl, feature);
        result.updated += 1;
      } else {
        addArcGISFeatureToLayer(layerUrl, feature);
        result.added += 1;
      }
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        segmentId: segment && segment.segmentId ? segment.segmentId : "",
        error: err.message
      });
      console.error("Recorder ArcGIS segment sync failed: " + (err.stack || err.message));
    }
  });

  return result;
}

function getRecorderSegmentLayerUrl() {
  return getOptionalProperty("ARCGIS_RECORDER_SEGMENT_LAYER_URL") ||
    getRequiredProperty("ARCGIS_SEGMENT_LAYER_URL");
}

function buildRecorderArcGISFeature(session, segment, layerUrl) {
  const coordinates = Array.isArray(segment.coordinates) ? segment.coordinates : [];
  if (coordinates.length < 2) {
    throw new Error("Recorder segment must contain at least two coordinates.");
  }

  const path = coordinates.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new Error("Recorder segment has an invalid coordinate.");
    }

    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Recorder segment has a non-numeric coordinate.");
    }

    return [lng, lat];
  });

  const attributes = buildRecorderArcGISAttributes(session, segment, layerUrl);

  return {
    attributes: attributes,
    geometry: {
      paths: [path],
      spatialReference: { wkid: 4326 }
    }
  };
}

function buildRecorderArcGISAttributes(session, segment, layerUrl) {
  const attributes = {
    segmentId: textValue(segment.segmentId),
    routeId: textValue(segment.routeId || session.routeId || session.sessionId),
    sessionId: textValue(session.sessionId || session.routeId),
    routeName: textValue(session.routeName),
    inspectorName: textValue(session.inspectorName || session.recorderName),
    condition: textValue(segment.condition),
    conditionClass: textValue(segment.conditionClass),
    score: intValue(segment.score),
    priorityClass: textValue(segment.priorityClass || recorderPriorityClass(segment.condition)),
    lengthMeters: numberValue(segment.lengthMeters),
    averageAccuracy: numberValue(segment.averageAccuracy || segment.averageAccuracyMeters),
    startTime: textValue(segment.startTime || segment.startTimestamp),
    endTime: textValue(segment.endTime || segment.endTimestamp),
    pointCount: intValue(segment.pointCount),
    source: textValue(segment.source || "continuous_recorder"),
    reviewed: Boolean(segment.reviewed) ? "true" : "false",
    notes: textValue(buildRecorderNotesForSegment(session, segment)),
    photoCount: Array.isArray(session.photos) ? session.photos.length : 0
  };

  return filterArcGISAttributes(attributes, layerUrl);
}

function buildRecorderNotesForSegment(session, segment) {
  const segmentNotes = [segment.notes || ""].filter(Boolean);
  const recorderNotes = (Array.isArray(session.notes) ? session.notes : [])
    .map((note) => {
      const location = note.latitude && note.longitude
        ? " (" + note.latitude + ", " + note.longitude + ")"
        : "";
      return textValue(note.text) + location;
    })
    .filter(Boolean);

  return segmentNotes.concat(recorderNotes).join("; ");
}

function logRecorderSync(session, result) {
  try {
    const ss = SpreadsheetApp.openById(getRequiredProperty("SPREADSHEET_ID"));
    const sheet = ss.getSheetByName(RECORDER_SYNC_LOG_SHEET_NAME) || ss.insertSheet(RECORDER_SYNC_LOG_SHEET_NAME);
    const headers = [
      "loggedAt",
      "routeId",
      "sessionId",
      "routeName",
      "segmentCount",
      "added",
      "updated",
      "failed",
      "errors",
      "backendVersion"
    ];

    ensureSheetHeaders(sheet, headers);
    appendObjectRow(sheet, {
      loggedAt: new Date().toISOString(),
      routeId: session.routeId || session.sessionId || "",
      sessionId: session.sessionId || session.routeId || "",
      routeName: session.routeName || "",
      segmentCount: Array.isArray(session.generatedSegments) ? session.generatedSegments.length : 0,
      added: result.added || 0,
      updated: result.updated || 0,
      failed: result.failed || 0,
      errors: result.errors && result.errors.length ? JSON.stringify(result.errors) : "",
      backendVersion: BACKEND_VERSION
    });
  } catch (err) {
    console.error("Recorder sync logging failed: " + (err.stack || err.message));
  }
}

function addArcGISFeatureToLayer(layerUrl, feature) {
  const response = arcGISPost(layerUrl + "/addFeatures", {
    features: JSON.stringify([feature])
  });

  if (!response.addResults || !response.addResults[0] || !response.addResults[0].success) {
    throw new Error("ArcGIS addFeatures failed: " + JSON.stringify(response));
  }

  return response.addResults[0];
}

function updateArcGISFeature(layerUrl, feature) {
  const response = arcGISPost(layerUrl + "/updateFeatures", {
    features: JSON.stringify([feature])
  });

  if (!response.updateResults || !response.updateResults[0] || !response.updateResults[0].success) {
    throw new Error("ArcGIS updateFeatures failed: " + JSON.stringify(response));
  }

  return response.updateResults[0];
}

function updateArcGISPhotoUrl(reportId, photoUrl) {
  if (!reportId || !photoUrl) return null;

  const objectInfo = findArcGISObject(reportId);
  if (!objectInfo) return null;

  const photoUrlField = getArcGISActualFieldName("photoUrl", objectInfo.layerUrl);
  if (!photoUrlField) return null;

  const attributes = {};
  attributes[photoUrlField] = photoUrl;
  attributes[objectInfo.objectIdFieldName] = objectInfo.objectId;

  const result = arcGISPost(objectInfo.layerUrl + "/updateFeatures", {
    features: JSON.stringify([{ attributes: attributes }])
  });

  if (!result.updateResults || !result.updateResults[0] || !result.updateResults[0].success) {
    throw new Error("ArcGIS updateFeatures failed: " + JSON.stringify(result));
  }

  return result.updateResults[0];
}

function findArcGISObject(reportId) {
  return findArcGISObjectInLayer(reportId, getRequiredProperty("ARCGIS_LAYER_URL")) ||
    findArcGISObjectInLayer(reportId, getOptionalProperty("ARCGIS_SEGMENT_LAYER_URL"));
}

function findArcGISObjectInLayer(reportId, layerUrl) {
  if (!layerUrl) return null;

  const safeReportId = String(reportId).replace(/'/g, "''");
  const reportIdField = getArcGISActualFieldName("reportId", layerUrl);
  if (!reportIdField) {
    throw new Error("ArcGIS layer is missing a reportId field.");
  }

  const result = arcGISPost(layerUrl + "/query", {
    where: reportIdField + "='" + safeReportId + "'",
    returnIdsOnly: "true"
  });

  if (!result.objectIds || !result.objectIds.length) return null;

  return {
    objectId: result.objectIds[result.objectIds.length - 1],
    objectIdFieldName: result.objectIdFieldName || "OBJECTID",
    layerUrl: layerUrl
  };
}

function findArcGISObjectByField(fieldName, value, layerUrl) {
  if (!layerUrl || !value) return null;

  const actualFieldName = getArcGISActualFieldName(fieldName, layerUrl);
  if (!actualFieldName) return null;

  const safeValue = String(value).replace(/'/g, "''");
  const result = arcGISPost(layerUrl + "/query", {
    where: actualFieldName + "='" + safeValue + "'",
    returnIdsOnly: "true"
  });

  if (!result.objectIds || !result.objectIds.length) return null;

  return {
    objectId: result.objectIds[result.objectIds.length - 1],
    objectIdFieldName: result.objectIdFieldName || "OBJECTID",
    layerUrl: layerUrl
  };
}

function recorderPriorityClass(condition) {
  const value = textValue(condition);
  if (value === "Red") return "High";
  if (value === "Yellow") return "Medium";
  return "Low";
}

function filterArcGISAttributes(attributes, layerUrl) {
  const fieldMap = getArcGISFieldNameMap(layerUrl);
  const filtered = {};

  Object.keys(attributes).forEach((key) => {
    const actualFieldName = fieldMap[canonicalHeader(key)];
    if (actualFieldName) {
      filtered[actualFieldName] = attributes[key];
    }
  });

  return filtered;
}

function getArcGISActualFieldName(fieldName, layerUrl) {
  return getArcGISFieldNameMap(layerUrl)[canonicalHeader(fieldName)] || "";
}

function getArcGISFieldNameMap(layerUrl) {
  const result = arcGISPost(layerUrl, {});
  if (!result.fields || !result.fields.length) {
    throw new Error("ArcGIS layer fields could not be read.");
  }

  const fieldMap = {};
  result.fields.forEach((field) => {
    fieldMap[canonicalHeader(field.name)] = field.name;
  });

  return fieldMap;
}

function buildArcGISAttributes(data, photoUrl, layerUrl) {
  const attributes = {
    reportId: textValue(data.reportId),
    submittedAt: textValue(data.submittedAt),
    reporterName: textValue(data.reporterName),
    email: textValue(data.email),
    reportType: textValue(data.reportType),
    latitude: numberValue(data.latitude),
    longitude: numberValue(data.longitude),
    locationAccuracy: intValue(data.locationAccuracy),
    locationConfirmed: textValue(data.locationConfirmed),
    gpsLocked: textValue(data.gpsLocked),
    address: textValue(data.address),
    segmentStartLat: numberValue(data.segmentStartLat),
    segmentStartLng: numberValue(data.segmentStartLng),
    segmentEndLat: numberValue(data.segmentEndLat),
    segmentEndLng: numberValue(data.segmentEndLng),
    segmentLengthFt: numberValue(data.segmentLengthFt),
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
    photoCaptions: textValue(data.photoCaptions),
    photoUrl: textValue(photoUrl),
    score: intValue(data.score),
    conditionClass: textValue(data.conditionClass),
    priorityScore: intValue(data.priorityScore),
    priorityClass: textValue(data.priorityClass)
  };

  return filterArcGISAttributes(attributes, layerUrl);
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

function getOptionalProperty(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || "";
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
    routeid: "routeId",
    sessionid: "sessionId",
    segmentid: "segmentId",
    routename: "routeName",
    submittedat: "submittedAt",
    reportername: "reporterName",
    inspectorname: "inspectorName",
    reporttype: "reportType",
    locationaccuracy: "locationAccuracy",
    locationconfirmed: "locationConfirmed",
    gpslocked: "gpsLocked",
    segmentstartlat: "segmentStartLat",
    segmentstartlng: "segmentStartLng",
    segmentendlng: "segmentEndLng",
    segmentendlat: "segmentEndLat",
    segmentlengthft: "segmentLengthFt",
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
    photocaptions: "photoCaptions",
    photourl: "photoUrl",
    conditionclass: "conditionClass",
    priorityscore: "priorityScore",
    priorityclass: "priorityClass",
    averagelocationaccuracy: "averageAccuracy",
    averageaccuracy: "averageAccuracy",
    pointcount: "pointCount",
    photocount: "photoCount",
    photostatus: "photoStatus",
    arcgisstatus: "arcgisStatus",
    arcgisobjectid: "arcgisObjectId",
    arcgiserror: "arcgisError",
    loggedat: "loggedAt",
    segmentcount: "segmentCount",
    added: "added",
    updated: "updated",
    failed: "failed",
    errors: "errors",
    backendversion: "backendVersion"
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
