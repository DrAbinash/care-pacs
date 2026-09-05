/**
 * Runtime CARE allowlist overrides (Compose bind-mounts this file over
 * /usr/share/nginx/html/care/care-config.js — see docker-compose.yml /
 * docker-compose.production.yml).
 *
 * Edit on the NAS and reload the OHIF page — no image rebuild required.
 * Keep allowlists empty to fail closed. No secrets. No PHI.
 *
 * Must merge into window.config.care — this file replaces the baked
 * care-config.js at runtime, so the merge logic lives here too.
 */
window.careConfig = Object.assign(
  {
    // Example (uncomment / edit on the NAS):
    // erpOriginAllowlist: ["https://care-erp.example"],
    // returnUrlAllowlist: ["https://care-erp.example"],
    // defaultReturnUrl: "https://care-erp.example/radiology",
  },
  window.careConfig || {}
);

(function () {
  "use strict";

  if (!window.config) return;
  window.config.care = window.config.care || {};
  var src = window.careConfig || {};
  var keys = ["erpOriginAllowlist", "returnUrlAllowlist", "defaultReturnUrl", "viewerName"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (src[k] !== undefined && src[k] !== null && src[k] !== "") {
      window.config.care[k] = src[k];
    }
  }
})();
