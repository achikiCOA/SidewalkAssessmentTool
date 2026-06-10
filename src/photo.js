(function () {
  "use strict";

  const App = window.App = window.App || {};

  App.photo = App.photo || {};

  /**
   * Check whether a selected image file is allowed by type and size.
   * @param {File} file - Browser File object.
   * @param {{allowedTypes: string[], maxFileBytes: number}} config - Photo limits.
   * @returns {{ok: boolean, error: string}}
   */
  App.photo.validatePhotoFile = function validatePhotoFile(file, config) {
    if (!file) return { ok: false, error: "No photo selected." };
    const allowedTypes = config && Array.isArray(config.allowedTypes) ? config.allowedTypes : [];
    const maxFileBytes = config && Number(config.maxFileBytes);
    if (allowedTypes.length && !allowedTypes.includes(file.type)) {
      return { ok: false, error: "Unsupported photo type." };
    }
    if (Number.isFinite(maxFileBytes) && file.size > maxFileBytes) {
      return { ok: false, error: "Photo file is too large." };
    }
    return { ok: true, error: "" };
  };
})();
