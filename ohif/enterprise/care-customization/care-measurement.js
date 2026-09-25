/**
 * CARE measurement runtime — subscribes to OHIF v3.10 MeasurementService.
 *
 * Requires window.__CARE_OHIF__.servicesManager (exposed by App.tsx patch).
 * Standalone OHIF (no ERP parent) continues to work; broadcasts are no-ops
 * when allowlists are empty / no trusted parent.
 *
 * Depends on: care-security.js, care-measurement-adapter.js, care-bridge.js
 */
(function () {
  "use strict";

  var ADAPTER = window.CARE_MEASUREMENT_ADAPTER;
  var SEC = window.CARE_SECURITY;
  if (!ADAPTER || !SEC) {
    console.error("[CARE measurement] adapter/security missing");
    return;
  }

  var STATE = {
    intent: null,
    spinalLevel: null,
    careLabel: null,
    lastMeasurementId: null,
    unsubs: [],
    started: false,
  };

  function careConfig() {
    return (window.config && window.config.care) || {};
  }

  function allowlist() {
    var cfg = careConfig();
    return Array.isArray(cfg.erpOriginAllowlist) ? cfg.erpOriginAllowlist : [];
  }

  function metaFromSticky() {
    return {
      intent: STATE.intent,
      spinalLevel: STATE.spinalLevel,
      careLabel: STATE.careLabel,
    };
  }

  function getServices() {
    var root = window.__CARE_OHIF__;
    if (!root || !root.servicesManager || !root.servicesManager.services) return null;
    return root.servicesManager.services;
  }

  /**
   * Broadcast to ERP parent/opener only (fail-closed). Never "*".
   * Dual-protocol: care.viewer.* + legacy source:care-ohif.
   */
  function broadcast(payloads) {
    var list = Array.isArray(payloads) ? payloads : [payloads];
    var targets = [];
    if (window.opener && window.opener !== window) targets.push(window.opener);
    if (window.parent && window.parent !== window) targets.push(window.parent);
    if (!targets.length) return;

    var origins = allowlist();
    if (!origins.length) return;

    for (var t = 0; t < targets.length; t++) {
      var target = targets[t];
      for (var o = 0; o < origins.length; o++) {
        var origin = SEC.normalizeOrigin(origins[o]);
        if (!origin) continue;
        for (var p = 0; p < list.length; p++) {
          var payload = list[p];
          try {
            SEC.assertNoPhiKeys(payload);
            if (payload.measurement) SEC.assertNoPhiKeys(payload.measurement);
            target.postMessage(payload, origin);
          } catch (err) {
            console.warn("[CARE measurement] postMessage blocked/failed", err && err.message);
          }
        }
      }
    }
  }

  function resolveMeasurement(detail) {
    if (!detail) return null;
    if (detail.measurement && typeof detail.measurement === "object" && detail.measurement.uid) {
      return detail.measurement;
    }
    // MEASUREMENT_REMOVED passes measurement UID string
    if (typeof detail.measurement === "string") {
      return { uid: detail.measurement };
    }
    if (detail.uid) return detail;
    return null;
  }

  function onAdded(evt) {
    var m = resolveMeasurement(evt);
    if (!m || !m.uid) return;
    STATE.lastMeasurementId = m.uid;
    var meta = metaFromSticky();
    var care = ADAPTER.buildCareEvent("care.viewer.measurementAdded", m, meta);
    var erp = ADAPTER.buildErpLegacyMeasurement(m, meta);
    broadcast([care, erp]);
    window.dispatchEvent(
      new CustomEvent("care:measurement", { detail: { action: "added", measurement: care.measurement } })
    );
  }

  function onUpdated(evt) {
    var m = resolveMeasurement(evt);
    if (!m || !m.uid) return;
    STATE.lastMeasurementId = m.uid;
    var meta = metaFromSticky();
    var care = ADAPTER.buildCareEvent("care.viewer.measurementUpdated", m, meta);
    var erp = ADAPTER.buildErpLegacyMeasurement(m, meta);
    broadcast([care, erp]);
    window.dispatchEvent(
      new CustomEvent("care:measurement", {
        detail: { action: "updated", measurement: care.measurement },
      })
    );
  }

  function onRemoved(evt) {
    var id =
      (evt && typeof evt.measurement === "string" && evt.measurement) ||
      (evt && evt.measurement && evt.measurement.uid) ||
      null;
    if (!id) return;
    var care = ADAPTER.buildCareRemoved(id);
    var erp = ADAPTER.buildErpLegacyDeleted(id, null);
    broadcast([care, erp]);
    window.dispatchEvent(
      new CustomEvent("care:measurement", { detail: { action: "removed", measurementId: id } })
    );
  }

  function subscribe() {
    if (STATE.started) return true;
    var services = getServices();
    if (!services || !services.measurementService) return false;
    var ms = services.measurementService;
    var EV = ms.EVENTS || (ms.constructor && ms.constructor.EVENTS) || {};
    var unsubs = [];
    if (EV.MEASUREMENT_ADDED && typeof ms.subscribe === "function") {
      unsubs.push(ms.subscribe(EV.MEASUREMENT_ADDED, onAdded));
      unsubs.push(ms.subscribe(EV.RAW_MEASUREMENT_ADDED, onAdded));
      unsubs.push(ms.subscribe(EV.MEASUREMENT_UPDATED, onUpdated));
      unsubs.push(ms.subscribe(EV.MEASUREMENT_REMOVED, onRemoved));
    } else {
      console.warn("[CARE measurement] MeasurementService.subscribe unavailable");
      return false;
    }
    STATE.unsubs = unsubs;
    STATE.started = true;
    console.info("[CARE measurement] subscribed to MeasurementService");
    return true;
  }

  function setIntent(intent) {
    STATE.intent = intent || null;
    if (intent === ADAPTER.INTENTS.CANAL_AP && !STATE.careLabel) {
      STATE.careLabel = "Spinal Canal AP";
    }
  }

  function setSpinalLevel(level) {
    STATE.spinalLevel = ADAPTER.normalizeSpinalLevel(level);
  }

  function setCareLabel(label) {
    STATE.careLabel = label || null;
  }

  function clearSticky() {
    STATE.intent = null;
    STATE.spinalLevel = null;
    STATE.careLabel = null;
  }

  /** Apply sticky label/level to the last measurement via MeasurementService.update. */
  function applyStickyToLast() {
    if (!STATE.lastMeasurementId) return false;
    var services = getServices();
    if (!services || !services.measurementService) return false;
    var ms = services.measurementService;
    var existing = ms.getMeasurement && ms.getMeasurement(STATE.lastMeasurementId);
    if (!existing) return false;
    var meta = metaFromSticky();
    var structured = ADAPTER.buildStructuredMeasurement(existing, meta);
    var nextLabel = structured.label || existing.label;
    try {
      if (typeof ms.update === "function") {
        var patched = Object.assign({}, existing, { label: nextLabel });
        ms.update(STATE.lastMeasurementId, patched, true);
      } else if (typeof ms.addRawMeasurement === "function") {
        /* update path preferred; skip if unavailable */
      }
      onUpdated({ measurement: Object.assign({}, existing, { label: nextLabel }) });
      return true;
    } catch (err) {
      console.warn("[CARE measurement] applySticky failed", err && err.message);
      return false;
    }
  }

  // Poll until OHIF exposes services (App mount). Safe if never appears.
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (subscribe() || tries > 120) clearInterval(timer);
  }, 500);

  window.CARE_MEASUREMENT = {
    setIntent: setIntent,
    setSpinalLevel: setSpinalLevel,
    setCareLabel: setCareLabel,
    clearSticky: clearSticky,
    applyStickyToLast: applyStickyToLast,
    getSticky: function () {
      return {
        intent: STATE.intent,
        spinalLevel: STATE.spinalLevel,
        careLabel: STATE.careLabel,
        lastMeasurementId: STATE.lastMeasurementId,
      };
    },
    _test: {
      onAdded: onAdded,
      onUpdated: onUpdated,
      onRemoved: onRemoved,
      broadcast: broadcast,
    },
  };
})();
