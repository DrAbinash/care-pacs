/**
 * Shared CARE viewer security helpers.
 * Loaded in the browser as a classic script (attaches to globalThis.CARE_SECURITY)
 * and required by Node tests via CommonJS.
 *
 * No PHI. No secrets. No unrestricted redirects.
 */
(function (root, factory) {
  const api = factory();
  root.CARE_SECURITY = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeOrigin(value) {
    if (!value || typeof value !== "string") return null;
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch (_e) {
      return null;
    }
  }

  function isOriginAllowlisted(origin, allowlist) {
    if (!origin || !Array.isArray(allowlist) || allowlist.length === 0) return false;
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    return allowlist.some(function (entry) {
      return normalizeOrigin(entry) === normalized;
    });
  }

  /**
   * Allow only absolute http(s) URLs whose origin is allowlisted,
   * or same-origin relative paths starting with "/".
   * Rejects open redirects (protocol-relative, javascript:, data:, etc.).
   */
  function resolveSafeReturnUrl(candidate, allowlist, pageOrigin) {
    if (!candidate || typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    if (/^\/\//.test(trimmed)) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:/i.test(trimmed)) {
      return null;
    }

    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      if (!pageOrigin) return null;
      try {
        return new URL(trimmed, pageOrigin).toString();
      } catch (_e) {
        return null;
      }
    }

    let absolute;
    try {
      absolute = new URL(trimmed);
    } catch (_e) {
      return null;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
    if (!isOriginAllowlisted(absolute.origin, allowlist || [])) return null;
    return absolute.toString();
  }

  function buildContextPayload(input) {
    const src = input && typeof input === "object" ? input : {};
    return {
      type: "care.viewer.context",
      version: 1,
      studyInstanceUID: typeof src.studyInstanceUID === "string" ? src.studyInstanceUID : null,
      seriesInstanceUID:
        typeof src.seriesInstanceUID === "string" ? src.seriesInstanceUID : null,
      sopInstanceUID: typeof src.sopInstanceUID === "string" ? src.sopInstanceUID : null,
      frameNumber: Number.isFinite(src.frameNumber) ? src.frameNumber : null,
      viewerName: typeof src.viewerName === "string" ? src.viewerName : "CARE Diagnostics Viewer",
      hrefPath: typeof src.hrefPath === "string" ? src.hrefPath : null,
    };
  }

  function assertNoPhiKeys(payload) {
    const forbidden = [
      "patientName",
      "PatientName",
      "patientId",
      "PatientID",
      "phone",
      "mobile",
      "address",
      "pixelData",
      "PixelData",
    ];
    for (let i = 0; i < forbidden.length; i++) {
      if (Object.prototype.hasOwnProperty.call(payload, forbidden[i])) {
        throw new Error("PHI key forbidden in CARE bridge payload: " + forbidden[i]);
      }
    }
  }

  return {
    normalizeOrigin: normalizeOrigin,
    isOriginAllowlisted: isOriginAllowlisted,
    resolveSafeReturnUrl: resolveSafeReturnUrl,
    buildContextPayload: buildContextPayload,
    assertNoPhiKeys: assertNoPhiKeys,
  };
});
