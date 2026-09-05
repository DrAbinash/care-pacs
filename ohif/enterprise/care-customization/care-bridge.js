/**
 * CARE Diagnostics Viewer — ERP integration bridge (v1).
 *
 * This is a build-time static integration layer (script tags injected into
 * compiled index.html). It is NOT a registered OHIF/Cornerstone extension.
 *
 * Contract (viewer ↔ CARE ERP parent/opener):
 *   ERP → viewer:
 *     { type: "care.viewer.requestContext", requestId?: string }
 *     { type: "care.viewer.ping", requestId?: string }
 *   viewer → ERP (only to event.origin when allowlisted AND source is parent/opener):
 *     { type: "care.viewer.context", version: 1, studyInstanceUID, seriesInstanceUID,
 *       sopInstanceUID, frameNumber, viewerName, hrefPath, requestId? }
 *     { type: "care.viewer.pong", version: 1, requestId? }
 *     { type: "care.viewer.error", version: 1, code, message, requestId? }
 *
 * Security:
 *   - Never uses targetOrigin "*"
 *   - Empty erpOriginAllowlist ⇒ fail closed (no replies)
 *   - Only parent frame or window.opener may request context
 *   - Never sends PHI (patient name/id/accession/phone/pixels)
 *   - Works standalone when no ERP parent exists
 *
 * Depends on: care-security.js (window.CARE_SECURITY)
 */
(function () {
  "use strict";

  var SEC = window.CARE_SECURITY;
  if (!SEC) {
    console.error("[CARE bridge] care-security.js must load first");
    return;
  }

  function careConfig() {
    return (window.config && window.config.care) || {};
  }

  function allowlist() {
    var cfg = careConfig();
    return Array.isArray(cfg.erpOriginAllowlist) ? cfg.erpOriginAllowlist : [];
  }

  function readUidsFromLocation() {
    var out = {
      studyInstanceUID: null,
      seriesInstanceUID: null,
      sopInstanceUID: null,
      frameNumber: null,
    };
    try {
      var params = new URLSearchParams(window.location.search);
      out.studyInstanceUID =
        params.get("StudyInstanceUIDs") ||
        params.get("studyInstanceUIDs") ||
        params.get("StudyInstanceUID") ||
        null;
      if (out.studyInstanceUID && out.studyInstanceUID.indexOf(",") !== -1) {
        out.studyInstanceUID = out.studyInstanceUID.split(",")[0].trim() || null;
      }
      out.seriesInstanceUID = params.get("SeriesInstanceUID") || null;
      out.sopInstanceUID = params.get("SOPInstanceUID") || null;
      var frame = params.get("frameNumber") || params.get("frame");
      if (frame != null && frame !== "") {
        var n = Number(frame);
        out.frameNumber = Number.isFinite(n) ? n : null;
      }
    } catch (_e) {
      /* ignore */
    }
    return out;
  }

  function currentContext(requestId) {
    var uids = readUidsFromLocation();
    var cfg = careConfig();
    var payload = SEC.buildContextPayload({
      studyInstanceUID: uids.studyInstanceUID,
      seriesInstanceUID: uids.seriesInstanceUID,
      sopInstanceUID: uids.sopInstanceUID,
      frameNumber: uids.frameNumber,
      viewerName: cfg.viewerName || "CARE Diagnostics Viewer",
      hrefPath: window.location.pathname + window.location.search,
    });
    if (requestId != null) payload.requestId = String(requestId);
    SEC.assertNoPhiKeys(payload);
    return payload;
  }

  function reply(event, payload) {
    if (!event || !event.source || typeof event.source.postMessage !== "function") return;
    if (!SEC.isOriginAllowlisted(event.origin, allowlist())) return;
    if (!SEC.isTrustedMessageSource(event, window)) return;
    try {
      event.source.postMessage(payload, event.origin);
    } catch (err) {
      console.warn("[CARE bridge] postMessage failed", err && err.message);
    }
  }

  function onMessage(event) {
    if (!event || !event.data || typeof event.data !== "object") return;
    if (!SEC.isOriginAllowlisted(event.origin, allowlist())) return;
    if (!SEC.isTrustedMessageSource(event, window)) return;

    var type = event.data.type;
    var requestId = event.data.requestId;

    if (type === "care.viewer.ping") {
      reply(event, { type: "care.viewer.pong", version: 1, requestId: requestId });
      return;
    }

    if (type === "care.viewer.requestContext") {
      try {
        reply(event, currentContext(requestId));
      } catch (_err) {
        reply(event, {
          type: "care.viewer.error",
          version: 1,
          code: "context_failed",
          message: "Unable to build viewer context",
          requestId: requestId,
        });
      }
    }
  }

  window.addEventListener("message", onMessage);

  window.CARE_VIEWER_BRIDGE = {
    getContext: function () {
      return currentContext(null);
    },
    version: 1,
  };
})();
