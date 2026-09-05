/**
 * CARE Diagnostics Viewer — restrained chrome overlays.
 * - Document title
 * - About / build-info panel (from /care/build-info.js or /care/build-info.json)
 * - Optional Return-to-CARE control (allowlisted destinations only)
 *
 * Depends on: care-security.js (window.CARE_SECURITY), app-config.js (window.config)
 * No PHI in console logs.
 */
(function () {
  "use strict";

  var SEC = window.CARE_SECURITY;
  if (!SEC) {
    console.error("[CARE chrome] care-security.js must load first");
    return;
  }

  var TITLE = "CARE Diagnostics Viewer";

  function careConfig() {
    return (window.config && window.config.care) || {};
  }

  function setTitle() {
    try {
      var name = careConfig().viewerName || TITLE;
      if (document.title !== name) document.title = name;
    } catch (_e) {
      /* ignore */
    }
  }

  function resolveReturnUrl() {
    var cfg = careConfig();
    var allow = Array.isArray(cfg.returnUrlAllowlist) ? cfg.returnUrlAllowlist : [];
    var pageOrigin = window.location.origin;
    var fromQuery = null;
    try {
      fromQuery = new URLSearchParams(window.location.search).get("careReturnUrl");
    } catch (_e) {
      /* ignore */
    }
    var candidates = [fromQuery, cfg.defaultReturnUrl];
    for (var i = 0; i < candidates.length; i++) {
      var safe = SEC.resolveSafeReturnUrl(candidates[i], allow, pageOrigin);
      if (safe) return safe;
    }
    return null;
  }

  function loadBuildInfo(cb) {
    var fromWindow = window.__CARE_BUILD_INFO__ || window.CARE_BUILD_INFO;
    if (fromWindow) {
      cb(fromWindow);
      return;
    }
    fetch("/care/build-info.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("no build-info");
        return r.json();
      })
      .then(cb)
      .catch(function () {
        cb({
          careViewerVersion: "unknown",
          ohifRef: "unknown",
          ohifCommit: "unknown",
          note: "Build metadata not available in this image",
        });
      });
  }

  function showAbout() {
    loadBuildInfo(function (info) {
      var existing = document.getElementById("care-about-panel");
      if (existing) {
        existing.remove();
        return;
      }
      var panel = document.createElement("div");
      panel.id = "care-about-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "About CARE Diagnostics Viewer");
      panel.style.cssText =
        "position:fixed;z-index:99999;right:12px;bottom:48px;max-width:360px;" +
        "background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;" +
        "padding:12px 14px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";

      function row(label, value) {
        var p = document.createElement("div");
        p.style.margin = "0 0 6px";
        var strong = document.createElement("strong");
        strong.textContent = label + ": ";
        p.appendChild(strong);
        p.appendChild(document.createTextNode(value == null ? "—" : String(value)));
        return p;
      }

      var h = document.createElement("div");
      h.style.cssText = "font-weight:600;margin-bottom:8px;font-size:13px";
      h.textContent = careConfig().viewerName || TITLE;
      panel.appendChild(h);
      panel.appendChild(row("CARE viewer", info.careViewerVersion));
      panel.appendChild(row("OHIF ref", info.ohifRef));
      panel.appendChild(
        row("OHIF commit", info.ohifCommit ? String(info.ohifCommit).slice(0, 12) : null)
      );
      if (info.builtAtUtc) panel.appendChild(row("Built", info.builtAtUtc));
      if (info.note) panel.appendChild(row("Note", info.note));

      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      close.style.cssText =
        "margin-top:8px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;" +
        "border-radius:4px;padding:4px 10px;cursor:pointer";
      close.addEventListener("click", function () {
        panel.remove();
      });
      panel.appendChild(close);
      document.body.appendChild(panel);
    });
  }

  function mountChrome() {
    if (document.getElementById("care-chrome-bar")) return;
    if (!document.body) return;

    var bar = document.createElement("div");
    bar.id = "care-chrome-bar";
    bar.style.cssText =
      "position:fixed;z-index:99998;right:8px;bottom:8px;display:flex;gap:6px;" +
      "font:12px/1 system-ui,sans-serif";

    var aboutBtn = document.createElement("button");
    aboutBtn.type = "button";
    aboutBtn.textContent = "About CARE";
    aboutBtn.title = "Build and version information";
    aboutBtn.style.cssText =
      "background:#111827;color:#d1d5db;border:1px solid #374151;border-radius:4px;" +
      "padding:6px 10px;cursor:pointer;opacity:0.85";
    aboutBtn.addEventListener("click", showAbout);
    bar.appendChild(aboutBtn);

    var returnUrl = resolveReturnUrl();
    if (returnUrl) {
      var retBtn = document.createElement("button");
      retBtn.type = "button";
      retBtn.textContent = "Return to CARE";
      retBtn.title = "Return to CARE ERP";
      retBtn.style.cssText =
        "background:#0f766e;color:#ecfdf5;border:1px solid #115e59;border-radius:4px;" +
        "padding:6px 10px;cursor:pointer;opacity:0.9";
      retBtn.addEventListener("click", function () {
        var safe = resolveReturnUrl();
        if (!safe) return;
        window.location.assign(safe);
      });
      bar.appendChild(retBtn);
    }

    document.body.appendChild(bar);
  }

  setTitle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTitle();
      mountChrome();
    });
  } else {
    mountChrome();
  }

  setInterval(setTitle, 2000);
})();
