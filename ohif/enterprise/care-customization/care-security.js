/**
 * Shared CARE viewer security helpers.
 * Classic browser script (globalThis.CARE_SECURITY) + CommonJS for Node tests.
 *
 * No PHI. No secrets. No unrestricted redirects / postMessage("*").
 */
(function (root, factory) {
  const api = factory();
  root.CARE_SECURITY = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FORBIDDEN_PHI_KEYS = [
    "patientName",
    "PatientName",
    "patientId",
    "PatientID",
    "accessionNumber",
    "AccessionNumber",
    "phone",
    "mobile",
    "address",
    "pixelData",
    "PixelData",
  ];

  function normalizeOrigin(value) {
    if (!value || typeof value !== "string") return null;
    try {
      var u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch (_e) {
      return null;
    }
  }

  function isOriginAllowlisted(origin, allowlist) {
    if (!origin || !Array.isArray(allowlist) || allowlist.length === 0) return false;
    var normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    return allowlist.some(function (entry) {
      return normalizeOrigin(entry) === normalized;
    });
  }

  /**
   * Trusted ERP sources: parent frame or window.opener only.
   * Blocks sibling iframes / unrelated windows even if their origin is allowlisted.
   */
  function isTrustedMessageSource(event, viewerWindow) {
    if (!event || !event.source) return false;
    var w = viewerWindow || (typeof window !== "undefined" ? window : null);
    if (!w) return false;
    if (event.source === w.parent && w.parent !== w) return true;
    if (event.source === w.opener && w.opener) return true;
    // Standalone top-level viewer: ignore cross-window probes unless opener/parent.
    return false;
  }

  /**
   * Allow only absolute http(s) URLs whose origin is allowlisted,
   * or same-origin relative paths starting with a single "/".
   * Rejects open redirects (protocol-relative, javascript:, data:, encoded tricks).
   */
  function resolveSafeReturnUrl(candidate, allowlist, pageOrigin) {
    if (!candidate || typeof candidate !== "string") return null;
    var trimmed = candidate.trim();
    if (!trimmed) return null;

    // Decode once to catch encoded protocol-relative / javascript: payloads.
    var decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch (_e) {
      return null;
    }
    decoded = decoded.trim();
    if (!decoded) return null;
    if (/^\/\//.test(decoded) || /^\\/.test(decoded)) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) && !/^https?:/i.test(decoded)) {
      return null;
    }

    // Same-origin relative paths only. Reject authority tricks (//, \\\\, etc.).
    if (decoded.startsWith("/") && !decoded.startsWith("//")) {
      if (!pageOrigin) return null;
      if (decoded.indexOf("\\") !== -1 || decoded.indexOf("//") !== -1) return null;
      try {
        var rel = new URL(decoded, pageOrigin);
        if (normalizeOrigin(rel.origin) !== normalizeOrigin(pageOrigin)) return null;
        return rel.toString();
      } catch (_e2) {
        return null;
      }
    }

    var absolute;
    try {
      absolute = new URL(decoded);
    } catch (_e3) {
      return null;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
    if (absolute.username || absolute.password) return null;
    if (!isOriginAllowlisted(absolute.origin, allowlist || [])) return null;
    return absolute.toString();
  }

  function buildContextPayload(input) {
    var src = input && typeof input === "object" ? input : {};
    return {
      type: "care.viewer.context",
      version: 1,
      studyInstanceUID: typeof src.studyInstanceUID === "string" ? src.studyInstanceUID : null,
      seriesInstanceUID:
        typeof src.seriesInstanceUID === "string" ? src.seriesInstanceUID : null,
      sopInstanceUID: typeof src.sopInstanceUID === "string" ? src.sopInstanceUID : null,
      frameNumber: Number.isFinite(src.frameNumber) ? src.frameNumber : null,
      viewerName:
        typeof src.viewerName === "string" ? src.viewerName : "CARE Diagnostics Viewer",
      hrefPath: typeof src.hrefPath === "string" ? src.hrefPath : null,
    };
  }

  function assertNoPhiKeys(payload) {
    for (var i = 0; i < FORBIDDEN_PHI_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(payload, FORBIDDEN_PHI_KEYS[i])) {
        throw new Error("PHI key forbidden in CARE bridge payload: " + FORBIDDEN_PHI_KEYS[i]);
      }
    }
  }

  return {
    normalizeOrigin: normalizeOrigin,
    isOriginAllowlisted: isOriginAllowlisted,
    isTrustedMessageSource: isTrustedMessageSource,
    resolveSafeReturnUrl: resolveSafeReturnUrl,
    buildContextPayload: buildContextPayload,
    assertNoPhiKeys: assertNoPhiKeys,
  };
});
