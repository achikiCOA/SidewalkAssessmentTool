(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.scoring = App.scoring || {};

  /**
   * Convert a numeric GIS score into the public condition class.
   * @param {number} score - GIS score from 0 to 100.
   * @returns {string}
   */
  App.scoring.getConditionClass = function getConditionClass(score) {
    const value = Number(score);
    if (value >= 85) return "Excellent";
    if (value >= 70) return "Good";
    if (value >= 50) return "Fair";
    if (value >= 25) return "Poor";
    return "Failed";
  };

  /**
   * Convert a numeric priority score into a priority class.
   * @param {number} score - Priority score from 0 to 100.
   * @returns {string}
   */
  App.scoring.getPriorityClass = function getPriorityClass(score) {
    const value = Number(score);
    if (value >= 75) return "Critical";
    if (value >= 55) return "High";
    if (value >= 30) return "Medium";
    return "Low";
  };
})();
