(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.map = App.map || {};

  /**
   * Invalidate a Leaflet map after layout changes.
   * @param {L.Map|null} map - Leaflet map instance.
   * @param {number[]} delaysMs - Delays to run invalidateSize.
   */
  App.map.invalidateSoon = function invalidateSoon(map, delaysMs = [0, 300]) {
    if (!map || typeof map.invalidateSize !== "function") return;
    delaysMs.forEach((delay) => {
      window.setTimeout(() => map.invalidateSize(true), delay);
    });
  };

  /**
   * Attach a ResizeObserver that keeps a Leaflet map stable.
   * @param {HTMLElement} element - Map container element.
   * @param {L.Map} map - Leaflet map instance.
   * @returns {ResizeObserver|null}
   */
  App.map.observeResize = function observeResize(element, map) {
    if (!element || !window.ResizeObserver) return null;
    const observer = new ResizeObserver(() => {
      if (map) map.invalidateSize(true);
    });
    observer.observe(element);
    return observer;
  };
})();
