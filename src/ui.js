(function () {
  "use strict";

  const DEFAULT_LOCATION = { lat: 39.3292, lng: -82.1013 };
  const DEFAULT_UPLOAD_URL = "";
  const APP_VERSION = "2026-06-10-recorder-sync-cleanup-v1";
  const STORAGE_KEY = "sidewalkAssessmentReports";
  const RECORDER_STORAGE_KEY = "sidewalkRecorderSessions";
  const RECORDER_ACTIVE_STORAGE_KEY = "sidewalkRecorderActiveSession";
  const RECORDER_STORAGE_VERSION = 1;
  const UPLOAD_URL_KEY = "sidewalkAssessmentUploadUrl";
  const BLOCK_LAYER_URL_KEY = "sidewalkAssessmentBlockLayerUrl";
  const CONTACT_STORAGE_KEY = "sidewalkAssessmentContact";
  const DRAFT_STORAGE_KEY = "sidewalkAssessmentDraft";
  const SURVEY_STEPS = [
    { id: "locationSection", label: "Location", action: "Choose point or segment, then confirm the map location." },
    { id: "photoSection", label: "Photo", action: "Add photos or continue if photos are not needed." },
    { id: "conditionSection", label: "Condition", action: "Choose a preset or issue type and severity." },
    { id: "contextSection", label: "Context", action: "Add pedestrian volume, school/transit proximity, and comments." },
    { id: "measurementsSection", label: "Measurements", action: "Add measurements if available, or skip to contact." },
    { id: "contactSection", label: "Contact", action: "Confirm contact info, then review the report." },
    { id: "reviewSection", label: "Review", action: "Review the summary. Use Edit if something needs a correction." }
  ];
  const SCORE_CONFIG = {
    conditionPenalty: {
      "No Issues": 0,
      "Cracking": 25,
      "Heaving": 35,
      "Gaps": 40,
      "Spalling": 20,
      "Obstruction": 30,
      "Curb Ramp": 30,
      "Running Slope/Cross Slope": 25,
      "Other": 15
    },
    severityPenaltyStep: 7,
    displacementPenaltyPerInch: 8,
    displacementPenaltyMax: 22,
    gapPenaltyPerInch: 3,
    gapPenaltyMax: 16,
    passableWidthTargetFt: 4,
    passableWidthPenaltyPerFt: 8,
    passableWidthPenaltyMax: 18,
    obstructionPenalty: 12,
    curbRampPenalty: {
      "Not Applicable": 0,
      "Good": 0,
      "Fair": 5,
      "Poor": 12,
      "Missing/Blocked": 18
    },
    detectableWarningPenalty: {
      "Not Applicable": 0,
      "Present": 0,
      "Missing": 18,
      "Damaged/Worn": 12,
      "Low Contrast": 8
    },
    priorityConditionWeight: 0.65,
    prioritySeverityStep: 7,
    priorityDisplacementHalfInch: 12,
    priorityDisplacementOneInch: 10,
    priorityGapOneInch: 8,
    priorityNarrowWidth: 12,
    priorityObstruction: 8,
    priorityCurbRampIssue: 12,
    priorityDetectableWarning: 12,
    priorityRunningSlope: 10,
    priorityCrossSlope: 12,
    priorityPedestrianHigh: 10,
    priorityPedestrianMedium: 5,
    prioritySchoolTransit: 10
  };
  const DEBUG = false;
  const RECORDER_DEBUG = DEBUG;
  const RECORDER_MAX_ACCURACY_METERS = 15;
  const RECORDER_START_MAX_ACCURACY_METERS = 10;
  const RECORDER_OBSERVATION_MAX_ACCURACY_METERS = 15;
  const RECORDER_OBSERVATION_FIX_TIMEOUT_MS = 8000;
  const RECORDER_NORMAL_DISTANCE_METERS = 2;
  const RECORDER_HIGH_DETAIL_DISTANCE_METERS = 1;
  const RECORDER_SEGMENT_GAP_METERS = 15;
  const RECORDER_SEGMENT_GAP_MS = 60000;
  const RECORDER_SOURCE = "continuous_recorder";
  const MAX_PHOTO_COUNT = 8;
  const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
  const MAX_TOTAL_PHOTO_BYTES = 20 * 1024 * 1024;
  const MAX_LOCAL_STORAGE_WARN_BYTES = 4 * 1024 * 1024;
  const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

  let map = null;
  let marker = null;
  let accuracyCircle = null;
  let resizeObserver = null;
  let addressTimer = null;
  let locationWatchId = null;
  let currentAccuracy = null;
  let locationLocked = false;
  let locationConfirmed = false;
  let suppressMapMoveUpdate = false;
  let photoPreviewUrls = [];
  let draftTimer = null;
  let draftAutosaveEnabled = true;
  let lastSubmittedReport = null;
  let segmentStart = null;
  let segmentEnd = null;
  let segmentLine = null;
  let segmentStartMarker = null;
  let segmentEndMarker = null;
  let recorderMap = null;
  let recorderResizeObserver = null;
  let recorderWatchId = null;
  let recorderStartWatchId = null;
  let recorderStartPoint = null;
  let recorderStartFixActive = false;
  let recorderState = createEmptyRecorderState();
  let recorderLayers = [];
  let recorderBlockLayers = [];
  let recorderBlocks = [];
  let selectedRecorderBlock = null;
  let recorderReviewFilter = "problem";
  let recorderDetailMode = "normal";

  const field = window.App && window.App.dom && window.App.dom.field
    ? window.App.dom.field
    : (id) => document.getElementById(id);
  let appInitialized = false;

  window.addEventListener("load", initApp);
  window.addEventListener("beforeunload", warnBeforeLeavingActiveRecorder);

  function initApp() {
    if (appInitialized) {
      debugLog("App already initialized; skipping duplicate startup.");
      return;
    }
    appInitialized = true;

    resetSavedReportsFromUrl();
    bindForm();
    bindSettings();
    updateSettingsVisibility();
    restoreContactInfo();
    updateSavedCount();
    updateUploadStatus();
    runScoring();
    runRecorderSegmentSelfTest();

    if (!window.L) {
      setMessage("Map library did not load. Check your internet connection and reload this file.", "error");
      return;
    }

    try {
      initMap(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng);
    } catch (error) {
      handleAppError("Map initialization failed.", error, setMessage);
    }
  }

  function initMap(lat, lng) {
    if (map) {
      debugLog("Main map already initialized; skipping duplicate init.");
      return;
    }
    map = L.map("map", {
      tap: true,
      zoomControl: true,
      maxZoom: 22,
      zoomSnap: 0.5,
      zoomDelta: 0.5
    }).setView([lat, lng], 18);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxNativeZoom: 19,
      maxZoom: 22
    }).addTo(map);

    marker = L.marker([lat, lng], {
      draggable: false,
      autoPan: true
    }).addTo(map);

    map.on("click", (e) => {
      unlockLocation(false);
      suppressMapMoveUpdate = true;
      map.panTo(e.latlng);
      if (!isSegmentReport()) {
        setLocation(e.latlng.lat, e.latlng.lng, true, null);
      }
    });
    map.on("moveend", updateLocationFromMapCenter);
    marker.on("dragend", () => {
      unlockLocation(false);
      const point = marker.getLatLng();
      setLocation(point.lat, point.lng, true, null);
    });

    field("locateButton").addEventListener("click", locateUser);
    field("locateSegmentButton").addEventListener("click", locateUser);
    field("confirmLocationButton").addEventListener("click", confirmLocation);
    field("segmentCaptureButton").addEventListener("click", handleSegmentCapture);
    field("clearSegmentButton").addEventListener("click", clearSegment);
    attachResizeObserver(field("map"));
    setLocation(lat, lng, false, null);
    updateReportTypeUI();

    setTimeout(() => map.invalidateSize(true), 100);
    setTimeout(() => map.invalidateSize(true), 500);
  }

  function attachResizeObserver(el) {
    if (!("ResizeObserver" in window)) return;
    if (resizeObserver) resizeObserver.disconnect();

    resizeObserver = new ResizeObserver(() => {
      if (map) map.invalidateSize(true);
    });
    resizeObserver.observe(el);
  }

  function locateUser() {
    if (!navigator.geolocation) {
      setMessage("This browser does not support location lookup.", "error");
      return;
    }

    locationLocked = false;
    setLocateButtonsDisabled(true);
    setMessage("Getting a high-accuracy GPS fix. This may take a few seconds.", "");

    if (locationWatchId !== null) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
    }

    let bestPosition = null;
    const startedAt = Date.now();
    const stopTimer = window.setTimeout(stopWatchingLocation, 22000);

    try {
      locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
        const accuracy = Number(position.coords.accuracy);
        const isBetter = !bestPosition || accuracy < Number(bestPosition.coords.accuracy);

        if (isBetter) {
          bestPosition = position;
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setLocation(lat, lng, false, accuracy);
          suppressMapMoveUpdate = true;
          map.setView([lat, lng], accuracy <= 20 ? 21 : 20);
          setMessage("GPS fix found. Accuracy: about " + Math.round(accuracy) + " m.", "ok");
        }

        if (accuracy <= 10 || Date.now() - startedAt > 16000) {
          stopWatchingLocation();
        }
        },
        (error) => {
        window.clearTimeout(stopTimer);
        stopWatchingLocation();
        debugLog("Point GPS watch failed", error);
        setMessage("Location access was not available. You can still pan the map to the sidewalk issue.", "error");
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    } catch (error) {
      window.clearTimeout(stopTimer);
      stopWatchingLocation();
      handleAppError("GPS lookup failed.", error, setMessage);
    }

    function stopWatchingLocation() {
      window.clearTimeout(stopTimer);

      if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
      }

      setLocateButtonsDisabled(false);

      if (bestPosition) {
        const lat = bestPosition.coords.latitude;
        const lng = bestPosition.coords.longitude;
        setLocation(lat, lng, true, bestPosition.coords.accuracy);
        lockLocation(bestPosition.coords.accuracy);
      }
    }
  }

  function lockLocation(accuracyMeters) {
    locationLocked = true;
    setLocateButtonText("Improve Location");
    markLocationUnconfirmed();
    setMessage("GPS found your location. Pan the map until the target is on the sidewalk issue, then tap Use This Location.", "ok");
  }

  function unlockLocation(showMessage) {
    locationLocked = false;
    setLocateButtonText("Use My Location");

    if (locationWatchId !== null) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
    }

    if (showMessage) {
      setMessage("GPS lock cleared. Use My Location again or pan the map to the sidewalk issue.", "");
    }
  }

  function setLocateButtonsDisabled(disabled) {
    field("locateButton").disabled = disabled;
    field("locateSegmentButton").disabled = disabled;
  }

  function setLocateButtonText(text) {
    field("locateButton").textContent = text;
    field("locateSegmentButton").textContent = text;
  }

  function updateLocationFromMapCenter() {
    if (suppressMapMoveUpdate) {
      suppressMapMoveUpdate = false;
      return;
    }

    if (!map || !field("locationSection").open) return;

    const center = map.getCenter();
    unlockLocation(false);
    if (isSegmentReport()) {
      markLocationUnconfirmed();
      setMessage("Target moved. Set the segment start or end point when it is positioned correctly.", "");
      return;
    }
    setLocation(center.lat, center.lng, true, null);
    setMessage("Map center updated. Tap Use This Location when the target is on the sidewalk issue.", "");
  }

  function isSegmentReport() {
    return field("reportType") && field("reportType").value === "Sidewalk Segment";
  }

  function updateReportTypeUI() {
    const isSegment = isSegmentReport();
    field("pointLocationActions").classList.toggle("hidden", isSegment);
    field("segmentTools").classList.toggle("visible", isSegment);
    field("pointTypeHelp").classList.toggle("active", !isSegment);
    field("segmentTypeHelp").classList.toggle("active", isSegment);
    field("confirmLocationButton").textContent = "Confirm Point";
    field("locationHelp").textContent = isSegment
      ? "Sidewalk segment: place the target at the beginning of the bad stretch, set start, then move to the end and set end."
      : "Point issue: place the target on the exact spot and confirm point.";

    if (isSegment) {
      updateSegmentPreview();
    } else {
      clearSegment(false);
      markLocationUnconfirmed();
    }
    updateSegmentCaptureButton();
    refreshCurrentStepProgress();
  }

  function handleSegmentCapture() {
    if (!segmentStart) {
      setSegmentPoint("start");
      return;
    }

    if (!segmentEnd) {
      setSegmentPoint("end");
      return;
    }

    confirmLocation();
  }

  function setSegmentPoint(which) {
    if (!map) return;
    const center = map.getCenter();
    const point = { lat: center.lat, lng: center.lng };

    if (which === "start") {
      segmentStart = point;
    } else {
      segmentEnd = point;
    }

    updateSegmentPreview();
    const nextStep = which === "start" && !segmentEnd
      ? "Step 2 of 3: start set. Pan to the end of the section and tap Set End Point."
      : "Segment point saved.";
    setMessage(nextStep, "ok");
    updateSegmentCaptureButton();
    scheduleDraftSave();
  }

  function clearSegment(showMessage = true) {
    segmentStart = null;
    segmentEnd = null;

    if (segmentLine) {
      segmentLine.remove();
      segmentLine = null;
    }

    if (segmentStartMarker) {
      segmentStartMarker.remove();
      segmentStartMarker = null;
    }

    if (segmentEndMarker) {
      segmentEndMarker.remove();
      segmentEndMarker = null;
    }

    field("segmentLengthFt").value = "";
    field("segmentStatus").textContent = "Step 1 of 3: set the segment start point.";
    updateSegmentCaptureButton();
    if (showMessage) setMessage("Segment points cleared.", "");
    markLocationUnconfirmed();
    scheduleDraftSave();
  }

  function updateSegmentPreview() {
    if (!map) return;

    if (segmentLine) {
      segmentLine.remove();
      segmentLine = null;
    }

    if (segmentStartMarker) {
      segmentStartMarker.remove();
      segmentStartMarker = null;
    }

    if (segmentEndMarker) {
      segmentEndMarker.remove();
      segmentEndMarker = null;
    }

    if (segmentStart) {
      segmentStartMarker = L.circleMarker([segmentStart.lat, segmentStart.lng], {
        radius: 7,
        color: "#0f766e",
        weight: 2,
        fillColor: "#0f766e",
        fillOpacity: 0.8
      }).addTo(map).bindTooltip("Start");
    }

    if (segmentEnd) {
      segmentEndMarker = L.circleMarker([segmentEnd.lat, segmentEnd.lng], {
        radius: 7,
        color: "#b45309",
        weight: 2,
        fillColor: "#b45309",
        fillOpacity: 0.8
      }).addTo(map).bindTooltip("End");
    }

    if (segmentStart && segmentEnd) {
      segmentLine = L.polyline([
        [segmentStart.lat, segmentStart.lng],
        [segmentEnd.lat, segmentEnd.lng]
      ], {
        color: "#0f766e",
        weight: 5,
        opacity: 0.85
      }).addTo(map);

      const lengthFt = calculateSegmentLengthFt(segmentStart, segmentEnd);
      const midpoint = getSegmentMidpoint();
      field("segmentLengthFt").value = String(Math.round(lengthFt));
      field("segmentStatus").textContent = "Step 3 of 3: segment ready. Length: about " + Math.round(lengthFt) + " ft. Tap Confirm Segment.";
      field("latitude").value = midpoint.lat.toFixed(7);
      field("longitude").value = midpoint.lng.toFixed(7);
      if (marker) marker.setLatLng([midpoint.lat, midpoint.lng]);
      reverseGeocode(midpoint.lat, midpoint.lng);
      locationConfirmed = true;
      updateLocationConfirmationStatus();
      updateSegmentCaptureButton();
    } else {
      field("segmentLengthFt").value = "";
      field("segmentStatus").textContent = segmentStart
        ? "Step 2 of 3: start point set. Move the map target to the end point."
        : segmentEnd
          ? "Step 2 of 3: end point set. Move the map target to the start point."
          : "Step 1 of 3: set the segment start point.";
      markLocationUnconfirmed();
      updateSegmentCaptureButton();
    }
  }

  function updateSegmentCaptureButton() {
    const button = field("segmentCaptureButton");
    if (!button) return;

    if (!segmentStart) {
      button.textContent = "Set Start Point";
    } else if (!segmentEnd) {
      button.textContent = "Set End Point";
    } else if (!locationConfirmed) {
      button.textContent = "Confirm Segment";
    } else {
      button.textContent = "Segment Confirmed";
    }
    button.className = locationConfirmed && segmentStart && segmentEnd ? "confirmed" : "";
  }

  function getSegmentMidpoint() {
    if (!segmentStart || !segmentEnd) return null;
    return {
      lat: (segmentStart.lat + segmentEnd.lat) / 2,
      lng: (segmentStart.lng + segmentEnd.lng) / 2
    };
  }

  function calculateSegmentLengthFt(start, end) {
    if (!start || !end) return 0;
    const earthRadiusMeters = 6371000;
    const lat1 = start.lat * Math.PI / 180;
    const lat2 = end.lat * Math.PI / 180;
    const deltaLat = (end.lat - start.lat) * Math.PI / 180;
    const deltaLng = (end.lng - start.lng) * Math.PI / 180;
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const meters = earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return meters * 3.28084;
  }

  function setLocation(lat, lng, lookupAddress, accuracyMeters) {
    const cleanLat = Number(lat);
    const cleanLng = Number(lng);

    field("latitude").value = cleanLat.toFixed(7);
    field("longitude").value = cleanLng.toFixed(7);

    if (marker) marker.setLatLng([cleanLat, cleanLng]);
    updateAccuracy(cleanLat, cleanLng, accuracyMeters);
    markLocationUnconfirmed();

    if (lookupAddress) {
      field("address").value = "Looking up address...";
      clearTimeout(addressTimer);
      addressTimer = setTimeout(() => reverseGeocode(cleanLat, cleanLng), 350);
    }
  }

  function confirmLocation() {
    const defaultLat = DEFAULT_LOCATION.lat.toFixed(7);
    const defaultLng = DEFAULT_LOCATION.lng.toFixed(7);

    if (isSegmentReport()) {
      if (!segmentStart || !segmentEnd) {
        setMessage("Set both the segment start and end points before confirming.", "error");
        openSection("locationSection");
        return;
      }

      locationConfirmed = true;
      updateLocationConfirmationStatus();
      updateSegmentCaptureButton();
      setMessage("Segment confirmed. Continue through the report and submit when ready.", "ok");
      return;
    }

    if (field("latitude").value === defaultLat && field("longitude").value === defaultLng) {
      setMessage("Use GPS or pan the map target to the sidewalk issue before confirming.", "error");
      openSection("locationSection");
      return;
    }

    locationConfirmed = true;
    updateLocationConfirmationStatus();
    setMessage("Location confirmed. Continue through the report and submit when ready.", "ok");
    scheduleDraftSave();
  }

  function markLocationUnconfirmed() {
    locationConfirmed = false;
    updateLocationConfirmationStatus();
    updateSegmentCaptureButton();
  }

  function updateLocationConfirmationStatus() {
    const status = field("locationStatus");
    const button = field("confirmLocationButton");
    if (!status || !button) return;

    status.textContent = locationConfirmed ? "Confirmed" : "Needs confirmation";
    status.className = locationConfirmed ? "location-confirmed" : "location-needs-confirmation";
    button.textContent = locationConfirmed ? "Point Confirmed" : "Confirm Point";
    button.className = locationConfirmed ? "confirmed" : "secondary";
  }

  function updateAccuracy(lat, lng, accuracyMeters) {
    currentAccuracy = Number.isFinite(Number(accuracyMeters)) ? Number(accuracyMeters) : null;
    const accuracyValue = field("accuracyValue");

    if (currentAccuracy) {
      const rounded = Math.round(currentAccuracy);
      const quality = rounded <= 15 ? "Good" : rounded <= 50 ? "Fair" : "Poor";
      accuracyValue.textContent = "+/- " + rounded + " m - " + quality;
      accuracyValue.className = rounded <= 15 ? "accuracy-good" : rounded <= 50 ? "accuracy-fair" : "accuracy-poor";
    } else {
      accuracyValue.textContent = "--";
      accuracyValue.className = "";
    }

    if (!map) return;

    if (accuracyCircle) {
      accuracyCircle.remove();
      accuracyCircle = null;
    }

    if (currentAccuracy) {
      accuracyCircle = L.circle([lat, lng], {
        radius: currentAccuracy,
        color: "#0f766e",
        weight: 1,
        opacity: 0.75,
        fillColor: "#0f766e",
        fillOpacity: 0.12
      }).addTo(map);
    }
  }

  async function reverseGeocode(lat, lng) {
    const url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
      encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lng);

    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error("Address lookup failed");
      const result = await response.json();
      field("address").value = result.display_name || "";
    } catch (error) {
      field("address").value = "";
      setMessage("Address lookup is unavailable right now. Coordinates were captured.", "error");
    }
  }

  function numericValue(id) {
    const value = Number(field(id).value);
    return Number.isFinite(value) ? value : 0;
  }

  function calculateScores() {
    const conditions = getSelectedConditions();
    const severity = Number(field("severity").value);
    const verticalDisplacement = numericValue("verticalDisplacement");
    const gapWidth = numericValue("gapWidth");
    const runningSlope = numericValue("runningSlope");
    const crossSlope = numericValue("crossSlope");
    const passableWidth = numericValue("passableWidth");
    const obstructionType = field("obstructionType").value;
    const curbRampCondition = field("curbRampCondition").value;
    const detectableWarning = field("detectableWarning").value;
    const pedestrianVolume = field("pedestrianVolume").value;
    const schoolTransitProximity = field("schoolTransitProximity").value;

    const severityPenalty = Math.max(0, severity - 1) * SCORE_CONFIG.severityPenaltyStep;
    const displacementPenalty = Math.min(SCORE_CONFIG.displacementPenaltyMax, verticalDisplacement * SCORE_CONFIG.displacementPenaltyPerInch);
    const gapPenalty = Math.min(SCORE_CONFIG.gapPenaltyMax, gapWidth * SCORE_CONFIG.gapPenaltyPerInch);
    const widthPenalty = passableWidth > 0 && passableWidth < SCORE_CONFIG.passableWidthTargetFt
      ? Math.min(SCORE_CONFIG.passableWidthPenaltyMax, (SCORE_CONFIG.passableWidthTargetFt - passableWidth) * SCORE_CONFIG.passableWidthPenaltyPerFt)
      : 0;
    const obstructionPenalty = obstructionType === "None" ? 0 : SCORE_CONFIG.obstructionPenalty;
    const curbRampPenalty = SCORE_CONFIG.curbRampPenalty[curbRampCondition] || 0;
    const detectableWarningPenalty = SCORE_CONFIG.detectableWarningPenalty[detectableWarning] || 0;
    const runningSlopePenalty = runningSlope > 5 ? Math.min(14, (runningSlope - 5) * 2) : 0;
    const crossSlopePenalty = crossSlope > 2 ? Math.min(16, (crossSlope - 2) * 4) : 0;
    const conditionPenalty = conditions.reduce((total, condition) => {
      return total + (SCORE_CONFIG.conditionPenalty[condition] || 0);
    }, 0);

    const gisScore = 100 -
      Math.min(55, conditionPenalty) -
      severityPenalty -
      displacementPenalty -
      gapPenalty -
      widthPenalty -
      obstructionPenalty -
      curbRampPenalty -
      detectableWarningPenalty -
      runningSlopePenalty -
      crossSlopePenalty;

    let priorityScore = (100 - Math.max(0, Math.min(100, gisScore))) * SCORE_CONFIG.priorityConditionWeight;
    priorityScore += severity * SCORE_CONFIG.prioritySeverityStep;
    priorityScore += verticalDisplacement >= 0.5 ? SCORE_CONFIG.priorityDisplacementHalfInch : 0;
    priorityScore += verticalDisplacement >= 1 ? SCORE_CONFIG.priorityDisplacementOneInch : 0;
    priorityScore += gapWidth >= 1 ? SCORE_CONFIG.priorityGapOneInch : 0;
    priorityScore += passableWidth > 0 && passableWidth < SCORE_CONFIG.passableWidthTargetFt ? SCORE_CONFIG.priorityNarrowWidth : 0;
    priorityScore += obstructionType === "None" ? 0 : SCORE_CONFIG.priorityObstruction;
    priorityScore += curbRampCondition !== "Good" && curbRampCondition !== "Not Applicable" ? SCORE_CONFIG.priorityCurbRampIssue : 0;
    priorityScore += detectableWarning !== "Present" && detectableWarning !== "Not Applicable" ? SCORE_CONFIG.priorityDetectableWarning : 0;
    priorityScore += runningSlope > 5 ? SCORE_CONFIG.priorityRunningSlope : 0;
    priorityScore += crossSlope > 2 ? SCORE_CONFIG.priorityCrossSlope : 0;
    priorityScore += pedestrianVolume === "High" ? SCORE_CONFIG.priorityPedestrianHigh : pedestrianVolume === "Medium" ? SCORE_CONFIG.priorityPedestrianMedium : 0;
    priorityScore += schoolTransitProximity === "Yes" ? SCORE_CONFIG.prioritySchoolTransit : 0;

    return {
      gisScore: Math.round(Math.max(0, Math.min(100, gisScore))),
      priorityScore: Math.round(Math.max(0, Math.min(100, priorityScore)))
    };
  }

  function calculateScore() {
    return calculateScores().gisScore;
  }

  function getClass(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 50) return "Fair";
    if (score >= 25) return "Poor";
    return "Failed";
  }

  function getPriorityClass(score) {
    if (score >= 75) return "Critical";
    if (score >= 55) return "High";
    if (score >= 30) return "Medium";
    return "Low";
  }

  function runScoring() {
    const scores = calculateScores();
    field("scoreValue").textContent = scores.gisScore + " / 100";
    field("scoreClass").textContent = getClass(scores.gisScore);
    field("priorityValue").textContent = getPriorityClass(scores.priorityScore) + " (" + scores.priorityScore + ")";
  }

  function getSelectedConditions() {
    return Array.from(field("condition").selectedOptions)
      .map((option) => option.value || option.textContent)
      .filter((value) => value && value !== "No Issues");
  }

  function setSelectedConditions(values) {
    const selected = values.length ? values : ["No Issues"];
    Array.from(field("condition").options).forEach((option) => {
      option.selected = selected.indexOf(option.value || option.textContent) !== -1;
    });
  }

  function conditionIncludes(value) {
    return getSelectedConditions().indexOf(value) !== -1;
  }

  function applyPreset(preset) {
    const presets = {
      trip: {
        reportType: "Point Issue",
        conditions: ["Heaving"],
        severity: "3",
        message: "Trip hazard preset applied."
      },
      blocked: {
        reportType: "Point Issue",
        conditions: ["Obstruction"],
        severity: "3",
        obstructionType: "Other",
        message: "Blocked sidewalk preset applied."
      },
      curb: {
        reportType: "Point Issue",
        conditions: ["Curb Ramp"],
        severity: "2",
        curbRampCondition: "Poor",
        detectableWarning: "Missing",
        message: "Curb ramp issue preset applied."
      },
      segment: {
        reportType: "Sidewalk Segment",
        conditions: ["Cracking", "Heaving"],
        severity: "2",
        message: "Long bad section preset applied. Set the segment start and end in the location step."
      }
    };
    const config = presets[preset];
    if (!config) return;

    field("reportType").value = config.reportType;
    field("severity").value = config.severity;
    setSelectedConditions(config.conditions);
    if (config.obstructionType) field("obstructionType").value = config.obstructionType;
    if (config.curbRampCondition) field("curbRampCondition").value = config.curbRampCondition;
    if (config.detectableWarning) field("detectableWarning").value = config.detectableWarning;

    [
      "reportType", "condition", "severity", "obstructionType", "curbRampCondition", "detectableWarning"
    ].forEach(syncSegmentedControl);
    updateReportTypeUI();
    updateMeasurementVisibility();
    updateConditionHelp();
    setMessage(config.message, "ok");
    scheduleDraftSave();
  }

  function updateConditionHelp() {
    const help = field("conditionHelp");
    if (!help) return;

    const conditions = getSelectedConditions();
    help.replaceChildren();

    if (!conditions.length) {
      appendConditionHelpParagraph(help, "Select a preset or choose all issue types that apply.");
      return;
    }

    const guidance = {
      Cracking: "Cracking: note the length/extent in comments and measure any related gap or displacement.",
      Heaving: "Heaving: measure vertical displacement and add a close-up photo when it creates a trip hazard.",
      Gaps: "Gaps: measure gap width and note whether wheels, canes, or walkers may catch.",
      Spalling: "Spalling: photo texture and extent; use comments for drainage or surface deterioration.",
      Obstruction: "Obstruction: choose obstruction type and estimate the remaining passable width.",
      "Curb Ramp": "Curb Ramp: record ramp condition, detectable warning status, passable width, and running slope if measured.",
      "Running Slope/Cross Slope": "Slope: running slope should generally be below 5% for sidewalks; cross slope should not exceed 2%.",
      Other: "Other: describe the issue clearly in comments and attach at least one context photo."
    };

    conditions.forEach((condition) => {
      appendConditionHelpParagraph(help, guidance[condition] || condition);
    });
  }

  function appendConditionHelpParagraph(container, text) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    container.appendChild(paragraph);
  }

  function enhanceConditionControl() {
    const select = field("condition");
    const segmented = document.createElement("div");
    segmented.className = "segmented";
    segmented.setAttribute("data-for", "condition");

    Array.from(select.options).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segment-button";
      button.textContent = option.textContent;
      button.dataset.value = option.value || option.textContent;
      button.addEventListener("click", () => {
        const value = button.dataset.value;
        let selected = getSelectedConditions();

        if (value === "No Issues") {
          selected = [];
        } else if (selected.indexOf(value) === -1) {
          selected.push(value);
        } else {
          selected = selected.filter((item) => item !== value);
        }

        setSelectedConditions(selected);
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncSegmentedControl("condition");
      });
      segmented.appendChild(button);
    });

    setSelectedConditions([]);
    select.classList.add("enhanced-select");
    select.insertAdjacentElement("afterend", segmented);
    syncSegmentedControl("condition");
  }

  function enhanceSelectControls() {
    enhanceConditionControl();
    [
      "reportType", "severity", "pedestrianVolume", "schoolTransitProximity",
      "curbRampCondition", "detectableWarning", "obstructionType"
    ].forEach((id) => {
      const select = field(id);
      const segmented = document.createElement("div");
      segmented.className = "segmented";
      segmented.setAttribute("data-for", id);

      Array.from(select.options).forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "segment-button";
        button.textContent = option.textContent;
        button.dataset.value = option.value || option.textContent;
        button.addEventListener("click", () => {
          select.value = button.dataset.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          syncSegmentedControl(id);
        });
        segmented.appendChild(button);
      });

      select.classList.add("enhanced-select");
      select.insertAdjacentElement("afterend", segmented);
      syncSegmentedControl(id);
    });
  }

  function syncSegmentedControl(id) {
    const select = field(id);
    const segmented = document.querySelector('[data-for="' + id + '"]');
    if (!segmented) return;

    segmented.querySelectorAll(".segment-button").forEach((button) => {
      if (id === "condition") {
        const selected = getSelectedConditions();
        const active = button.dataset.value === "No Issues" ? selected.length === 0 : selected.indexOf(button.dataset.value) !== -1;
        button.classList.toggle("active", active);
      } else {
        button.classList.toggle("active", button.dataset.value === select.value);
      }
    });
  }

  function updateMeasurementVisibility() {
    const hasCracking = conditionIncludes("Cracking");
    const hasHeaving = conditionIncludes("Heaving");
    const hasGaps = conditionIncludes("Gaps");
    const hasObstruction = conditionIncludes("Obstruction");
    const hasCurbRamp = conditionIncludes("Curb Ramp");
    const hasSlope = conditionIncludes("Running Slope/Cross Slope");
    const hasOther = conditionIncludes("Other");
    const visible = {
      vertical: hasHeaving || hasCracking || hasOther,
      gap: hasGaps || hasCracking || hasOther,
      obstruction: hasObstruction,
      width: hasObstruction || hasCurbRamp,
      "curb-ramp": hasCurbRamp,
      "detectable-warning": hasCurbRamp,
      "running-slope": hasSlope || hasCurbRamp,
      "cross-slope": hasSlope
    };

    document.querySelectorAll("[data-measurement]").forEach((group) => {
      const key = group.getAttribute("data-measurement");
      const isVisible = Boolean(visible[key]);
      group.classList.toggle("field-hidden", !isVisible);
      group.querySelectorAll("input, select").forEach((control) => {
        control.disabled = !isVisible;
        if (!isVisible) {
          if (control.tagName === "SELECT") control.selectedIndex = 0;
          else control.value = "";
        }
      });
    });

    [
      "condition", "obstructionType", "curbRampCondition", "detectableWarning"
    ].forEach(syncSegmentedControl);
    runScoring();
  }

  function bindForm() {
    enhanceSelectControls();

    [
      "reportType", "condition", "severity", "verticalDisplacement", "gapWidth", "runningSlope", "crossSlope", "obstructionType",
      "passableWidth", "curbRampCondition", "detectableWarning", "pedestrianVolume",
      "schoolTransitProximity"
    ].forEach((id) => field(id).addEventListener("input", runScoring));
    field("reportType").addEventListener("change", updateReportTypeUI);
    field("condition").addEventListener("change", updateMeasurementVisibility);
    field("condition").addEventListener("change", updateConditionHelp);
    field("photo").addEventListener("change", updatePhotoStatus);
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });
    document.querySelectorAll("[data-next-section]").forEach((button) => {
      button.addEventListener("click", () => openSurveyStep(button.dataset.nextSection));
    });
    field("downloadButton").addEventListener("click", downloadCsv);
    field("reviewButton").addEventListener("click", reviewReport);
    field("resumeDraftButton").addEventListener("click", resumeDraft);
    field("discardDraftButton").addEventListener("click", discardDraft);
    field("startNewReportButton").addEventListener("click", startNewReport);
    field("startNearbyReportButton").addEventListener("click", startNearbyReport);
    field("startAssessmentButton").addEventListener("click", startAssessment);
    field("startRecorderButton").addEventListener("click", startRecorderMode);
    field("backToIntroFromSurvey").addEventListener("click", backToIntroFromSurvey);
    field("backToIntroFromRecorder").addEventListener("click", backToIntroFromRecorder);
    field("improveRecorderGpsButton").addEventListener("click", improveRecorderGpsStart);
    field("startRecordingButton").addEventListener("click", handleStartPauseRecording);
    field("stopRecordingButton").addEventListener("click", stopRecorder);
    field("addRecorderNoteButton").addEventListener("click", () => {
      addRecorderNote().catch((error) => handleAppError("Recorder note could not be saved.", error, setRecorderMessage));
    });
    field("captureRecorderPhotoButton").addEventListener("click", () => field("recorderPhoto").click());
    field("recorderPhoto").addEventListener("change", () => {
      captureRecorderPhotos().catch((error) => handleAppError("Recorder photo could not be saved.", error, setRecorderMessage));
    });
    field("exportAllRecorderGeoJsonButton").addEventListener("click", exportAllRecorderGeoJson);
    field("exportCurrentRecorderGeoJsonButton").addEventListener("click", exportCurrentRecorderGeoJson);
    field("clearRecorderSessionsButton").addEventListener("click", clearRecorderSessions);
    field("loadBlocksButton").addEventListener("click", loadRecorderBlocks);
    field("clearSelectedBlockButton").addEventListener("click", clearSelectedRecorderBlock);
    field("zoomSelectedBlockButton").addEventListener("click", zoomSelectedRecorderBlock);
    document.querySelectorAll("[data-review-filter]").forEach((button) => {
      button.addEventListener("click", () => setRecorderReviewFilter(button.dataset.reviewFilter));
    });
    document.querySelectorAll("[data-recorder-detail-mode]").forEach((button) => {
      button.addEventListener("click", () => setRecorderDetailMode(button.dataset.recorderDetailMode));
    });
    document.querySelectorAll(".condition-toggle").forEach((button) => {
      button.addEventListener("click", () => setRecorderCondition(button.dataset.condition));
    });
    ["reporterName", "email"].forEach((id) => {
      field(id).addEventListener("change", saveContactInfo);
      field(id).addEventListener("input", updateContactSavedNote);
    });
    field("surveyForm").addEventListener("input", refreshCurrentStepProgress);
    field("surveyForm").addEventListener("change", refreshCurrentStepProgress);
    field("surveyForm").addEventListener("input", scheduleDraftSave);
    field("surveyForm").addEventListener("change", scheduleDraftSave);

    field("surveyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitReport();
    });

    updateMeasurementVisibility();
    updateConditionHelp();
    openSurveyStep("locationSection", false);
    showDraftRecovery();
  }

  function bindSettings() {
    field("uploadUrl").value = getUploadUrl();
    field("blockLayerUrl").value = getBlockLayerUrl();
    field("saveSettingsButton").addEventListener("click", () => {
      const uploadUrl = field("uploadUrl").value.trim();
      const blockLayerUrl = field("blockLayerUrl").value.trim();
      if (uploadUrl && !isValidUploadUrl(uploadUrl)) {
        setMessage("Upload URL was not saved. Use a valid HTTPS endpoint URL.", "error");
        return;
      }
      if (blockLayerUrl && !isValidUploadUrl(blockLayerUrl)) {
        setMessage("Block layer URL was not saved. Use a valid HTTPS ArcGIS layer URL.", "error");
        return;
      }
      localStorage.setItem(UPLOAD_URL_KEY, uploadUrl);
      localStorage.setItem(BLOCK_LAYER_URL_KEY, blockLayerUrl);
      updateUploadStatus();
      setMessage("Settings saved.", "ok");
    });
  }

  function updateStepProgress(activeSectionId) {
    const currentStep = SURVEY_STEPS.find((step) => step.id === activeSectionId) || SURVEY_STEPS[0];
    let actionText = currentStep.action;
    if (activeSectionId === "locationSection") {
      actionText = isSegmentReport()
        ? "For a sidewalk segment, capture the start and end of the bad stretch."
        : "For a point issue, place the target on the exact spot and confirm it.";
    }
    field("nextAction").textContent = actionText;
  }

  function refreshCurrentStepProgress() {
    const openSection = document.querySelector(".survey-section.active-step");
    updateStepProgress(openSection ? openSection.id : "locationSection");
  }

  function scheduleDraftSave() {
    if (!draftAutosaveEnabled) return;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 300);
  }

  function saveDraft() {
    if (!draftAutosaveEnabled) return;

    const draft = {
      savedAt: new Date().toISOString(),
      reportType: field("reportType").value,
      reporterName: sanitizeTextInput(field("reporterName").value),
      email: sanitizeTextInput(field("email").value),
      latitude: field("latitude").value,
      longitude: field("longitude").value,
      address: sanitizeTextInput(field("address").value),
      currentAccuracy: currentAccuracy,
      locationLocked: locationLocked,
      locationConfirmed: locationConfirmed,
      conditions: getSelectedConditions(),
      severity: field("severity").value,
      verticalDisplacement: field("verticalDisplacement").value,
      gapWidth: field("gapWidth").value,
      runningSlope: field("runningSlope").value,
      crossSlope: field("crossSlope").value,
      obstructionType: field("obstructionType").value,
      passableWidth: field("passableWidth").value,
      curbRampCondition: field("curbRampCondition").value,
      detectableWarning: field("detectableWarning").value,
      pedestrianVolume: field("pedestrianVolume").value,
      schoolTransitProximity: field("schoolTransitProximity").value,
      comments: sanitizeTextInput(field("comments").value),
      photoCaptions: getPhotoCaptions(),
      photoNames: Array.from(field("photo").files || []).map((photo) => photo.name),
      segmentStart: segmentStart,
      segmentEnd: segmentEnd
    };

    const hasUsefulDraft = draft.conditions.length || draft.comments || draft.photoNames.length ||
      draft.latitude !== DEFAULT_LOCATION.lat.toFixed(7) || draft.reporterName || draft.email;

    if (hasUsefulDraft) {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    }
  }

  function showDraftRecovery() {
    const draft = getSavedDraft();
    field("draftPanel").classList.toggle("visible", Boolean(draft));
  }

  function getSavedDraft() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
    } catch (error) {
      handleAppError("Saved draft could not be read.", error, setMessage);
      return null;
    }
  }

  function resumeDraft() {
    const draft = getSavedDraft();
    if (!draft) return;

    draftAutosaveEnabled = false;
    field("reportType").value = draft.reportType || "Point Issue";
    field("reporterName").value = draft.reporterName || "";
    field("email").value = draft.email || "";
    field("severity").value = draft.severity || "1";
    field("verticalDisplacement").value = draft.verticalDisplacement || "";
    field("gapWidth").value = draft.gapWidth || "";
    field("runningSlope").value = draft.runningSlope || "";
    field("crossSlope").value = draft.crossSlope || "";
    field("obstructionType").value = draft.obstructionType || "None";
    field("passableWidth").value = draft.passableWidth || "";
    field("curbRampCondition").value = draft.curbRampCondition || "Not Applicable";
    field("detectableWarning").value = draft.detectableWarning || "Not Applicable";
    field("pedestrianVolume").value = draft.pedestrianVolume || "Low";
    field("schoolTransitProximity").value = draft.schoolTransitProximity || "No";
    field("comments").value = draft.comments || "";
    setSelectedConditions(draft.conditions || []);
    currentAccuracy = draft.currentAccuracy || null;
    locationLocked = Boolean(draft.locationLocked);
    locationConfirmed = Boolean(draft.locationConfirmed);
    segmentStart = draft.segmentStart || null;
    segmentEnd = draft.segmentEnd || null;

    [
      "reportType", "condition", "severity", "obstructionType", "curbRampCondition",
      "detectableWarning", "pedestrianVolume", "schoolTransitProximity"
    ].forEach(syncSegmentedControl);
    updateReportTypeUI();
    updateMeasurementVisibility();
    updateConditionHelp();
    updateContactSavedNote();

    if (draft.latitude && draft.longitude) {
      setLocation(Number(draft.latitude), Number(draft.longitude), false, currentAccuracy);
      field("address").value = draft.address || "";
      locationConfirmed = Boolean(draft.locationConfirmed);
    }

    if (segmentStart || segmentEnd) {
      updateSegmentPreview();
    } else {
      updateLocationConfirmationStatus();
    }

    field("draftPanel").classList.remove("visible");
    openSurveyStep("locationSection");
    setMessage("Draft restored. Reattach photos if needed before submitting.", "ok");
    draftAutosaveEnabled = true;
    scheduleDraftSave();
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    field("draftPanel").classList.remove("visible");
    setMessage("Draft cleared. Start a fresh report when ready.", "");
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    field("draftPanel").classList.remove("visible");
  }

  async function reviewReport() {
    try {
      const report = await buildReport();
      const validation = validateReport(report);
      populateReview(report);

      if (!validation.ok) {
        setReviewNotice(validation.message + " Use the Edit button below to fix it.", "error");
        openSurveyStep("reviewSection");
        return;
      }

      setReviewNotice("Ready to submit. Review the summary below, then submit when ready.", "ok");
      openSurveyStep("reviewSection");
      setMessage("Review the report summary, then submit when it looks right.", "ok");
    } catch (error) {
      setMessage(error.message || "The report could not be reviewed.", "error");
    }
  }

  function populateReview(report) {
    const review = field("reviewGrid");
    if (!review) return;

    const locationText = report.reportType === "Sidewalk Segment"
      ? "Segment, " + (report.segmentLengthFt || "--") + " ft"
      : report.latitude + ", " + report.longitude;
    const reviewItems = [
      ["Report Type", report.reportType, "locationSection"],
      ["Conditions", report.condition || "--", "conditionSection"],
      ["Severity", severityLabel(report.severity), "conditionSection"],
      ["Measurements", measurementSummary(report), "measurementsSection"],
      ["Location", locationText, "locationSection"],
      ["Photos", report.photoCount + " attached", "photoSection"],
      ["Photo Captions", report.photoCaptions || "--", "photoSection"],
      ["Context/Comments", contextSummary(report), "contextSection"],
      ["Contact", [report.reporterName, report.email].filter(Boolean).join(" / ") || "--", "contactSection"],
      ["Priority", report.priorityClass + " (" + report.priorityScore + ")", "conditionSection"],
      ["GIS Score", report.score + " / 100 - " + report.conditionClass, "conditionSection"]
    ];

    review.replaceChildren();
    reviewItems.forEach(([label, value, sectionId]) => {
      const div = document.createElement("div");
      div.className = "review-item";
      const actions = document.createElement("div");
      actions.className = "review-actions";
      const strong = document.createElement("strong");
      strong.textContent = label;
      const button = document.createElement("button");
      button.className = "secondary";
      button.type = "button";
      button.dataset.editSection = sectionId;
      button.textContent = "Edit";
      const span = document.createElement("span");
      span.textContent = value;
      actions.append(strong, button);
      div.append(actions, span);
      review.appendChild(div);
    });

    review.querySelectorAll("[data-edit-section]").forEach((button) => {
      button.addEventListener("click", () => openSurveyStep(button.dataset.editSection));
    });
  }

  function setReviewNotice(text, type) {
    const notice = field("reviewNotice");
    notice.textContent = text;
    notice.className = "message" + (type ? " " + type : "");
  }

  function getCurrentReportSnapshot() {
    const scores = calculateScores();
    const photos = Array.from(field("photo").files || []);
    const segmentLength = segmentStart && segmentEnd ? Math.round(calculateSegmentLengthFt(segmentStart, segmentEnd)) : "";

    return {
      reporterName: field("reporterName").value.trim(),
      email: field("email").value.trim(),
      reportType: field("reportType").value,
      latitude: field("latitude").value,
      longitude: field("longitude").value,
      locationConfirmed: locationConfirmed ? "Yes" : "No",
      condition: getSelectedConditions().join("; "),
      severity: field("severity").value,
      segmentStartLat: segmentStart ? segmentStart.lat.toFixed(7) : "",
      segmentStartLng: segmentStart ? segmentStart.lng.toFixed(7) : "",
      segmentEndLat: segmentEnd ? segmentEnd.lat.toFixed(7) : "",
      segmentEndLng: segmentEnd ? segmentEnd.lng.toFixed(7) : "",
      segmentLengthFt: segmentLength,
      photoName: photos.map((photo) => photo.name).join("; "),
      photoCount: photos.length,
      score: scores.gisScore,
      conditionClass: getClass(scores.gisScore),
      priorityScore: scores.priorityScore,
      priorityClass: getPriorityClass(scores.priorityScore)
    };
  }

  function measurementSummary(report) {
    const parts = [];
    if (report.verticalDisplacement) parts.push("Vertical: " + report.verticalDisplacement + " in");
    if (report.gapWidth) parts.push("Gap: " + report.gapWidth + " in");
    if (report.runningSlope) parts.push("Running slope: " + report.runningSlope + "%");
    if (report.crossSlope) parts.push("Cross slope: " + report.crossSlope + "%");
    if (report.passableWidth) parts.push("Width: " + report.passableWidth + " ft");
    if (report.curbRampCondition && report.curbRampCondition !== "Not Applicable") parts.push("Curb ramp: " + report.curbRampCondition);
    if (report.detectableWarning && report.detectableWarning !== "Not Applicable") parts.push("Detectable warning: " + report.detectableWarning);
    return parts.length ? parts.join("; ") : "No measurements entered";
  }

  function contextSummary(report) {
    const parts = [];
    if (report.pedestrianVolume) parts.push("Pedestrian volume: " + report.pedestrianVolume);
    if (report.schoolTransitProximity) parts.push("School/transit proximity: " + report.schoolTransitProximity);
    if (report.comments) parts.push("Comments: " + report.comments);
    return parts.length ? parts.join("; ") : "--";
  }

  function severityLabel(value) {
    const option = Array.from(field("severity").options).find((item) => item.value === String(value));
    return option ? option.textContent : String(value || "--");
  }

  function updateContactSavedNote() {
    const contact = getSavedContactInfo();
    const hasSaved = Boolean(contact.reporterName || contact.email);
    const matches = (!contact.reporterName || field("reporterName").value === contact.reporterName) &&
      (!contact.email || field("email").value === contact.email);
    field("contactSavedNote").classList.toggle("visible", hasSaved && matches);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function sanitizeTextInput(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
  }

  async function submitReport() {
    field("submitButton").disabled = true;

    try {
      const report = await buildReport();
      const validation = validateReport(report);

      if (!validation.ok) {
        populateReview(report);
        setReviewNotice(validation.message + " Use the Edit button below to fix it.", "error");
        setMessage(validation.message, "error");
        openSurveyStep("reviewSection");
        return;
      }

      saveReport(report);

      let uploaded = false;
      let uploadErrorMessage = "";
      try {
        uploaded = await uploadReport(report);
      } catch (uploadError) {
        uploadErrorMessage = getErrorMessage(uploadError) || "Upload failed.";
        debugLog("Upload failed after local save.", uploadError);
      }
      updateSavedCount();

      if (uploaded === "sent") {
        setMessage("Report saved locally and sent to the spreadsheet endpoint. Check the sheet to confirm it arrived.", "ok");
      } else if (uploaded) {
        setMessage("Report saved and uploaded.", "ok");
      } else if (uploadErrorMessage) {
        setMessage("Report saved in this browser, but upload failed. " + uploadErrorMessage, "error");
      } else {
        setMessage("Report saved in this browser. Add the Google Apps Script or Power Automate URL to upload to a spreadsheet.", "ok");
      }

      showSuccess(report);
      clearDraft();
      resetFormAfterSubmit();
      setLocation(Number(report.latitude), Number(report.longitude), false, report.locationAccuracy || null);
      runScoring();
    } catch (error) {
      setMessage(error.message || "The report could not be submitted.", "error");
    } finally {
      field("submitButton").disabled = false;
    }
  }

  function validateReport(report) {
    const defaultLat = DEFAULT_LOCATION.lat.toFixed(7);
    const defaultLng = DEFAULT_LOCATION.lng.toFixed(7);
    const hasDefaultLocation = report.latitude === defaultLat && report.longitude === defaultLng;
    const severity = Number(report.severity);

    if (report.website) {
      return { ok: false, sectionId: "conditionSection", message: "The report could not be submitted." };
    }

    if (hasDefaultLocation) {
      return { ok: false, sectionId: "locationSection", message: "Use GPS or pan the map target to the sidewalk issue before submitting." };
    }

    if (report.reportType === "Sidewalk Segment" && (!report.segmentStartLat || !report.segmentStartLng || !report.segmentEndLat || !report.segmentEndLng)) {
      return { ok: false, sectionId: "locationSection", message: "Set both the segment start and end points before submitting." };
    }

    if (!locationConfirmed) {
      return { ok: false, sectionId: "locationSection", message: "Confirm the marker location before submitting." };
    }

    if (!getSelectedConditions().length) {
      return { ok: false, sectionId: "conditionSection", message: "Choose at least one issue type before submitting." };
    }

    if (report.locationAccuracy && Number(report.locationAccuracy) > 50) {
      return { ok: false, sectionId: "locationSection", message: "GPS accuracy is wider than 50 m. Use My Location again or pan the map target to the issue." };
    }

    if (severity >= 3 && !report.photoName) {
      return { ok: false, sectionId: "photoSection", message: "Add a photo for poor or missing sidewalk reports." };
    }

    if (conditionIncludes("Obstruction") && report.obstructionType === "None") {
      return { ok: false, sectionId: "measurementsSection", message: "Choose an obstruction type for obstruction reports." };
    }

    return { ok: true };
  }

  function showSuccess(report) {
    lastSubmittedReport = report;
    field("successReportId").textContent = report.reportId;
    field("successReportType").textContent = report.reportType;
    field("successPriority").textContent = report.priorityClass + " (" + report.priorityScore + ")";
    field("successScore").textContent = report.score + " / 100 - " + report.conditionClass;
    field("successPhotos").textContent = report.photoCount + " photo" + (report.photoCount === 1 ? "" : "s") + " uploaded";
    field("successLocation").textContent = report.reportType === "Sidewalk Segment"
      ? "Segment length about " + (report.segmentLengthFt || "--") + " ft"
      : report.latitude + ", " + report.longitude;
    field("successPanel").style.display = "block";
    field("surveyForm").style.display = "none";
    field("successPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFormAfterSubmit() {
    draftAutosaveEnabled = false;
    const contact = getSavedContactInfo();
    field("surveyForm").reset();
    setSelectedConditions([]);
    field("severity").value = "1";
    field("reporterName").value = contact.reporterName || "";
    field("email").value = contact.email || "";
    [
      "reportType", "condition", "severity", "pedestrianVolume", "schoolTransitProximity",
      "curbRampCondition", "detectableWarning", "obstructionType"
    ].forEach(syncSegmentedControl);
    clearSegment(false);
    updateReportTypeUI();
    updatePhotoStatus();
    updateMeasurementVisibility();
    markLocationUnconfirmed();
    updateContactSavedNote();
    draftAutosaveEnabled = true;
  }

  function startNewReport() {
    resetFormAfterSubmit();
    field("successPanel").style.display = "none";
    field("surveyForm").style.display = "";
    field("formMessage").scrollIntoView({ behavior: "smooth", block: "start" });
    openSurveyStep("locationSection");
    setMessage("Start by choosing point or segment and confirming the map location.", "");
  }

  function startNearbyReport() {
    const source = lastSubmittedReport || {};
    const lat = source.latitude || field("latitude").value;
    const lng = source.longitude || field("longitude").value;
    const reportType = source.reportType || field("reportType").value;
    const pedestrianVolume = source.pedestrianVolume || field("pedestrianVolume").value;
    const schoolTransitProximity = source.schoolTransitProximity || field("schoolTransitProximity").value;
    const keepType = field("nearbyKeepType").checked;
    const keepContext = field("nearbyKeepContext").checked;
    const keepLocation = field("nearbyKeepLocation").checked;
    resetFormAfterSubmit();
    field("successPanel").style.display = "none";
    field("surveyForm").style.display = "";

    if (keepType) {
      field("reportType").value = reportType;
    }

    if (keepContext) {
      field("pedestrianVolume").value = pedestrianVolume;
      field("schoolTransitProximity").value = schoolTransitProximity;
    }

    [
      "reportType", "pedestrianVolume", "schoolTransitProximity"
    ].forEach(syncSegmentedControl);
    updateReportTypeUI();

    if (keepLocation && lat && lng) {
      setLocation(Number(lat), Number(lng), false, currentAccuracy);
    }

    openSurveyStep("locationSection");
    setMessage("Starting another report near the last location.", "ok");
    scheduleDraftSave();
  }

  function openSection(sectionId) {
    openSurveyStep(sectionId);
  }

  function openSurveyStep(sectionId, shouldScroll = true) {
    document.querySelectorAll(".survey-section").forEach((section) => {
      section.open = section.id === sectionId;
      section.classList.toggle("active-step", section.id === sectionId);
    });

    const section = field(sectionId);
    if (section && "open" in section) {
      section.open = true;
      section.classList.add("active-step");
      if (shouldScroll) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      updateStepProgress(sectionId);
      if (sectionId === "locationSection" && map) {
        setTimeout(() => map.invalidateSize(true), 120);
      }
    }
  }

  function startAssessment() {
    field("introScreen").style.display = "none";
    field("appShell").style.display = "grid";
    field("surveyPanel").style.display = "";
    field("recorderPanel").classList.remove("visible");
    openSurveyStep("locationSection");
    setMessage("Choose point or segment first, then confirm the location.", "");
    if (map) {
      setTimeout(() => map.invalidateSize(true), 100);
    }
  }

  function backToIntroFromSurvey() {
    field("recorderPanel").classList.remove("visible");
    field("surveyPanel").style.display = "";
    field("appShell").style.display = "none";
    field("introScreen").style.display = "";
    setMessage("Start with location, then move through photos, condition, context, measurements, contact, and submit.", "");
  }

  function saveContactInfo() {
    const contact = {
      reporterName: sanitizeTextInput(field("reporterName").value),
      email: sanitizeTextInput(field("email").value)
    };
    localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(contact));
    updateContactSavedNote();
  }

  function getSavedContactInfo() {
    try {
      return JSON.parse(localStorage.getItem(CONTACT_STORAGE_KEY) || "{}");
    } catch (error) {
      handleAppError("Saved contact information could not be read.", error, setMessage);
      return {};
    }
  }

  function restoreContactInfo() {
    const contact = getSavedContactInfo();
    field("reporterName").value = contact.reporterName || "";
    field("email").value = contact.email || "";
    updateContactSavedNote();
  }

  async function buildReport() {
    const scores = calculateScores();
    const photos = Array.from(field("photo").files || []);
    const photoValidation = validatePhotoFiles(photos);
    if (!photoValidation.ok) {
      throw new Error(photoValidation.message);
    }
    const reportType = field("reportType").value;
    const segmentLength = segmentStart && segmentEnd ? Math.round(calculateSegmentLengthFt(segmentStart, segmentEnd)) : "";
    const photoItems = await Promise.all(photos.map(async (photo, index) => {
      const dataUrl = await fileToDataUrl(photo);
      return {
        name: photo.name,
        type: getDataUrlType(dataUrl) || photo.type,
        size: photo.size,
        caption: getPhotoCaption(index),
        data: dataUrl
      };
    }));

    return {
      reportId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      submittedAt: new Date().toISOString(),
      website: field("website").value.trim(),
      reporterName: field("reporterName").value.trim(),
      email: field("email").value.trim(),
      reportType: reportType,
      latitude: field("latitude").value,
      longitude: field("longitude").value,
      locationAccuracy: currentAccuracy ? Math.round(currentAccuracy) : "",
      locationConfirmed: locationConfirmed ? "Yes" : "No",
      address: field("address").value,
      segmentStartLat: segmentStart ? segmentStart.lat.toFixed(7) : "",
      segmentStartLng: segmentStart ? segmentStart.lng.toFixed(7) : "",
      segmentEndLat: segmentEnd ? segmentEnd.lat.toFixed(7) : "",
      segmentEndLng: segmentEnd ? segmentEnd.lng.toFixed(7) : "",
      segmentLengthFt: segmentLength,
      condition: getSelectedConditions().join("; "),
      severity: field("severity").value,
      verticalDisplacement: field("verticalDisplacement").value,
      gapWidth: field("gapWidth").value,
      runningSlope: field("runningSlope").value,
      crossSlope: field("crossSlope").value,
      obstructionType: field("obstructionType").value,
      passableWidth: field("passableWidth").value,
      curbRampCondition: field("curbRampCondition").value,
      detectableWarning: field("detectableWarning").value,
      pedestrianVolume: field("pedestrianVolume").value,
      schoolTransitProximity: field("schoolTransitProximity").value,
      comments: field("comments").value.trim(),
      photoName: photoItems.map((photo) => photo.name).join("; "),
      photoType: photoItems.map((photo) => photo.type).join("; "),
      photoCaptions: sanitizeTextInput(photoItems.map((photo) => photo.caption).filter(Boolean).join("; ")),
      photoSize: photoItems.reduce((total, photo) => total + photo.size, 0),
      photoCount: photoItems.length,
      photoDataList: photoItems,
      photoData: photoItems[0] ? photoItems[0].data : "",
      score: scores.gisScore,
      conditionClass: getClass(scores.gisScore),
      priorityScore: scores.priorityScore,
      priorityClass: getPriorityClass(scores.priorityScore),
      gpsLocked: locationLocked ? "Yes" : "No"
    };
  }

  function updatePhotoStatus() {
    const photos = Array.from(field("photo").files || []);
    const previewGrid = field("photoPreviewGrid");

    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    photoPreviewUrls = [];
    previewGrid.replaceChildren();

    const validation = validatePhotoFiles(photos);
    if (!validation.ok) {
      field("photoStatus").textContent = validation.message;
      field("photoCountStatus").textContent = "Fix photos before submitting.";
      field("photo").value = "";
      previewGrid.style.display = "none";
      setMessage(validation.message, "error");
      return;
    }

    if (!photos.length) {
      field("photoStatus").textContent = "No photo selected.";
      field("photoCountStatus").textContent = "0 photos attached";
      previewGrid.style.display = "none";
      return;
    }

    const totalKb = photos.reduce((total, photo) => total + Math.max(1, Math.round(photo.size / 1024)), 0);
    field("photoStatus").textContent = photos.length + " photo" + (photos.length === 1 ? "" : "s") + " selected (" + totalKb + " KB total)";
    field("photoCountStatus").textContent = photos.length + " photo" + (photos.length === 1 ? "" : "s") + " attached";

    photos.forEach((photo, index) => {
      const url = URL.createObjectURL(photo);
      const card = document.createElement("div");
      card.className = "photo-preview-card";
      const image = document.createElement("img");
      image.src = url;
      image.alt = photo.name;
      const caption = document.createElement("input");
      caption.type = "text";
      caption.id = "photoCaption" + index;
      caption.placeholder = "Optional photo caption";
      caption.setAttribute("aria-label", "Caption for " + photo.name);
      caption.addEventListener("input", scheduleDraftSave);
      card.appendChild(image);
      card.appendChild(caption);
      previewGrid.appendChild(card);
      photoPreviewUrls.push(url);
    });

    previewGrid.style.display = "grid";
    openSection("conditionSection");
  }

  function getPhotoCaption(index) {
    const input = field("photoCaption" + index);
    return input ? sanitizeTextInput(input.value) : "";
  }

  function getPhotoCaptions() {
    return Array.from(field("photo").files || []).map((photo, index) => getPhotoCaption(index));
  }

  function getDataUrlType(dataUrl) {
    const match = /^data:([^;]+);base64,/.exec(dataUrl || "");
    return match ? match[1] : "";
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (file.type && file.type.indexOf("image/") === 0) {
        resizePhoto(file).then(resolve).catch((error) => {
          debugLog("Photo resize failed; falling back to original read.", error);
          readOriginalFile(file, resolve, reject);
        });
        return;
      }

      readOriginalFile(file, resolve, reject);
    });
  }

  function readOriginalFile(file, resolve, reject) {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Photo could not be read."));
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  }

  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const reader = new FileReader();

      reader.onload = () => {
        image.onload = () => {
          const maxSize = 600;
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          canvas.width = width;
          canvas.height = height;
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.55));
        };
        image.onerror = reject;
        image.src = reader.result;
      };

      reader.onerror = () => reject(new Error("Photo could not be resized."));
      try {
        reader.readAsDataURL(file);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function uploadReport(report) {
    const uploadUrl = getUploadUrl();
    if (!uploadUrl) return false;
    if (!isValidUploadUrl(uploadUrl)) {
      throw new Error("Upload URL is invalid. Use a valid HTTPS endpoint.");
    }

    if (uploadUrl.indexOf("script.google.com") !== -1) {
      await uploadGoogleReport(uploadUrl, report);
      return "sent";
    }

    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report)
      });

      if (!response.ok) {
        throw new Error("Spreadsheet upload failed.");
      }
    } catch (error) {
      debugLog("Primary sync request failed; trying no-cors fallback.", error);
      try {
        await fetch(uploadUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(report)
        });
      } catch (fallbackError) {
        throw new Error("Sync failed. " + getErrorMessage(fallbackError));
      }
    }

    return true;
  }

  async function uploadGoogleReport(uploadUrl, report) {
    const metadata = Object.assign({}, report, {
      action: "report",
      hasPhoto: Boolean(report.photoCount),
      photoDataLength: report.photoDataList.reduce((total, photo) => total + (photo.data ? photo.data.length : 0), 0),
      photoData: "",
      photoDataList: []
    });

    await postJsonNoCors(uploadUrl, metadata);

    if (report.photoDataList.length) {
      for (let i = 0; i < report.photoDataList.length; i++) {
        const photo = report.photoDataList[i];
        await postJsonNoCors(uploadUrl, {
          action: "photo",
          reportId: report.reportId,
          photoIndex: i + 1,
          photoTotal: report.photoDataList.length,
          photoName: photo.name,
          photoType: photo.type,
          photoCaption: photo.caption,
          photoData: photo.data
        });
      }
    } else if (report.photoData) {
      await postJsonNoCors(uploadUrl, {
        action: "photo",
        reportId: report.reportId,
        photoName: report.photoName,
        photoType: report.photoType,
        photoData: report.photoData
      });
    }
  }

  function postJsonNoCors(uploadUrl, data) {
    if (!isValidUploadUrl(uploadUrl)) {
      return Promise.reject(new Error("Upload URL is invalid."));
    }
    return fetch(uploadUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    }).catch((error) => {
      throw new Error("Sync failed. " + getErrorMessage(error));
    });
  }


  function getReports() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (error) {
      handleAppError("Saved reports could not be read.", error, setMessage);
      return [];
    }
  }

  function saveReport(report) {
    const reports = getReports();
    const localReport = Object.assign({}, report, {
      photoData: "",
      photoDataList: [],
      photoDataStored: Boolean(report.photoCount)
    });

    try {
      reports.push(localReport);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
      warnIfLocalStorageLarge(setMessage);
    } catch (error) {
      handleAppError("Local report backup was skipped.", error, setMessage);
    }
  }

  function updateSavedCount() {
    field("savedCount").textContent = String(getReports().length);
  }

  function resetSavedReportsFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "savedReports") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function getUploadUrl() {
    const uploadUrl = localStorage.getItem(UPLOAD_URL_KEY) || DEFAULT_UPLOAD_URL || "";
    return isValidUploadUrl(uploadUrl) ? uploadUrl : "";
  }

  function getBlockLayerUrl() {
    const blockLayerUrl = localStorage.getItem(BLOCK_LAYER_URL_KEY) || "";
    return isValidUploadUrl(blockLayerUrl) ? blockLayerUrl : "";
  }

  function isValidUploadUrl(url) {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && Boolean(parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function updateUploadStatus() {
    const hasUrl = Boolean(getUploadUrl());
    const uploadText = hasUrl ? "Spreadsheet upload configured" : "Spreadsheet upload not configured";
    field("uploadStatus").textContent = uploadText + " · " + APP_VERSION;
  }

  function updateSettingsVisibility() {
    const params = new URLSearchParams(window.location.search);
    const showSettings = params.get("settings") === "1";
    field("uploadSettings").classList.toggle("visible", showSettings);
    field("localExport").classList.toggle("visible", showSettings);
  }

  function setMessage(text, type) {
    const message = field("formMessage");
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
  }

  function handleAppError(userMessage, error, messageFn = setMessage) {
    debugLog(userMessage, error);
    messageFn(userMessage + " " + getErrorMessage(error), "error");
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : "";
  }

  function createEmptyRecorderState() {
    return {
      sessionId: "",
      status: "idle",
      condition: "Green",
      startedAt: "",
      endedAt: "",
      routeName: "",
      blockId: "",
      blockName: "",
      blockStatus: "",
      recorderName: "",
      email: "",
      points: [],
      segments: [],
      notes: [],
      photos: [],
      distanceFt: 0,
      lastAccuracy: null
    };
  }

  function startRecorderMode() {
    field("introScreen").style.display = "none";
    field("appShell").style.display = "grid";
    field("surveyPanel").style.display = "none";
    field("recorderPanel").classList.add("visible");

    const contact = getSavedContactInfo();
    field("recorderName").value = contact.reporterName || "";
    field("recorderEmail").value = contact.email || "";

    initRecorderMap();
    restoreActiveRecorderState();
    updateSelectedBlockUi();
    updateRecorderUi();
    renderRecorderReviewList();
    if (recorderState.status === "idle") {
      setRecorderMessage("Recorder ready. Default condition is Green / Good.", "");
    }
  }

  function backToIntroFromRecorder() {
    if (recorderState.status === "recording" || recorderState.status === "paused") {
      setRecorderMessage("Stop the active recording before leaving Recorder Mode.", "error");
      return;
    }

    stopRecorderStartWatch();
    field("recorderPanel").classList.remove("visible");
    field("surveyPanel").style.display = "";
    field("appShell").style.display = "none";
    field("introScreen").style.display = "";
  }

  function initRecorderMap() {
    if (recorderMap || !window.L) {
      if (recorderMap) setTimeout(() => recorderMap.invalidateSize(true), 100);
      return;
    }

    try {
      recorderMap = L.map("recorderMap", {
        tap: true,
        zoomControl: true,
        maxZoom: 22,
        zoomSnap: 0.5,
        zoomDelta: 0.5
      }).setView([DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng], 18);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxNativeZoom: 19,
        maxZoom: 22
      }).addTo(recorderMap);

      attachRecorderResizeObserver(field("recorderMap"));
      setTimeout(() => recorderMap.invalidateSize(true), 100);
      setTimeout(() => recorderMap.invalidateSize(true), 500);
      loadRecorderBlocks();
    } catch (error) {
      handleAppError("Recorder map initialization failed.", error, setRecorderMessage);
    }
  }

  function attachRecorderResizeObserver(el) {
    if (!("ResizeObserver" in window) || !el) return;
    if (recorderResizeObserver) recorderResizeObserver.disconnect();

    recorderResizeObserver = new ResizeObserver(() => {
      if (recorderMap) recorderMap.invalidateSize(true);
    });
    recorderResizeObserver.observe(el);
  }

  async function loadRecorderBlocks() {
    const blockLayerUrl = getBlockLayerUrl();
    if (!blockLayerUrl) {
      setRecorderMessage("No block layer URL is saved yet. Open Upload and map settings, paste the ArcGIS Blocks Layer URL, save settings, then tap Load Blocks again.", "error");
      return;
    }
    if (!recorderMap) {
      setRecorderMessage("Recorder map is not ready yet. Reopen Recorder Mode and try Load Blocks again.", "error");
      return;
    }

    try {
      clearRecorderBlockLayers();
      const queryUrl = blockLayerUrl.replace(/\/+$/, "") +
        "/query?where=1%3D1&outFields=blockId,blockName,status,assignedTo,priority&returnGeometry=true&outSR=4326&f=json";
      const response = await fetch(queryUrl, {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error("Block layer query failed.");

      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "Block layer query failed.");

      recorderBlocks = (result.features || []).map(normalizeRecorderBlockFeature).filter(Boolean);
      renderRecorderBlocks();
      setRecorderMessage(recorderBlocks.length
        ? "Loaded " + recorderBlocks.length + " sidewalk blocks. Tap a block line to select it before recording."
        : "Block layer loaded, but no block features were found.",
        recorderBlocks.length ? "ok" : "error");
    } catch (error) {
      setRecorderMessage("Blocks could not be loaded. Make sure the ArcGIS block layer is shared publicly or clear the block layer URL. " + getErrorMessage(error), "error");
    }
  }

  function normalizeRecorderBlockFeature(feature) {
    const attributes = feature.attributes || {};
    const paths = feature.geometry && Array.isArray(feature.geometry.paths) ? feature.geometry.paths : [];
    if (!paths.length) return null;

    return {
      blockId: textFromAttributes(attributes, ["blockId", "blockid", "BLOCKID"]),
      blockName: textFromAttributes(attributes, ["blockName", "blockname", "BLOCKNAME"]),
      status: textFromAttributes(attributes, ["status", "STATUS"]) || "Not Started",
      assignedTo: textFromAttributes(attributes, ["assignedTo", "assignedto", "ASSIGNEDTO"]),
      priority: textFromAttributes(attributes, ["priority", "PRIORITY"]),
      paths: paths
    };
  }

  function textFromAttributes(attributes, names) {
    for (const name of names) {
      if (attributes[name] !== undefined && attributes[name] !== null) return String(attributes[name]);
    }
    return "";
  }

  function renderRecorderBlocks() {
    clearRecorderBlockLayers();
    recorderBlocks.forEach((block) => {
      block.paths.forEach((path) => {
        const latLngs = path.map((coordinate) => [coordinate[1], coordinate[0]]);
        const layer = L.polyline(latLngs, {
          color: recorderBlockColor(block.status),
          weight: block.status === "Complete" ? 5 : 7,
          opacity: block.status === "Complete" ? 0.55 : 0.85,
          dashArray: block.status === "Complete" ? "6 6" : null
        }).addTo(recorderMap);
        layer.bindTooltip((block.blockName || block.blockId || "Sidewalk block") + " - " + block.status);
        layer.on("click", () => selectRecorderBlock(block));
        recorderBlockLayers.push({ blockId: block.blockId, layer: layer });
      });
    });
  }

  function clearRecorderBlockLayers() {
    recorderBlockLayers.forEach((item) => item.layer.remove());
    recorderBlockLayers = [];
  }

  function recorderBlockColor(status) {
    if (status === "Complete") return "#16a34a";
    if (status === "In Progress") return "#f59e0b";
    return "#6b7280";
  }

  function selectRecorderBlock(block) {
    selectedRecorderBlock = block;
    field("recorderRouteName").value = block.blockName || block.blockId || "";
    updateSelectedBlockUi();
    if (block.status === "Complete") {
      setRecorderMessage("Selected block is already Complete. Choose another block to avoid duplicate surveys.", "error");
    } else {
      setRecorderMessage("Selected block: " + (block.blockName || block.blockId || "Unnamed block") + ".", "ok");
    }
  }

  function clearSelectedRecorderBlock() {
    selectedRecorderBlock = null;
    updateSelectedBlockUi();
    setRecorderMessage("Block selection cleared.", "");
  }

  function updateSelectedBlockUi() {
    const label = field("selectedBlockLabel");
    const status = field("selectedBlockStatus");
    if (!selectedRecorderBlock) {
      label.textContent = "No block selected";
      status.textContent = "--";
      status.className = "block-status-pill";
      return;
    }

    label.textContent = selectedRecorderBlock.blockName || selectedRecorderBlock.blockId || "Unnamed block";
    status.textContent = selectedRecorderBlock.status || "Not Started";
    status.className = "block-status-pill" +
      (selectedRecorderBlock.status === "Complete" ? " complete" : "") +
      (selectedRecorderBlock.status === "In Progress" ? " in-progress" : "");
  }

  function zoomSelectedRecorderBlock() {
    if (!selectedRecorderBlock || !recorderMap) {
      setRecorderMessage("Select a block first.", "error");
      return;
    }

    const items = recorderBlockLayers.filter((item) => item.blockId === selectedRecorderBlock.blockId);
    if (!items.length) return;

    const group = L.featureGroup(items.map((item) => item.layer));
    recorderMap.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 21 });
  }

  function startRecorder() {
    if (!navigator.geolocation) {
      setRecorderMessage("This browser does not support GPS recording.", "error");
      return;
    }

    if (recorderStartFixActive) {
      setRecorderMessage("Wait for the GPS start fix to finish, then tap Start.", "error");
      return;
    }

    try {
      initRecorderMap();
    } catch (error) {
      handleAppError("Recorder map initialization failed.", error, setRecorderMessage);
      return;
    }
    stopRecorderWatch();
    stopRecorderStartWatch();
    clearRecorderMapLayers();
    recorderState = createEmptyRecorderState();
    recorderState.sessionId = makeId("REC");
    recorderState.status = "recording";
    recorderState.condition = "Green";
    recorderState.startedAt = new Date().toISOString();
    recorderState.routeName = sanitizeTextInput(field("recorderRouteName").value);
    if (selectedRecorderBlock && selectedRecorderBlock.status === "Complete") {
      setRecorderMessage("This block is already marked Complete. Choose another block or clear the block selection before recording.", "error");
      recorderState = createEmptyRecorderState();
      updateRecorderUi();
      return;
    }
    recorderState.blockId = selectedRecorderBlock ? selectedRecorderBlock.blockId : "";
    recorderState.blockName = selectedRecorderBlock ? selectedRecorderBlock.blockName : "";
    recorderState.blockStatus = selectedRecorderBlock ? selectedRecorderBlock.status : "";
    recorderState.recorderName = sanitizeTextInput(field("recorderName").value);
    recorderState.email = sanitizeTextInput(field("recorderEmail").value);
    recorderState.lastAccuracy = recorderStartPoint ? recorderStartPoint.accuracyMeters : null;
    saveRecorderContact();
    setRecorderCondition("Green");
    renderRecorderReviewList();
    setRecorderMessage(recorderStartPoint
        ? "Recording started with the improved GPS start as a guide. The first live GPS point will start the recorded line."
        : "Recording started. For better accuracy, you can stop and use Improve GPS before starting.",
      "ok");

    try {
      recorderWatchId = navigator.geolocation.watchPosition(
        handleGpsPoint,
        (error) => {
          debugRecorder("Recorder GPS watch failed", error);
          setRecorderMessage("GPS unavailable. Check location permission and try again.", "error");
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    } catch (error) {
      handleAppError("Recorder GPS watch failed.", error, setRecorderMessage);
      return;
    }

    updateRecorderUi();
    saveActiveRecorderState();
    debugRecorder("Recorder started", { sessionId: recorderState.sessionId });
  }

  function startRecording() {
    startRecorder();
  }

  function improveRecorderGpsStart() {
    if (!navigator.geolocation) {
      setRecorderMessage("This browser does not support GPS lookup.", "error");
      return;
    }

    if (recorderState.status === "recording" || recorderState.status === "paused") {
      setRecorderMessage("Improve GPS before starting a recording, or stop this recording first.", "error");
      return;
    }

    initRecorderMap();
    stopRecorderStartWatch();
    recorderStartPoint = null;
    recorderStartFixActive = true;
    field("improveRecorderGpsButton").disabled = true;
    setRecorderMessage("Getting a better GPS start fix. Stand near the starting point for a few seconds.", "");

    let bestPosition = null;
    const startedAt = Date.now();
    const stopTimer = window.setTimeout(finishRecorderStartFix, 22000);

    recorderStartWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy);
        const isBetter = !bestPosition || accuracy < Number(bestPosition.coords.accuracy);

        if (isBetter) {
          bestPosition = position;
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const cleanAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : "";
          recorderStartPoint = {
            pointId: makeId("RPT"),
            timestamp: new Date(position.timestamp || Date.now()).toISOString(),
            latitude: lat,
            longitude: lng,
            accuracyMeters: cleanAccuracy,
            speed: Number.isFinite(position.coords.speed) ? position.coords.speed : "",
            heading: Number.isFinite(position.coords.heading) ? position.coords.heading : "",
            condition: recorderState.condition || "Green"
          };
          recorderState.lastAccuracy = cleanAccuracy;
          if (recorderMap) recorderMap.setView([lat, lng], cleanAccuracy && cleanAccuracy <= 20 ? 21 : 20);
          updateRecorderUi();
          setRecorderMessage("Best start fix so far: about " + (cleanAccuracy || "--") + " m.", "ok");
        }

        if (Number(position.coords.accuracy) <= 8 || Date.now() - startedAt > 16000) {
          finishRecorderStartFix();
        }
      },
      () => {
        window.clearTimeout(stopTimer);
        stopRecorderStartWatch();
        recorderStartFixActive = false;
        field("improveRecorderGpsButton").disabled = false;
        setRecorderMessage("GPS start fix was not available. Check location permission and try again.", "error");
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );

    function finishRecorderStartFix() {
      window.clearTimeout(stopTimer);
      stopRecorderStartWatch();
      recorderStartFixActive = false;
      field("improveRecorderGpsButton").disabled = false;

      if (recorderStartPoint) {
        setRecorderMessage("Improved GPS start saved. Accuracy: about " + (recorderStartPoint.accuracyMeters || "--") + " m. Tap Start when ready.", "ok");
      } else {
        setRecorderMessage("No GPS start point was captured. Try Improve GPS again or start recording normally.", "error");
      }
    }
  }

  function stopRecorderStartWatch() {
    if (recorderStartWatchId !== null) {
      navigator.geolocation.clearWatch(recorderStartWatchId);
      recorderStartWatchId = null;
    }
    recorderStartFixActive = false;
  }

  function handleStartPauseRecording() {
    triggerHapticFeedback(18);
    if (recorderState.status === "recording" || recorderState.status === "paused") {
      togglePauseRecording();
      return;
    }

    startRecorder();
  }

  function togglePauseRecording() {
    if (recorderState.status === "recording") {
      recorderState.status = "paused";
      setRecorderMessage("Recording paused. Tap Resume to continue this session.", "");
    } else if (recorderState.status === "paused") {
      recorderState.status = "recording";
      setRecorderMessage("Recording resumed.", "ok");
    }

    saveActiveRecorderState();
    updateRecorderUi();
  }

  function stopRecorder() {
    if (recorderState.status === "idle") return;

    if (recorderState.points.length < 2) {
      const shouldStop = window.confirm("Are you sure you want to stop? This recording has fewer than 2 accepted GPS points, so it cannot create a sidewalk line segment yet.");
      if (!shouldStop) return;
    }

    triggerHapticFeedback([20, 40, 20]);
    stopRecorderWatch();

    if (recorderState.points.length < 2) {
      recorderState.status = "idle";
      recorderState.endedAt = "";
      updateRecorderUi();
      setRecorderMessage("Recording stopped, but there were not enough GPS points to create a line segment.", "error");
      debugRecorder("Recorder stopped without enough points", { pointCount: recorderState.points.length });
      return;
    }

    recorderState.status = "stopped";
    recorderState.endedAt = new Date().toISOString();
    recorderState.segments = rebuildSegmentsFromPoints(recorderState.points);
    recorderState.distanceFt = Math.round(recorderState.segments.reduce((total, segment) => total + segment.distanceFt, 0));

    const savedSession = saveRecorderSession(createRecorderSessionPayload(recorderState));
    clearActiveRecorderState();
    renderSegments();
    renderRecorderReviewList();
    updateRecorderUi();
    setRecorderMessage("Recording stopped and saved locally. Syncing recorder segments if an upload endpoint is configured.", "ok");
    syncRecorderSession(savedSession);
    debugRecorder("Recorder stopped", {
      pointCount: recorderState.points.length,
      segmentCount: recorderState.segments.length,
      distanceFt: recorderState.distanceFt
    });
  }

  function stopRecording() {
    stopRecorder();
  }

  function stopRecorderWatch() {
    if (recorderWatchId !== null) {
      navigator.geolocation.clearWatch(recorderWatchId);
      recorderWatchId = null;
    }
  }

  function handleGpsPoint(position) {
    if (recorderState.status !== "recording") return;

    const accuracy = Number(position.coords.accuracy);
    recorderState.lastAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : null;

    const point = {
      pointId: makeId("RPT"),
      timestamp: new Date(position.timestamp || Date.now()).toISOString(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : "",
      speed: Number.isFinite(position.coords.speed) ? position.coords.speed : "",
      heading: Number.isFinite(position.coords.heading) ? position.coords.heading : "",
      condition: recorderState.condition
    };

    if (!shouldAcceptGpsPoint(point)) {
      updateRecorderUi();
      return;
    }

    recorderState.points.push(point);
    recorderState.segments = rebuildSegmentsFromPoints(recorderState.points);
    recorderState.distanceFt = Math.round(recorderState.segments.reduce((total, segment) => total + segment.distanceFt, 0));
    renderSegments();
    updateRecorderUi();
    saveActiveRecorderState();

    if (recorderMap && recorderState.points.length === 1) {
      recorderMap.setView([point.latitude, point.longitude], recorderState.lastAccuracy && recorderState.lastAccuracy <= 20 ? 21 : 20);
    }
    debugRecorder("GPS point accepted", point);
  }

  function handleRecorderPosition(position) {
    handleGpsPoint(position);
  }

  function shouldAcceptGpsPoint(point) {
    const accuracy = Number(point.accuracyMeters);
    if (Number.isFinite(accuracy) && accuracy > RECORDER_MAX_ACCURACY_METERS) {
      setRecorderMessage("Poor GPS accuracy: point skipped at about " + Math.round(accuracy) + " m. Wait for 15 m or better.", "error");
      debugRecorder("GPS point rejected for accuracy", { accuracyMeters: accuracy });
      return false;
    }

    const previous = recorderState.points[recorderState.points.length - 1];
    if (!previous && Number.isFinite(accuracy) && accuracy > RECORDER_START_MAX_ACCURACY_METERS) {
      setRecorderMessage("Waiting for a better starting GPS fix. Start accuracy is about " + Math.round(accuracy) + " m; waiting for 10 m or better.", "error");
      debugRecorder("GPS point rejected for start accuracy", { accuracyMeters: accuracy });
      return false;
    }

    if (previous) {
      const distanceMeters = calculateDistanceMeters(previous, point);
      const minimumDistanceMeters = getRecorderMinimumDistanceMeters();
      if (distanceMeters <= minimumDistanceMeters) {
        debugRecorder("GPS point rejected for distance", {
          distanceMeters: distanceMeters,
          minimumDistanceMeters: minimumDistanceMeters,
          detailMode: recorderDetailMode
        });
        return false;
      }
    }

    return true;
  }

  function getRecorderMinimumDistanceMeters() {
    return recorderDetailMode === "high"
      ? RECORDER_HIGH_DETAIL_DISTANCE_METERS
      : RECORDER_NORMAL_DISTANCE_METERS;
  }

  function calculateDistanceMeters(a, b) {
    if (window.App && window.App.gpsRecorder && window.App.gpsRecorder.calculateDistanceMeters) {
      return window.App.gpsRecorder.calculateDistanceMeters(a, b);
    }

    if (!a || !b) return 0;
    const aLat = Number(a.latitude ?? a.lat);
    const aLng = Number(a.longitude ?? a.lng);
    const bLat = Number(b.latitude ?? b.lat);
    const bLng = Number(b.longitude ?? b.lng);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return 0;

    const earthRadiusMeters = 6371000;
    const lat1 = aLat * Math.PI / 180;
    const lat2 = bLat * Math.PI / 180;
    const deltaLat = (bLat - aLat) * Math.PI / 180;
    const deltaLng = (bLng - aLng) * Math.PI / 180;
    const haversine = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  function debugRecorder(message, data) {
    if (!RECORDER_DEBUG) return;
    debugLog("[Recorder] " + message, data);
  }

  function debugLog(message, data) {
    if (!DEBUG) return;
    if (data === undefined) console.debug(message);
    else console.debug(message, data);
  }

  function runRecorderSegmentSelfTest() {
    if (!RECORDER_DEBUG) return;
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const points = [
      makeRecorderTestPoint(39.3292, -82.1013, "Green", start),
      makeRecorderTestPoint(39.32921, -82.10131, "Green", start + 1000),
      makeRecorderTestPoint(39.32922, -82.10132, "Yellow", start + 2000),
      makeRecorderTestPoint(39.32923, -82.10133, "Yellow", start + 3000),
      makeRecorderTestPoint(39.32924, -82.10134, "Yellow", start + RECORDER_SEGMENT_GAP_MS + 4000),
      makeRecorderTestPoint(39.3298, -82.1019, "Yellow", start + RECORDER_SEGMENT_GAP_MS + 5000)
    ];
    const segments = rebuildSegmentsFromPoints(points);
    debugRecorder("Recorder segment self-test", {
      expected: 2,
      actual: segments.length,
      segments: segments
    });
  }

  function makeRecorderTestPoint(lat, lng, condition, timestampMs) {
    return {
      pointId: makeId("TPT"),
      timestamp: new Date(timestampMs).toISOString(),
      latitude: lat,
      longitude: lng,
      accuracyMeters: 5,
      speed: "",
      heading: "",
      condition: condition
    };
  }

  function triggerHapticFeedback(pattern = 20) {
    if (!navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      debugRecorder("Haptic feedback unavailable", error);
    }
  }

  function setRecorderDetailMode(mode) {
    recorderDetailMode = mode === "high" ? "high" : "normal";
    document.querySelectorAll("[data-recorder-detail-mode]").forEach((button) => {
      const active = button.dataset.recorderDetailMode === recorderDetailMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    triggerHapticFeedback(12);
    setRecorderMessage(recorderDetailMode === "high"
      ? "High Detail mode enabled. Recorder accepts movement over 1 m and may use more battery."
      : "Normal mode enabled. Recorder accepts movement over 2 m to save battery and reduce GPS jitter.",
      "");
  }

  function setRecorderCondition(condition) {
    recorderState.condition = condition || "Green";
    document.querySelectorAll(".condition-toggle").forEach((button) => {
      const active = button.dataset.condition === recorderState.condition;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    triggerHapticFeedback(18);
    if (recorderState.status === "recording") {
      setRecorderMessage("Condition set to " + recorderConditionLabel(recorderState.condition) + ". New GPS points will use this color.", "ok");
    }
    saveActiveRecorderState();
    updateRecorderUi();
  }

  async function addRecorderNote() {
    const note = prompt("Recorder note", "");
    if (note === null) return;

    const text = sanitizeTextInput(note);
    if (!text) {
      setRecorderMessage("Note was empty, so nothing was added.", "");
      return;
    }

    setRecorderMessage("Locking note location...", "");
    const location = await getRecorderObservationLocation("note");
    recorderState.notes.push({
      noteId: makeId("RNT"),
      timestamp: new Date().toISOString(),
      condition: recorderState.condition,
      text: text,
      latitude: location.point ? location.point.latitude : "",
      longitude: location.point ? location.point.longitude : "",
      accuracyMeters: location.point ? location.point.accuracyMeters : "",
      locationSource: location.source
    });
    setRecorderMessage("Recorder note added" + locationMessageSuffix(location) + ".", location.warning ? "error" : "ok");
    saveActiveRecorderState();
    updateRecorderUi();
  }

  async function captureRecorderPhotos() {
    const files = Array.from(field("recorderPhoto").files || []);
    if (!files.length) return;
    const validation = validatePhotoFiles(files);
    if (!validation.ok) {
      field("recorderPhoto").value = "";
      setRecorderMessage(validation.message, "error");
      return;
    }

    setRecorderMessage("Locking photo location...", "");
    const location = await getRecorderObservationLocation("photo");
    files.forEach((file) => {
      recorderState.photos.push({
        photoId: makeId("RPH"),
        timestamp: new Date().toISOString(),
        condition: recorderState.condition,
        name: file.name,
        type: file.type,
        size: file.size,
        latitude: location.point ? location.point.latitude : "",
        longitude: location.point ? location.point.longitude : "",
        accuracyMeters: location.point ? location.point.accuracyMeters : "",
        locationSource: location.source
      });
    });
    field("recorderPhoto").value = "";
    setRecorderMessage(files.length + " recorder photo" + (files.length === 1 ? "" : "s") + " attached locally" + locationMessageSuffix(location) + ".", location.warning ? "error" : "ok");
    saveActiveRecorderState();
    updateRecorderUi();
  }

  function getLastRecorderObservationPoint() {
    const point = recorderState.points[recorderState.points.length - 1] || recorderStartPoint || null;
    if (!point) return null;

    return {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMeters: point.accuracyMeters || "",
      timestamp: point.timestamp || new Date().toISOString()
    };
  }

  function getRecorderObservationLocation(label) {
    const fallbackPoint = getLastRecorderObservationPoint();
    if (!navigator.geolocation) {
      return Promise.resolve({
        point: fallbackPoint,
        source: fallbackPoint ? "last_accepted_recorder_point" : "none",
        warning: true,
        message: "GPS was unavailable; used the last accepted recorder location."
      });
    }

    return new Promise((resolve) => {
      let bestPoint = null;
      let watchId = null;
      let resolved = false;

      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }
        resolve(result);
      };

      const timeoutId = window.setTimeout(() => {
        const usableBest = bestPoint && Number(bestPoint.accuracyMeters) <= RECORDER_OBSERVATION_MAX_ACCURACY_METERS;
        finish({
          point: usableBest ? bestPoint : fallbackPoint,
          source: usableBest ? "fresh_gps_fix" : fallbackPoint ? "last_accepted_recorder_point" : "none",
          warning: !usableBest,
          message: usableBest
            ? ""
            : "Fresh GPS for this " + label + " was not accurate enough; used the last accepted recorder location."
        });
      }, RECORDER_OBSERVATION_FIX_TIMEOUT_MS);

      try {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const accuracy = Number(position.coords.accuracy);
            if (!Number.isFinite(accuracy)) return;

            const point = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: Math.round(accuracy),
              timestamp: new Date(position.timestamp || Date.now()).toISOString()
            };

            if (!bestPoint || point.accuracyMeters < Number(bestPoint.accuracyMeters)) {
              bestPoint = point;
            }

            if (point.accuracyMeters <= RECORDER_OBSERVATION_MAX_ACCURACY_METERS) {
              finish({
                point: point,
                source: "fresh_gps_fix",
                warning: false,
                message: ""
              });
            }
          },
          (error) => {
            debugRecorder("Recorder observation GPS failed", error);
            finish({
              point: fallbackPoint,
              source: fallbackPoint ? "last_accepted_recorder_point" : "none",
              warning: true,
              message: "Fresh GPS for this " + label + " failed; used the last accepted recorder location."
            });
          },
          { enableHighAccuracy: true, timeout: RECORDER_OBSERVATION_FIX_TIMEOUT_MS, maximumAge: 0 }
        );
      } catch (error) {
        debugRecorder("Recorder observation GPS failed", error);
        finish({
          point: fallbackPoint,
          source: fallbackPoint ? "last_accepted_recorder_point" : "none",
          warning: true,
          message: "Fresh GPS for this " + label + " failed; used the last accepted recorder location."
        });
      }
    });
  }

  function locationMessageSuffix(location) {
    if (!location || !location.point) return "; no GPS location was available";
    const accuracyText = location.point.accuracyMeters ? " about " + location.point.accuracyMeters + " m accuracy" : "";
    if (location.source === "fresh_gps_fix") return " at a fresh GPS location" + accuracyText;
    return "; used last accepted recorder location" + accuracyText;
  }

  function validatePhotoFiles(files) {
    if (!files || !files.length) return { ok: true };

    if (files.length > MAX_PHOTO_COUNT) {
      return { ok: false, message: "Too many photos. Limit photos to " + MAX_PHOTO_COUNT + " per report." };
    }

    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_TOTAL_PHOTO_BYTES) {
      return { ok: false, message: "Photos are too large together. Limit total photo size to about " + Math.round(MAX_TOTAL_PHOTO_BYTES / 1024 / 1024) + " MB." };
    }

    for (const file of files) {
      if (!isAllowedPhotoFile(file)) {
        return { ok: false, message: "Unsupported photo type: " + (file.type || file.name) + ". Use JPG, PNG, WebP, HEIC, or HEIF." };
      }

      if (file.size > MAX_PHOTO_BYTES) {
        return { ok: false, message: "Photo is too large: " + file.name + ". Limit each photo to about " + Math.round(MAX_PHOTO_BYTES / 1024 / 1024) + " MB." };
      }
    }

    return { ok: true };
  }

  function isAllowedPhotoFile(file) {
    if (ALLOWED_PHOTO_TYPES.includes(file.type)) return true;
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "");
  }

  function rebuildSegmentsFromPoints(points, routeId = recorderState.sessionId || "") {
    if (!points || points.length < 2) return [];

    const segments = [];
    let active = null;

    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const condition = current.condition || "Green";
      const legDistanceMeters = calculateDistanceMeters(previous, current);
      const hasGpsGap = isRecorderGapBreak(previous, current);
      const hasConditionChange = active && active.condition !== condition;

      if (hasGpsGap) {
        if (active) {
          segments.push(finalizeRecorderSegment(active));
          active = null;
        }
        debugRecorder("Recorder segment split for GPS gap", {
          distanceMeters: legDistanceMeters,
          timeGapMs: calculateTimeGapMs(previous, current)
        });
        continue;
      }

      if (hasConditionChange) {
        segments.push(finalizeRecorderSegment(active));
        active = null;
        debugRecorder("Recorder segment split for condition change", {
          from: previous.condition || "Green",
          to: condition
        });
        continue;
      }

      if (!active) {
        active = createRecorderSegmentDraft(previous, current, legDistanceMeters, condition, routeId);
      } else {
        active.coordinates.push([current.longitude, current.latitude]);
        active.endTime = current.timestamp;
        active.endTimestamp = current.timestamp;
        active.lengthMeters += legDistanceMeters;
        active.pointCount += 1;
        if (current.accuracyMeters !== "") active.accuracies.push(current.accuracyMeters);
      }
    }

    if (active) segments.push(finalizeRecorderSegment(active));
    return segments;
  }

  function buildRecorderSegments(points) {
    return rebuildSegmentsFromPoints(points);
  }

  function isRecorderGapBreak(previousPoint, currentPoint) {
    return calculateDistanceMeters(previousPoint, currentPoint) > RECORDER_SEGMENT_GAP_METERS ||
      calculateTimeGapMs(previousPoint, currentPoint) > RECORDER_SEGMENT_GAP_MS;
  }

  function calculateTimeGapMs(a, b) {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;
    return Math.abs(bTime - aTime);
  }

  function createRecorderSegmentDraft(previous, current, legDistanceMeters, condition, routeId) {
    return {
      segmentId: makeId("RSG"),
      routeId: routeId || "",
      condition: condition,
      startTime: previous.timestamp,
      endTime: current.timestamp,
      startTimestamp: previous.timestamp,
      endTimestamp: current.timestamp,
      coordinates: [[previous.longitude, previous.latitude], [current.longitude, current.latitude]],
      pointCount: 2,
      lengthMeters: legDistanceMeters,
      accuracies: [previous.accuracyMeters, current.accuracyMeters].filter((value) => value !== ""),
      source: RECORDER_SOURCE
    };
  }

  function finalizeRecorderSegment(segment) {
    const avgAccuracy = segment.accuracies.length
      ? Math.round(segment.accuracies.reduce((total, value) => total + Number(value), 0) / segment.accuracies.length)
      : "";
    const lengthMeters = Math.round(segment.lengthMeters * 10) / 10;
    const distanceFt = Math.round(lengthMeters * 3.28084);

    return {
      segmentId: segment.segmentId,
      routeId: segment.routeId,
      condition: segment.condition,
      conditionClass: recorderConditionClass(segment.condition),
      conditionLabel: recorderConditionLabel(segment.condition),
      score: recorderConditionScore(segment.condition),
      startTime: segment.startTime,
      endTime: segment.endTime,
      startTimestamp: segment.startTimestamp,
      endTimestamp: segment.endTimestamp,
      coordinates: segment.coordinates,
      pointCount: segment.pointCount,
      lengthMeters: lengthMeters,
      distanceFt: distanceFt,
      averageAccuracy: avgAccuracy,
      averageAccuracyMeters: avgAccuracy,
      source: segment.source || RECORDER_SOURCE,
      reviewNeeded: segment.condition === "Yellow" || segment.condition === "Red" ? "Yes" : "No",
      reviewStatus: segment.condition === "Yellow" || segment.condition === "Red" ? "Needs Review" : "No Review Needed",
      reviewed: Boolean(segment.reviewed),
      notes: ""
    };
  }

  function renderSegments() {
    if (!recorderMap) return;
    clearRecorderMapLayers();

    recorderState.segments.forEach((segment) => {
      const latLngs = segment.coordinates.map((coordinate) => [coordinate[1], coordinate[0]]);
      const layer = L.polyline(latLngs, {
        color: recorderConditionColor(segment.condition),
        weight: segment.condition === "Green" ? 6 : 8,
        opacity: 0.9
      }).addTo(recorderMap);
      layer.bindTooltip(segment.conditionLabel + " - " + segment.distanceFt + " ft");
      recorderLayers.push({ segmentId: segment.segmentId, layer: layer });
    });
  }

  function renderRecorderPaths() {
    renderSegments();
  }

  function clearRecorderMapLayers() {
    recorderLayers.forEach((item) => item.layer.remove());
    recorderLayers = [];
  }

  function renderRecorderReviewList() {
    const list = field("recorderReviewList");
    if (!list) return;

    const reviewSegments = getFilteredReviewSegments();
    if (!reviewSegments.length) {
      list.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "help";
      empty.textContent = "No segments match the current review filter.";
      list.appendChild(empty);
      return;
    }

    list.replaceChildren();
    reviewSegments.forEach((segment) => {
      const item = document.createElement("div");
      item.className = "review-segment" + (segment.condition === "Red" ? " red" : "") + (segment.reviewed ? " reviewed" : "");
      const title = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = segment.conditionLabel + (segment.reviewed ? " - Reviewed" : "");
      title.appendChild(strong);

      const detailGrid = document.createElement("div");
      detailGrid.className = "review-detail-grid";
      [
        ["Condition", segment.conditionClass || recorderConditionClass(segment.condition)],
        ["Length", (segment.lengthMeters || 0) + " m / " + (segment.distanceFt || 0) + " ft"],
        ["Score", segment.score || recorderConditionScore(segment.condition)],
        ["GPS Accuracy", (segment.averageAccuracy || segment.averageAccuracyMeters || "--") + " m"],
        ["Start", formatRecorderDateTime(segment.startTime || segment.startTimestamp)],
        ["End", formatRecorderDateTime(segment.endTime || segment.endTimestamp)],
        ["Notes", segment.notes || "--"]
      ].forEach(([label, value]) => detailGrid.appendChild(createReviewDetail(label, value)));

      const actions = document.createElement("div");
      actions.className = "review-segment-actions";
      const zoomButton = createActionButton("Zoom To", "secondary", () => zoomToRecorderSegment(segment.segmentId));
      const reviewButton = createActionButton("Mark Reviewed", "secondary", () => markRecorderSegmentReviewed(segment.segmentId));
      const documentButton = createActionButton("Create Detailed Inspection", "", () => documentRecorderSegment(segment.segmentId));
      actions.append(zoomButton, reviewButton, documentButton);
      item.append(title, detailGrid, actions);
      list.appendChild(item);
    });
  }

  function getFilteredReviewSegments() {
    return recorderState.segments.filter((segment) => {
      if (recorderReviewFilter === "problem") return segment.condition === "Yellow" || segment.condition === "Red";
      if (recorderReviewFilter === "unreviewed") return !segment.reviewed;
      return true;
    });
  }

  function setRecorderReviewFilter(filter) {
    recorderReviewFilter = filter || "all";
    document.querySelectorAll("[data-review-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.reviewFilter === recorderReviewFilter);
    });
    renderRecorderReviewList();
  }

  function createReviewDetail(label, value) {
    const div = document.createElement("div");
    div.className = "review-detail";
    const span = document.createElement("span");
    span.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    div.append(span, strong);
    return div;
  }

  function createActionButton(text, className, onClick) {
    const button = document.createElement("button");
    if (className) button.className = className;
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function formatRecorderDateTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function zoomToRecorderSegment(segmentId) {
    const item = recorderLayers.find((layerItem) => layerItem.segmentId === segmentId);
    if (item && recorderMap) {
      recorderMap.fitBounds(item.layer.getBounds(), { padding: [24, 24], maxZoom: 21 });
    }
  }

  function markRecorderSegmentReviewed(segmentId) {
    const segment = recorderState.segments.find((item) => item.segmentId === segmentId);
    if (!segment) return;

    segment.reviewed = true;
    segment.reviewStatus = "Reviewed";
    persistRecorderSegmentReview(segmentId);
    renderRecorderReviewList();
    setRecorderMessage("Segment marked reviewed.", "ok");
  }

  function persistRecorderSegmentReview(segmentId) {
    const routeId = recorderState.sessionId;
    if (!routeId) return;

    const saved = getRecorderSessions().find((session) => session.routeId === routeId || session.sessionId === routeId);
    if (!saved) {
      saveActiveRecorderState();
      return;
    }

    const generatedSegments = (saved.generatedSegments || saved.segments || []).map((segment) => {
      if (segment.segmentId !== segmentId) return segment;
      return Object.assign({}, segment, {
        reviewed: true,
        reviewStatus: "Reviewed"
      });
    });
    updateRecorderSession(saved.routeId, { generatedSegments: generatedSegments, segments: generatedSegments });
  }

  function documentRecorderSegment(segmentId) {
    const segment = recorderState.segments.find((item) => item.segmentId === segmentId);
    if (!segment || !segment.coordinates.length) return;

    if (recorderState.status === "recording" || recorderState.status === "paused") {
      setRecorderMessage("Stop the recording before creating a detailed report from a review segment.", "error");
      return;
    }

    const midpoint = getCoordinateMidpoint(segment.coordinates);
    const severity = segment.condition === "Red" ? "3" : "2";
    const conditionText = segment.condition === "Red" ? "Red / Poor recorder segment" : "Yellow / Fair recorder segment";

    field("recorderPanel").classList.remove("visible");
    field("surveyPanel").style.display = "";
    field("appShell").style.display = "grid";
    field("introScreen").style.display = "none";
    field("successPanel").style.display = "none";
    field("surveyForm").style.display = "";

    resetFormAfterSubmit();
    field("reportType").value = "Point Issue";
    field("severity").value = severity;
    setSelectedConditions(["Other"]);
    field("comments").value = conditionText + " created from Recorder Mode. Route: " +
      (recorderState.routeName || "not entered") + ". Recorder segment ID: " + segment.segmentId +
      ". Segment length: " + (segment.lengthMeters || "--") + " m. Segment score: " + (segment.score || "--") +
      ". Start: " + (segment.startTime || segment.startTimestamp || "--") +
      ". End: " + (segment.endTime || segment.endTimestamp || "--") + ".";

    updateReportTypeUI();
    setLocation(midpoint.lat, midpoint.lng, false, segment.averageAccuracy || segment.averageAccuracyMeters || null);
    locationConfirmed = true;
    updateLocationConfirmationStatus();

    [
      "reportType", "condition", "severity"
    ].forEach(syncSegmentedControl);
    updateMeasurementVisibility();
    updateConditionHelp();
    openSurveyStep("conditionSection");
    setMessage("Recorder segment midpoint loaded into the point inspection form. Add photos, measurements, and notes before submitting.", "ok");
  }

  function updateRecorderUi() {
    const reviewCount = recorderState.segments.filter((segment) => segment.reviewNeeded === "Yes" && !segment.reviewed).length;
    const conditionEl = field("recorderCurrentCondition");
    const accuracyEl = field("recorderAccuracy");
    field("recorderStatus").textContent = recorderStatusLabel(recorderState.status);
    conditionEl.textContent = recorderConditionLabel(recorderState.condition);
    conditionEl.className = "condition-status " + recorderConditionStatusClass(recorderState.condition);
    accuracyEl.textContent = recorderState.lastAccuracy ? recorderState.lastAccuracy + " m" : "--";
    accuracyEl.className = "gps-quality " + recorderGpsQualityClass(recorderState.lastAccuracy);
    field("recorderDistance").textContent = recorderState.distanceFt + " ft";
    field("recorderPointCount").textContent = String(recorderState.points.length);
    field("recorderSegmentCount").textContent = String(recorderState.segments.length);
    field("recorderReviewCount").textContent = String(reviewCount);
    field("recorderSavedCount").textContent = String(getRecorderSessions().length);
    field("startRecordingButton").disabled = recorderStartFixActive;
    field("startRecordingButton").textContent = recorderState.status === "recording"
      ? "Pause"
      : recorderState.status === "paused"
        ? "Resume"
        : "Start";
    field("stopRecordingButton").disabled = !(recorderState.status === "recording" || recorderState.status === "paused");
    field("improveRecorderGpsButton").disabled = recorderStartFixActive || recorderState.status === "recording" || recorderState.status === "paused";
  }

  function recorderConditionStatusClass(condition) {
    if (condition === "Yellow") return "condition-fair";
    if (condition === "Red") return "condition-poor";
    return "condition-good";
  }

  function recorderGpsQualityClass(accuracyMeters) {
    if (window.App && window.App.gpsRecorder && window.App.gpsRecorder.classifyAccuracy) {
      return window.App.gpsRecorder.classifyAccuracy(accuracyMeters);
    }

    const accuracy = Number(accuracyMeters);
    if (!Number.isFinite(accuracy)) return "";
    if (accuracy <= 5) return "good";
    if (accuracy <= 15) return "fair";
    return "poor";
  }

  function warnBeforeLeavingActiveRecorder(event) {
    if (recorderState.status !== "recording" && recorderState.status !== "paused") return;
    event.preventDefault();
    event.returnValue = "Recorder Mode is active. Stop recording before leaving so the session can be saved locally.";
    return event.returnValue;
  }

  function saveRecorderContact() {
    const contact = {
      reporterName: sanitizeTextInput(field("recorderName").value),
      email: sanitizeTextInput(field("recorderEmail").value)
    };
    localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(contact));
  }

  function createRecorderSessionPayload(state) {
    const routeId = state.sessionId || makeId("REC");
    return {
      storageVersion: RECORDER_STORAGE_VERSION,
      routeId: routeId,
      sessionId: routeId,
      routeName: state.routeName || "",
      blockId: state.blockId || "",
      blockName: state.blockName || "",
      blockStatus: state.blockStatus || "",
      inspectorName: state.recorderName || "",
      recorderName: state.recorderName || "",
      email: state.email || "",
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      rawPoints: Array.isArray(state.points) ? state.points : [],
      generatedSegments: Array.isArray(state.segments) ? state.segments : [],
      notes: Array.isArray(state.notes) ? state.notes : [],
      photos: Array.isArray(state.photos) ? state.photos : [],
      distanceFt: Number(state.distanceFt) || 0,
      lastAccuracy: state.lastAccuracy || ""
    };
  }

  function saveActiveRecorderState() {
    if (recorderState.status !== "recording" && recorderState.status !== "paused") return;
    try {
      localStorage.setItem(RECORDER_ACTIVE_STORAGE_KEY, JSON.stringify(createRecorderSessionPayload(recorderState)));
      warnIfLocalStorageLarge(setRecorderMessage);
    } catch (error) {
      handleAppError("Active recorder session could not be saved.", error, setRecorderMessage);
    }
  }

  function getActiveRecorderState() {
    try {
      return JSON.parse(localStorage.getItem(RECORDER_ACTIVE_STORAGE_KEY) || "null");
    } catch (error) {
      handleAppError("Active recorder session could not be read.", error, setRecorderMessage);
      return null;
    }
  }

  function clearActiveRecorderState() {
    localStorage.removeItem(RECORDER_ACTIVE_STORAGE_KEY);
  }

  function restoreActiveRecorderState() {
    const saved = normalizeRecorderSession(getActiveRecorderState());
    if (!saved || !saved.rawPoints.length) return false;

    recorderState = createEmptyRecorderState();
    recorderState.sessionId = saved.sessionId || saved.routeId;
    recorderState.status = "paused";
    recorderState.condition = saved.rawPoints[saved.rawPoints.length - 1].condition || "Green";
    recorderState.startedAt = saved.startedAt;
    recorderState.endedAt = "";
    recorderState.routeName = saved.routeName || "";
    recorderState.blockId = saved.blockId || "";
    recorderState.blockName = saved.blockName || "";
    recorderState.blockStatus = saved.blockStatus || "";
    selectedRecorderBlock = recorderState.blockId ? {
      blockId: recorderState.blockId,
      blockName: recorderState.blockName,
      status: recorderState.blockStatus
    } : null;
    recorderState.recorderName = saved.inspectorName || saved.recorderName || "";
    recorderState.email = saved.email || "";
    recorderState.points = saved.rawPoints || [];
    recorderState.segments = rebuildSegmentsFromPoints(recorderState.points, recorderState.sessionId);
    recorderState.notes = saved.notes || [];
    recorderState.photos = saved.photos || [];
    recorderState.distanceFt = Math.round(recorderState.segments.reduce((total, segment) => total + segment.distanceFt, 0));
    recorderState.lastAccuracy = saved.lastAccuracy || "";
    field("recorderRouteName").value = recorderState.routeName;
    field("recorderName").value = recorderState.recorderName;
    field("recorderEmail").value = recorderState.email;
    updateSelectedBlockUi();
    setRecorderCondition(recorderState.condition);
    renderSegments();
    renderRecorderReviewList();
    setRecorderMessage("Recovered an interrupted recording. It is paused so you can resume or stop and save it.", "ok");
    return true;
  }

  function getRecorderSessions() {
    try {
      const stored = JSON.parse(localStorage.getItem(RECORDER_STORAGE_KEY) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.map(normalizeRecorderSession).filter(Boolean);
    } catch (error) {
      handleAppError("Stored recorder sessions could not be read.", error, setRecorderMessage);
      return [];
    }
  }

  function saveRecorderSession(session) {
    const sessions = getRecorderSessions();
    const normalized = normalizeRecorderSession(session);
    if (!normalized) return null;
    const existingIndex = sessions.findIndex((item) => item.routeId === normalized.routeId);
    if (existingIndex >= 0) {
      sessions[existingIndex] = normalized;
    } else {
      sessions.push(normalized);
    }
    localStorage.setItem(RECORDER_STORAGE_KEY, JSON.stringify(sessions));
    warnIfLocalStorageLarge(setRecorderMessage);
    updateRecorderUi();
    return normalized;
  }

  async function syncRecorderSession(session) {
    const uploadUrl = getUploadUrl();
    if (!session || !uploadUrl) {
      if (session) {
        updateRecorderSession(session.routeId, {
          syncStatus: "not_configured",
          syncError: "",
          lastSyncAttemptAt: ""
        });
      }
      setRecorderMessage("Recording saved locally. Add the upload endpoint to sync recorder segments to ArcGIS automatically.", "ok");
      return false;
    }

    if (!isValidUploadUrl(uploadUrl)) {
      updateRecorderSession(session.routeId, {
        syncStatus: "failed",
        syncError: "Upload URL is invalid.",
        lastSyncAttemptAt: new Date().toISOString()
      });
      setRecorderMessage("Recording saved locally, but recorder sync failed because the upload URL is invalid.", "error");
      return false;
    }

    const payload = buildRecorderSyncPayload(session);
    if (!payload.generatedSegments.length) {
      updateRecorderSession(session.routeId, {
        syncStatus: "skipped",
        syncError: "No recorder segments to sync.",
        lastSyncAttemptAt: new Date().toISOString()
      });
      setRecorderMessage("Recording saved locally. No recorder segments were available to sync.", "error");
      return false;
    }

    try {
      await postJsonNoCors(uploadUrl, payload);
      updateRecorderSession(session.routeId, {
        syncStatus: "sent",
        syncError: "",
        lastSyncAttemptAt: new Date().toISOString()
      });
      setRecorderMessage("Recording saved locally and sent to the backend for ArcGIS sync.", "ok");
      return true;
    } catch (error) {
      updateRecorderSession(session.routeId, {
        syncStatus: "failed",
        syncError: getErrorMessage(error) || "Recorder sync failed.",
        lastSyncAttemptAt: new Date().toISOString()
      });
      setRecorderMessage("Recording saved locally, but recorder sync failed. " + getErrorMessage(error), "error");
      return false;
    }
  }

  function buildRecorderSyncPayload(session) {
    return {
      action: "recorderSession",
      routeId: session.routeId || session.sessionId || "",
      sessionId: session.sessionId || session.routeId || "",
      routeName: session.routeName || "",
      blockId: session.blockId || "",
      blockName: session.blockName || "",
      blockStatus: session.blockStatus || "",
      inspectorName: session.inspectorName || session.recorderName || "",
      startedAt: session.startedAt || "",
      endedAt: session.endedAt || "",
      generatedSegments: Array.isArray(session.generatedSegments) ? session.generatedSegments : [],
      notes: Array.isArray(session.notes) ? session.notes : [],
      photos: Array.isArray(session.photos) ? session.photos.map((photo) => ({
        photoId: photo.photoId || "",
        timestamp: photo.timestamp || "",
        condition: photo.condition || "",
        name: photo.name || "",
        type: photo.type || "",
        size: photo.size || "",
        latitude: photo.latitude || "",
        longitude: photo.longitude || "",
        accuracyMeters: photo.accuracyMeters || "",
        locationSource: photo.locationSource || ""
      })) : []
    };
  }

  function deleteRecorderSession(routeId) {
    if (!routeId) return false;
    const sessions = getRecorderSessions();
    const remaining = sessions.filter((session) => session.routeId !== routeId);
    localStorage.setItem(RECORDER_STORAGE_KEY, JSON.stringify(remaining));
    updateRecorderUi();
    return remaining.length !== sessions.length;
  }

  function updateRecorderSession(routeId, patch) {
    if (!routeId || !patch || typeof patch !== "object") return null;
    const sessions = getRecorderSessions();
    const index = sessions.findIndex((session) => session.routeId === routeId);
    if (index < 0) return null;

    const updated = normalizeRecorderSession(Object.assign({}, sessions[index], patch));
    sessions[index] = updated;
    localStorage.setItem(RECORDER_STORAGE_KEY, JSON.stringify(sessions));
    warnIfLocalStorageLarge(setRecorderMessage);
    updateRecorderUi();
    return updated;
  }

  function getLocalStorageSizeBytes() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      total += key.length + String(localStorage.getItem(key) || "").length;
    }
    return total * 2;
  }

  function warnIfLocalStorageLarge(messageFn) {
    const bytes = getLocalStorageSizeBytes();
    if (bytes <= MAX_LOCAL_STORAGE_WARN_BYTES) return;
    const mb = Math.round(bytes / 1024 / 1024 * 10) / 10;
    messageFn("Local browser storage is getting large (" + mb + " MB). Export and clear old saved sessions when possible.", "error");
  }

  function normalizeRecorderSession(session) {
    if (!session || typeof session !== "object") return null;

    const rawPoints = Array.isArray(session.rawPoints)
      ? session.rawPoints
      : Array.isArray(session.points)
        ? session.points
        : [];
    const generatedSegments = Array.isArray(session.generatedSegments)
      ? session.generatedSegments
      : Array.isArray(session.segments)
        ? session.segments
        : [];
    const routeId = session.routeId || session.sessionId || makeId("REC");
    const inspectorName = session.inspectorName || session.recorderName || "";

    return {
      storageVersion: RECORDER_STORAGE_VERSION,
      routeId: routeId,
      sessionId: session.sessionId || routeId,
      routeName: session.routeName || "",
      blockId: session.blockId || "",
      blockName: session.blockName || "",
      blockStatus: session.blockStatus || "",
      inspectorName: inspectorName,
      recorderName: inspectorName,
      email: session.email || "",
      startedAt: session.startedAt || "",
      endedAt: session.endedAt || "",
      rawPoints: rawPoints,
      generatedSegments: generatedSegments,
      points: rawPoints,
      segments: generatedSegments,
      notes: Array.isArray(session.notes) ? session.notes : [],
      photos: Array.isArray(session.photos) ? session.photos : [],
      distanceFt: Number(session.distanceFt) || Math.round(generatedSegments.reduce((total, segment) => total + (Number(segment.distanceFt) || 0), 0)),
      lastAccuracy: session.lastAccuracy || "",
      syncStatus: session.syncStatus || "",
      syncError: session.syncError || "",
      lastSyncAttemptAt: session.lastSyncAttemptAt || ""
    };
  }

  function clearRecorderSessions() {
    if (recorderState.status === "recording" || recorderState.status === "paused") {
      setRecorderMessage("Stop the active recording before clearing local recorder data.", "error");
      return;
    }

    getRecorderSessions().forEach((session) => deleteRecorderSession(session.routeId));
    localStorage.setItem(RECORDER_STORAGE_KEY, JSON.stringify([]));
    setRecorderMessage("Local recorder sessions cleared.", "ok");
    updateRecorderUi();
  }

  function exportCurrentRecorderGeoJson() {
    const currentSession = getCurrentRecorderExportSession();
    if (!currentSession) {
      setRecorderMessage("No current recorder session is available to export.", "error");
      return;
    }

    exportRecorderGeoJsonSessions([currentSession]);
  }

  function exportAllRecorderGeoJson() {
    const sessions = getRecorderSessions();
    const currentSession = getCurrentRecorderExportSession();
    const allSessions = sessions.length ? sessions : currentSession ? [currentSession] : [];

    if (!allSessions.length) {
      setRecorderMessage("No saved recorder sessions are available to export.", "error");
      return;
    }

    exportRecorderGeoJsonSessions(allSessions);
  }

  function downloadRecorderGeoJson() {
    exportAllRecorderGeoJson();
  }

  function getCurrentRecorderExportSession() {
    if (!recorderState.points.length) return null;
    const state = Object.assign({}, recorderState, {
      segments: recorderState.segments.length ? recorderState.segments : rebuildSegmentsFromPoints(recorderState.points)
    });
    if (!state.segments.length) return null;
    return normalizeRecorderSession(createRecorderSessionPayload(state));
  }

  function exportRecorderGeoJsonSessions(sessions) {
    try {
      const geojson = buildGeoJsonFromSessions(sessions);
      const validation = validateGeoJson(geojson);
      if (!validation.ok) {
        setRecorderMessage("GeoJSON export failed: " + validation.error, "error");
        return;
      }
      downloadGeoJson(geojson);
      debugLog("GeoJSON export succeeded", { featureCount: geojson.features.length });
      setRecorderMessage("GeoJSON exported for ArcGIS review.", "ok");
    } catch (error) {
      handleAppError("GeoJSON export failed.", error, setRecorderMessage);
    }
  }

  function buildGeoJsonFromSessions(sessions) {
    const features = [];
    const includePersonalInfo = Boolean(field("includePersonalInfoInGeoJson") && field("includePersonalInfoInGeoJson").checked);
    (sessions || []).forEach((session) => {
      (session.generatedSegments || session.segments || []).forEach((segment) => {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: segment.coordinates
          },
          properties: {
            sessionId: session.sessionId,
            segmentId: segment.segmentId,
            routeId: segment.routeId || session.sessionId,
            inspectorName: includePersonalInfo ? session.inspectorName || session.recorderName || "" : "",
            condition: segment.condition,
            conditionClass: segment.conditionClass || recorderConditionClass(segment.condition),
            score: segment.score || recorderConditionScore(segment.condition),
            priorityClass: recorderPriorityClass(segment.condition),
            lengthMeters: segment.lengthMeters,
            averageAccuracy: segment.averageAccuracy || segment.averageAccuracyMeters || "",
            startTime: segment.startTime,
            endTime: segment.endTime,
            notes: buildRecorderSegmentNotes(session, segment),
            reviewed: Boolean(segment.reviewed)
          }
        });
      });
    });

    return {
      type: "FeatureCollection",
      name: "sidewalk_recorder_segments",
      features: features
    };
  }

  function validateGeoJson(geojson) {
    if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      return { ok: false, error: "Output is not a valid FeatureCollection." };
    }

    if (!geojson.features.length) {
      return { ok: false, error: "There are no valid segments to export." };
    }

    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];
      if (!feature || feature.type !== "Feature") {
        return { ok: false, error: "Feature " + (i + 1) + " is invalid." };
      }
      if (!feature.geometry || feature.geometry.type !== "LineString") {
        return { ok: false, error: "Feature " + (i + 1) + " is not a LineString." };
      }
      const coordinates = feature.geometry.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return { ok: false, error: "Feature " + (i + 1) + " must have at least 2 coordinates." };
      }
      for (let j = 0; j < coordinates.length; j++) {
        const coordinate = coordinates[j];
        if (!Array.isArray(coordinate) || coordinate.length < 2 || !Number.isFinite(Number(coordinate[0])) || !Number.isFinite(Number(coordinate[1]))) {
          return { ok: false, error: "Feature " + (i + 1) + " has an invalid coordinate." };
        }
      }
    }

    return { ok: true };
  }

  function downloadGeoJson(geojson) {
    const filename = "sidewalk-segments-" + new Date().toISOString().slice(0, 10) + ".geojson";

    try {
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error("Export download failed. " + getErrorMessage(error));
    }
  }

  function buildRecorderSegmentNotes(session, segment) {
    const segmentNotes = [segment.notes || ""].filter(Boolean);
    const recorderNotes = (session.notes || []).map((note) => note.text).filter(Boolean);
    return segmentNotes.concat(recorderNotes).join("; ");
  }

  function recorderPriorityClass(condition) {
    return {
      Green: "Low",
      Yellow: "Medium",
      Red: "High"
    }[condition] || "Low";
  }

  function setRecorderMessage(text, type) {
    const message = field("recorderMessage");
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
  }

  function recorderStatusLabel(status) {
    return {
      idle: "Ready",
      recording: "Recording",
      paused: "Paused",
      stopped: "Saved Locally"
    }[status] || "Ready";
  }

  function recorderConditionColor(condition) {
    return {
      Green: "#16803c",
      Yellow: "#facc15",
      Red: "#b42318"
    }[condition] || "#16803c";
  }

  function recorderConditionClass(condition) {
    return {
      Green: "Good",
      Yellow: "Fair",
      Red: "Poor"
    }[condition] || "Good";
  }

  function recorderConditionScore(condition) {
    return {
      Green: 100,
      Yellow: 70,
      Red: 35
    }[condition] || 100;
  }

  function recorderConditionLabel(condition) {
    return {
      Green: "Green / Good",
      Yellow: "Yellow / Fair",
      Red: "Red / Poor"
    }[condition] || "Green / Good";
  }

  function getCoordinateMidpoint(coordinates) {
    if (!coordinates || !coordinates.length) {
      return { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng };
    }

    const middle = coordinates[Math.floor(coordinates.length / 2)];
    return { lat: middle[1], lng: middle[0] };
  }

  function makeId(prefix) {
    const suffix = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.round(Math.random() * 100000);
    return prefix + "-" + suffix;
  }

  function downloadCsv() {
    const reports = getReports();
    if (!reports.length) {
      setMessage("No saved reports are available to download.", "error");
      return;
    }

    const columns = [
      "reportId", "submittedAt", "reporterName", "email", "reportType", "latitude", "longitude",
      "locationAccuracy", "locationConfirmed", "gpsLocked", "address", "condition", "severity",
      "segmentStartLat", "segmentStartLng", "segmentEndLat", "segmentEndLng", "segmentLengthFt",
      "verticalDisplacement", "gapWidth", "runningSlope", "crossSlope", "obstructionType", "passableWidth",
      "curbRampCondition", "detectableWarning", "pedestrianVolume", "schoolTransitProximity",
      "comments", "photoName", "photoType", "photoCaptions", "photoCount", "score", "conditionClass",
      "priorityScore", "priorityClass"
    ];

    const rows = [columns.join(",")].concat(reports.map((report) => {
      return columns.map((column) => csvValue(report[column])).join(",");
    }));

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sidewalk-assessment-reports.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvValue(value) {
    const text = String(value || "");
    return "\"" + text.replace(/"/g, "\"\"") + "\"";
  }
})();
