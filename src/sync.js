(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.sync = App.sync || {};

  /**
   * Validate an upload endpoint before sending user data.
   * @param {string} url - Candidate endpoint URL.
   * @returns {boolean}
   */
  App.sync.isValidUploadUrl = function isValidUploadUrl(url) {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && Boolean(parsed.hostname);
    } catch (error) {
      return false;
    }
  };
})();
