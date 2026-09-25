/**
 * CARE Diagnostics Viewer — restrained chrome overlays.
 *
 * Build-time static integration (not an OHIF React extension):
 * - Document title
 * - Collapsible About / Shortcuts / build-info control (non-obstructive)
 * - Optional Return-to-CARE (hidden when no safe destination)
 *
 * Depends on: care-security.js, app-config.js (window.config)
 * No PHI in console logs. Query params are never inserted as HTML.
 */
(function () {
  "use strict";

  var SEC = window.CARE_SECURITY;
  if (!SEC) {
    console.error("[CARE chrome] care-security.js must load first");
    return;
  }

  var TITLE = "CARE Diagnostics Viewer";
  var COLLAPSED_KEY = "care.viewer.chromeCollapsed";

  // Reading-room cheat sheet only — no patient data, no UIDs.
  var SHORTCUTS = [
    ["1–4", "CT W/L Soft tissue / Lung / Bone / Brain"],
    ["5–6", "CT W/L Liver / Mediastinum"],
    ["z", "Zoom tool"],
    ["+/-/=", "Zoom in / out / fit"],
    ["r / l", "Rotate CW / CCW"],
    ["h / v", "Flip H / V"],
    ["i", "Invert"],
    ["c", "Cine"],
    ["↑ / ↓", "Previous / next image"],
    ["← / →", "Previous / next viewport"],
    ["PgUp / PgDn", "Previous / next series"],
    ["Space", "Reset viewport"],
    ["Esc", "Cancel measurement"],
  ];

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
    // Fail closed: hide Return when allowlist is empty.
    if (!allow.length) return null;
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

  function removePanel(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  }

  function panelShell(id, titleText) {
    removePanel(id);
    var panel = document.createElement("div");
    panel.id = id;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", titleText);
    panel.style.cssText =
      "position:fixed;z-index:99991;right:12px;bottom:48px;max-width:320px;" +
      "background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;" +
      "padding:12px 14px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    var h = document.createElement("div");
    h.style.cssText = "font-weight:600;margin-bottom:8px;font-size:13px";
    h.textContent = titleText;
    panel.appendChild(h);
    return panel;
  }

  function closeButton(panel) {
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText =
      "margin-top:8px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;" +
      "border-radius:4px;padding:4px 10px;cursor:pointer";
    close.addEventListener("click", function () {
      panel.remove();
    });
    return close;
  }

  function showAbout() {
    loadBuildInfo(function (info) {
      removePanel("care-shortcuts-panel");
      var panel = panelShell("care-about-panel", careConfig().viewerName || TITLE);

      function row(label, value) {
        var p = document.createElement("p");
        p.style.cssText = "margin:4px 0";
        var strong = document.createElement("strong");
        strong.textContent = label + ": ";
        p.appendChild(strong);
        // textContent only — never interpret query/build strings as HTML
        p.appendChild(document.createTextNode(value == null ? "—" : String(value)));
        return p;
      }

      panel.appendChild(row("CARE viewer", info.careViewerVersion));
      panel.appendChild(row("OHIF ref", info.ohifRef));
      panel.appendChild(
        row("OHIF commit", info.ohifCommit ? String(info.ohifCommit).slice(0, 12) : null)
      );
      if (info.builtAtUtc) panel.appendChild(row("Built", info.builtAtUtc));
      if (info.note) panel.appendChild(row("Note", info.note));
      panel.appendChild(closeButton(panel));
      document.body.appendChild(panel);
    });
  }

  function showShortcuts() {
    removePanel("care-about-panel");
    var panel = panelShell("care-shortcuts-panel", "Reading shortcuts");
    var note = document.createElement("p");
    note.style.cssText = "margin:0 0 8px;opacity:.8";
    note.textContent = "Defaults from OHIF 3.10 + CARE W/L extras. No patient data.";
    panel.appendChild(note);

    var table = document.createElement("div");
    for (var i = 0; i < SHORTCUTS.length; i++) {
      var row = document.createElement("div");
      row.style.cssText =
        "display:grid;grid-template-columns:72px 1fr;gap:8px;padding:2px 0;border-top:1px solid #1f2937";
      var k = document.createElement("code");
      k.style.cssText = "color:#93c5fd;font-size:11px";
      k.textContent = SHORTCUTS[i][0];
      var v = document.createElement("span");
      v.textContent = SHORTCUTS[i][1];
      row.appendChild(k);
      row.appendChild(v);
      table.appendChild(row);
    }
    panel.appendChild(table);
    panel.appendChild(closeButton(panel));
    document.body.appendChild(panel);
  }

  function chip(label, active, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "pointer-events:auto;margin:2px;padding:4px 8px;border-radius:4px;cursor:pointer;" +
      "font:11px/1.2 system-ui,sans-serif;border:1px solid " +
      (active ? "#059669" : "#4b5563") +
      ";background:" +
      (active ? "#065f46" : "#1f2937") +
      ";color:#e5e7eb";
    b.addEventListener("click", onClick);
    return b;
  }

  function showMeasurePanel() {
    removePanel("care-about-panel");
    removePanel("care-shortcuts-panel");
    removePanel("care-measure-panel");
    var ADAPTER = window.CARE_MEASUREMENT_ADAPTER;
    var API = window.CARE_MEASUREMENT;
    if (!ADAPTER || !API) {
      var missing = panelShell("care-measure-panel", "Measurements");
      missing.appendChild(
        document.createTextNode("Measurement bridge not loaded in this image.")
      );
      missing.appendChild(closeButton(missing));
      document.body.appendChild(missing);
      return;
    }

    var sticky = API.getSticky();
    var panel = panelShell("care-measure-panel", "Measure → CARE ERP");
    panel.style.maxWidth = "360px";

    var note = document.createElement("p");
    note.style.cssText = "margin:0 0 8px;opacity:.85";
    note.textContent =
      "Optional sticky intent. Measure without a label anytime. Levels are never auto-guessed.";
    panel.appendChild(note);

    function refresh() {
      sticky = API.getSticky();
      showMeasurePanel();
    }

    var intentRow = document.createElement("div");
    intentRow.style.cssText = "margin-bottom:8px";
    intentRow.appendChild(document.createTextNode("Intent: "));
    [
      ["Canal AP", ADAPTER.INTENTS.CANAL_AP],
      ["Lesion", ADAPTER.INTENTS.LESION],
      ["Midline", ADAPTER.INTENTS.MIDLINE_SHIFT],
      ["Other", ADAPTER.INTENTS.OTHER],
    ].forEach(function (pair) {
      intentRow.appendChild(
        chip(pair[0], sticky.intent === pair[1], function () {
          API.setIntent(sticky.intent === pair[1] ? null : pair[1]);
          refresh();
        })
      );
    });
    panel.appendChild(intentRow);

    var cRow = document.createElement("div");
    cRow.style.cssText = "margin-bottom:6px";
    cRow.appendChild(document.createTextNode("Cervical: "));
    ADAPTER.CERVICAL_LEVELS.forEach(function (lvl) {
      var short = lvl.replace(/^C(\d+)-C?/, "C$1-").replace(/C(\d+)$/, "$1");
      // Display C2-3 style; store C2-C3
      var display = lvl.replace(/-C/g, "-").replace(/-L/g, "-");
      cRow.appendChild(
        chip(display, sticky.spinalLevel === lvl, function () {
          API.setIntent(ADAPTER.INTENTS.CANAL_AP);
          API.setCareLabel("Spinal Canal AP");
          API.setSpinalLevel(sticky.spinalLevel === lvl ? null : lvl);
          API.applyStickyToLast();
          refresh();
        })
      );
    });
    panel.appendChild(cRow);

    var lRow = document.createElement("div");
    lRow.style.cssText = "margin-bottom:6px";
    lRow.appendChild(document.createTextNode("Lumbar: "));
    ADAPTER.LUMBAR_LEVELS.forEach(function (lvl) {
      var display = lvl.replace(/-L/g, "-").replace(/-S/g, "-S");
      lRow.appendChild(
        chip(display, sticky.spinalLevel === lvl, function () {
          API.setIntent(ADAPTER.INTENTS.CANAL_AP);
          API.setCareLabel("Spinal Canal AP");
          API.setSpinalLevel(sticky.spinalLevel === lvl ? null : lvl);
          API.applyStickyToLast();
          refresh();
        })
      );
    });
    panel.appendChild(lRow);

    var brainRow = document.createElement("div");
    brainRow.style.cssText = "margin-bottom:6px";
    brainRow.appendChild(document.createTextNode("Brain labels: "));
    ADAPTER.BRAIN_LABELS.forEach(function (lab) {
      brainRow.appendChild(
        chip(lab, sticky.careLabel === lab, function () {
          if (lab === "Midline Shift") API.setIntent(ADAPTER.INTENTS.MIDLINE_SHIFT);
          else if (lab === "Lesion" || lab === "Mass" || lab === "Hematoma")
            API.setIntent(ADAPTER.INTENTS.LESION);
          API.setCareLabel(sticky.careLabel === lab ? null : lab);
          API.applyStickyToLast();
          refresh();
        })
      );
    });
    panel.appendChild(brainRow);

    var status = document.createElement("p");
    status.style.cssText = "margin:8px 0 0;opacity:.9;font-size:11px";
    status.textContent =
      "Sticky: " +
      (sticky.intent || "—") +
      " / " +
      (sticky.spinalLevel || "—") +
      " / " +
      (sticky.careLabel || "—");
    panel.appendChild(status);

    var clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear sticky";
    clear.style.cssText =
      "margin-top:8px;margin-right:6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;" +
      "border-radius:4px;padding:4px 10px;cursor:pointer";
    clear.addEventListener("click", function () {
      API.clearSticky();
      refresh();
    });
    panel.appendChild(clear);
    panel.appendChild(closeButton(panel));
    document.body.appendChild(panel);
  }

  function isCollapsed() {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function setCollapsed(value) {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch (_e) {
      /* ignore */
    }
  }

  function mountChrome() {
    if (document.getElementById("care-chrome-bar")) return;
    if (!document.body) return;

    var bar = document.createElement("div");
    bar.id = "care-chrome-bar";
    bar.style.cssText =
      "position:fixed;z-index:99990;right:8px;bottom:8px;display:flex;gap:6px;" +
      "align-items:center;font:12px/1 system-ui,sans-serif;pointer-events:none";

    function styleInteractive(el, bg, color, border) {
      el.style.cssText =
        "pointer-events:auto;background:" +
        bg +
        ";color:" +
        color +
        ";border:1px solid " +
        border +
        ";border-radius:4px;padding:5px 9px;cursor:pointer;opacity:0.88";
    }

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "care-chrome-toggle";
    toggle.title = "Show or hide CARE viewer controls";
    styleInteractive(toggle, "#111827", "#d1d5db", "#374151");

    var actions = document.createElement("div");
    actions.id = "care-chrome-actions";
    actions.style.cssText = "display:flex;gap:6px;pointer-events:auto";

    var aboutBtn = document.createElement("button");
    aboutBtn.type = "button";
    aboutBtn.textContent = "About";
    aboutBtn.title = "Build and version information";
    styleInteractive(aboutBtn, "#111827", "#d1d5db", "#374151");
    aboutBtn.addEventListener("click", showAbout);
    actions.appendChild(aboutBtn);

    var shortcutsBtn = document.createElement("button");
    shortcutsBtn.type = "button";
    shortcutsBtn.id = "care-chrome-shortcuts";
    shortcutsBtn.textContent = "Keys";
    shortcutsBtn.title = "Reading-room keyboard shortcuts";
    styleInteractive(shortcutsBtn, "#111827", "#d1d5db", "#374151");
    shortcutsBtn.addEventListener("click", showShortcuts);
    actions.appendChild(shortcutsBtn);

    var measureBtn = document.createElement("button");
    measureBtn.type = "button";
    measureBtn.id = "care-chrome-measure";
    measureBtn.textContent = "Measure";
    measureBtn.title = "CARE measurement labels / spinal levels (sticky intent)";
    styleInteractive(measureBtn, "#1e3a5f", "#dbeafe", "#1e40af");
    measureBtn.addEventListener("click", showMeasurePanel);
    actions.appendChild(measureBtn);

    var returnUrl = resolveReturnUrl();
    if (returnUrl) {
      var retBtn = document.createElement("button");
      retBtn.type = "button";
      retBtn.textContent = "Return";
      retBtn.title = "Return to CARE ERP";
      styleInteractive(retBtn, "#0f766e", "#ecfdf5", "#115e59");
      retBtn.addEventListener("click", function () {
        var safe = resolveReturnUrl();
        if (!safe) return;
        window.location.assign(safe);
      });
      actions.appendChild(retBtn);
    }

    function applyCollapsedState() {
      var collapsed = isCollapsed();
      actions.style.display = collapsed ? "none" : "flex";
      toggle.textContent = collapsed ? "CARE" : "▾";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (collapsed) {
        removePanel("care-about-panel");
        removePanel("care-shortcuts-panel");
        removePanel("care-measure-panel");
      }
    }

    toggle.addEventListener("click", function () {
      setCollapsed(!isCollapsed());
      applyCollapsedState();
    });

    bar.appendChild(actions);
    bar.appendChild(toggle);
    document.body.appendChild(bar);
    applyCollapsedState();
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
