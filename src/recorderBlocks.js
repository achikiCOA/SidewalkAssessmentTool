(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.recorderBlocks = App.recorderBlocks || {};

  /**
   * Normalize block status values from ArcGIS/domain labels before comparison.
   * @param {string} status - Raw status value.
   * @returns {string}
   */
  App.recorderBlocks.normalizeBlockStatus = function normalizeBlockStatus(status) {
    const value = String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ");
    if (value === "complete" || value === "completed" || value === "done") return "Complete";
    if (value === "in progress" || value === "inprogress" || value === "started") return "In Progress";
    if (value === "not started" || value === "notstarted" || value === "open" || value === "") return "Not Started";
    return String(status || "Not Started").trim();
  };

  /**
   * Check whether a block status should prevent duplicate recording.
   * @param {string} status - Raw status value.
   * @returns {boolean}
   */
  App.recorderBlocks.isCompleteStatus = function isCompleteStatus(status) {
    return App.recorderBlocks.normalizeBlockStatus(status) === "Complete";
  };
})();
