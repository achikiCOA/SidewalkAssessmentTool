(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.exportGeoJson = App.exportGeoJson || {};

  /**
   * Validate the minimum structure ArcGIS Online expects for a GeoJSON FeatureCollection.
   * @param {object} geoJson - GeoJSON object to validate.
   * @returns {{ok: boolean, error: string}}
   */
  App.exportGeoJson.validateFeatureCollection = function validateFeatureCollection(geoJson) {
    if (!geoJson || geoJson.type !== "FeatureCollection") {
      return { ok: false, error: "GeoJSON must be a FeatureCollection." };
    }
    if (!Array.isArray(geoJson.features)) {
      return { ok: false, error: "GeoJSON features must be an array." };
    }
    for (const feature of geoJson.features) {
      if (!feature.geometry || feature.geometry.type !== "LineString") {
        return { ok: false, error: "Each feature must be a LineString." };
      }
      if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) {
        return { ok: false, error: "Each LineString must contain at least two coordinates." };
      }
    }
    return { ok: true, error: "" };
  };
})();
