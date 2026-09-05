/**
 * Optional runtime overrides for CARE integration allowlists.
 *
 * Prefer window.config.care in app-config.js for image defaults.
 * When Compose mounts this file over /care/care-config.js (see docker-compose.yml),
 * operators can update allowlists without rebuilding the OHIF image.
 *
 * No secrets. No PHI. Empty allowlists remain fail-closed.
 *
 * This is a static script integration — not an OHIF extension registration.
 */
(function () {
  "use strict";

  window.careConfig = window.careConfig || {
    // Example (disabled by default — enable via mounted override on the NAS):
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
