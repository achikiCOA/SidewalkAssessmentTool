(function () {
  "use strict";

  const App = window.App = window.App || {};

  /**
   * Stable application configuration shared by future modules.
   * External endpoints should be read from this object or user settings,
   * not hardcoded inside feature code.
   */
  App.config = Object.freeze({
    defaultLocation: { lat: 39.3292, lng: -82.1013 },
    uploadUrlKey: "sidewalkAssessmentUploadUrl",
    blockLayerUrlKey: "sidewalkAssessmentBlockLayerUrl",
    storageKeys: Object.freeze({
      reports: "sidewalkAssessmentReports",
      recorderSessions: "sidewalkRecorderSessions",
      activeRecorderSession: "sidewalkRecorderActiveSession",
      contact: "sidewalkAssessmentContact",
      draft: "sidewalkAssessmentDraft"
    }),
    recorder: Object.freeze({
      maxAccuracyMeters: 15,
      startMaxAccuracyMeters: 10,
      observationMaxAccuracyMeters: 15,
      observationFixTimeoutMs: 8000,
      normalDistanceMeters: 2,
      highDetailDistanceMeters: 1,
      segmentGapMeters: 15,
      segmentGapMs: 60000
    }),
    photos: Object.freeze({
      maxCount: 8,
      maxFileBytes: 6 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024,
      allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
    })
  });

  App.selectors = Object.freeze({
    ids: Object.freeze({
      appShell: "appShell",
      introScreen: "introScreen",
      map: "map",
      recorderMap: "recorderMap",
      surveyForm: "surveyForm",
      recorderPanel: "recorderPanel",
      recorderMessage: "recorderMessage",
      recorderStatus: "recorderStatus",
      recorderCurrentCondition: "recorderCurrentCondition",
      recorderAccuracy: "recorderAccuracy",
      uploadStatus: "uploadStatus"
    })
  });

  App.dom = App.dom || {};

  /**
   * Return an element by id.
   * @param {string} id - DOM id to look up.
   * @returns {HTMLElement|null}
   */
  App.dom.field = function field(id) {
    return document.getElementById(id);
  };
})();
