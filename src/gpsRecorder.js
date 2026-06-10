(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.gpsRecorder = App.gpsRecorder || {};

  /**
   * Calculate distance between two latitude/longitude points in meters.
   * @param {{latitude?: number, longitude?: number, lat?: number, lng?: number}} a - First point.
   * @param {{latitude?: number, longitude?: number, lat?: number, lng?: number}} b - Second point.
   * @returns {number}
   */
  App.gpsRecorder.calculateDistanceMeters = function calculateDistanceMeters(a, b) {
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
  };

  /**
   * Classify GPS accuracy for display.
   * @param {number|string} accuracyMeters - Accuracy in meters.
   * @returns {"good"|"fair"|"poor"|""}
   */
  App.gpsRecorder.classifyAccuracy = function classifyAccuracy(accuracyMeters) {
    const accuracy = Number(accuracyMeters);
    if (!Number.isFinite(accuracy)) return "";
    if (accuracy <= 5) return "good";
    if (accuracy <= 15) return "fair";
    return "poor";
  };
})();
