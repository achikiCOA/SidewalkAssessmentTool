(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.storage = App.storage || {};

  /**
   * Safely read JSON from localStorage.
   * @param {string} key - localStorage key.
   * @param {*} fallback - Value returned when data is missing or malformed.
   * @returns {*}
   */
  App.storage.readJson = function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  };

  /**
   * Safely write JSON to localStorage.
   * @param {string} key - localStorage key.
   * @param {*} value - JSON-serializable value.
   * @returns {boolean}
   */
  App.storage.writeJson = function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  };
})();
