/**
 * Optional runtime overrides for CARE integration allowlists.
 * Prefer configuring via window.config.care in app-config.js.
 * This file lets operators drop NAS-local allowlists without rebuilding OHIF
 * (still no secrets / PHI). Merges into window.config.care when present.
 */
(function () {
  "use strict";

  window.careConfig = window.careConfig || {
    // Example (disabled by default — configure on the NAS if needed):
    // erpOriginAllowlist: ["https://care-erp.example"],
    // returnUrlAllowlist: ["https://care-erp.example"],
    // defaultReturnUrl: "https://care-erp.example/radiology",
  };

  if (!window.config) return;
  window.config.care = window.config.care || {};
  var src = window.careConfig;
  var keys = ["erpOriginAllowlist", "returnUrlAllowlist", "defaultReturnUrl", "viewerName"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (src[k] !== undefined && src[k] !== null && src[k] !== "") {
      window.config.care[k] = src[k];
    }
  }
})();
