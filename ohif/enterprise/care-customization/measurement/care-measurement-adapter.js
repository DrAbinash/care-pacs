/**
 * CARE measurement adapter — pure transforms (Node + browser).
 * Source of truth: OHIF v3.10 MeasurementService measurement objects
 * (extensions/cornerstone measurementServiceMappings Length / Bidirectional).
 *
 * No DOM scraping. No invented clinical values.
 */
(function (root, factory) {
  var api = factory();
  root.CARE_MEASUREMENT_ADAPTER = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;

  /** Sticky-intent vocabulary aligned with CARE ERP MeasurementIntent. */
  var INTENTS = {
    CANAL_AP: "CANAL_AP",
    LESION: "LESION",
    MIDLINE_SHIFT: "MIDLINE_SHIFT",
    OTHER: "OTHER",
  };

  var CERVICAL_LEVELS = ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7"];
  var LUMBAR_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];

  var SPINE_LABELS = [
    "Spinal Canal AP",
    "Disc",
    "Disc Bulge",
    "Neural Foramen",
    "Lesion",
    "Collection",
    "Vertebral Lesion",
  ];

  var BRAIN_LABELS = [
    "Lesion",
    "Mass",
    "Nodule",
    "Cyst",
    "Collection",
    "Hematoma",
    "Midline Shift",
    "Ventricle",
    "Extra-axial Collection",
  ];

  var GENERAL_LABELS = ["Lesion", "Mass", "Node", "Calculus", "Collection", "Cyst", "Other"];

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function roundMm(n) {
    if (!isFiniteNumber(n)) return null;
    return Math.round(n * 100) / 100;
  }

  /**
   * Normalize disc labels to CARE ERP form (C4-C5, L4-L5).
   * Accepts C4-5, C4/5, C4-C5, L5-S1, etc. Does NOT invent levels.
   */
  function normalizeSpinalLevel(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
    if (!s) return null;
    s = s.replace(/\//g, "-");
    // C4-5 → C4-C5 ; L5-S1 stays; C4-C5 stays
    var m = /^([CTL])(\d{1,2})-([CTL])?(\d{1,2}|S1)$/i.exec(s);
    if (!m) {
      // L5S1
      var m2 = /^([CTL])(\d{1,2})(S1)$/i.exec(s);
      if (!m2) return null;
      return m2[1].toUpperCase() + m2[2] + "-S1";
    }
    var a = m[1].toUpperCase();
    var n1 = m[2];
    var b = (m[3] || a).toUpperCase();
    var n2 = m[4].toUpperCase();
    if (n2 === "S1") return a + n1 + "-S1";
    return a + n1 + "-" + b + n2;
  }

  function firstCachedStats(measurement) {
    var data = measurement && measurement.data;
    if (!data || typeof data !== "object") return null;
    var keys = Object.keys(data);
    if (!keys.length) return null;
    return data[keys[0]] || null;
  }

  /**
   * Extract numeric values ONLY from MeasurementService fields / cachedStats.
   * Length → lengthMm; Bidirectional → longAxisMm + shortAxisMm (from length/width).
   */
  function extractValues(measurement) {
    var values = {};
    var unit = "mm";
    var stats = firstCachedStats(measurement) || {};

    if (measurement && isFiniteNumber(measurement.length)) {
      values.lengthMm = roundMm(measurement.length);
    }
    if (isFiniteNumber(stats.length) && values.lengthMm == null) {
      values.lengthMm = roundMm(stats.length);
    }
    if (isFiniteNumber(stats.width)) {
      values.longAxisMm = roundMm(stats.length != null ? stats.length : measurement.length);
      values.shortAxisMm = roundMm(stats.width);
      if (values.lengthMm == null && values.longAxisMm != null) {
        values.lengthMm = values.longAxisMm;
      }
    }
    if (isFiniteNumber(measurement.longestDiameter)) {
      values.longAxisMm = roundMm(measurement.longestDiameter);
    }
    if (isFiniteNumber(measurement.shortestDiameter)) {
      values.shortAxisMm = roundMm(measurement.shortestDiameter);
    }
    if (isFiniteNumber(measurement.area)) {
      values.areaMm2 = roundMm(measurement.area);
    }
    if (isFiniteNumber(stats.area)) {
      values.areaMm2 = roundMm(stats.area);
    }

    if (typeof stats.unit === "string" && stats.unit) unit = stats.unit;
    else if (typeof measurement.unit === "string" && measurement.unit) unit = measurement.unit;

    return { values: values, unit: unit };
  }

  function toolTypeOf(measurement) {
    if (!measurement) return "Unknown";
    if (typeof measurement.toolName === "string" && measurement.toolName) return measurement.toolName;
    if (typeof measurement.type === "string" && measurement.type) {
      if (measurement.type.indexOf("shortAxisLongAxis") !== -1) return "Bidirectional";
      if (measurement.type.indexOf("polyline") !== -1) return "Length";
      return measurement.type;
    }
    return "Unknown";
  }

  function primaryDisplayValue(extracted) {
    var v = extracted.values;
    if (v.longAxisMm != null && v.shortAxisMm != null) {
      return v.longAxisMm + " x " + v.shortAxisMm;
    }
    if (v.lengthMm != null) return v.lengthMm;
    if (v.longAxisMm != null) return v.longAxisMm;
    if (v.areaMm2 != null) return v.areaMm2;
    return null;
  }

  /**
   * Build CARE bridge measurement object (no PHI keys).
   * @param {object} measurement OHIF MeasurementService measurement
   * @param {object} [meta] { intent, spinalLevel, careLabel, event }
   */
  function buildStructuredMeasurement(measurement, meta) {
    meta = meta || {};
    var extracted = extractValues(measurement || {});
    var toolType = toolTypeOf(measurement);
    var spinalLevel = normalizeSpinalLevel(meta.spinalLevel || null);
    var intent = meta.intent || null;
    var careLabel =
      typeof meta.careLabel === "string" && meta.careLabel.trim()
        ? meta.careLabel.trim()
        : typeof measurement.label === "string"
          ? measurement.label
          : "";

    // Compose label for ERP discLevelFromLabel when canal + level set.
    if (intent === INTENTS.CANAL_AP && spinalLevel && careLabel.indexOf(spinalLevel) === -1) {
      careLabel = (careLabel ? careLabel + " " : "Spinal Canal AP ") + spinalLevel;
    }

    var uid =
      (measurement && (measurement.uid || measurement.SOPInstanceUID)) ||
      meta.measurementId ||
      null;

    return {
      id: uid != null ? String(uid) : null,
      toolType: toolType,
      label: careLabel || null,
      intent: intent,
      spinalLevel: spinalLevel,
      values: extracted.values,
      unit: extracted.unit,
      context: {
        studyInstanceUID:
          (measurement && (measurement.referenceStudyUID || measurement.StudyInstanceUID)) || null,
        seriesInstanceUID:
          (measurement && (measurement.referenceSeriesUID || measurement.SeriesInstanceUID)) ||
          null,
        sopInstanceUID: (measurement && measurement.SOPInstanceUID) || null,
        frameNumber: isFiniteNumber(measurement && measurement.frameNumber)
          ? measurement.frameNumber
          : null,
      },
    };
  }

  function buildCareEvent(eventName, measurement, meta) {
    var m = buildStructuredMeasurement(measurement, meta);
    return {
      type: eventName,
      schemaVersion: SCHEMA_VERSION,
      measurement: m,
    };
  }

  /**
   * ERP ohifViewerBridge.ts compatible payload (source: care-ohif).
   * patientId/studyId intentionally omitted — ERP binds from session.
   */
  function buildErpLegacyMeasurement(measurement, meta) {
    var m = buildStructuredMeasurement(measurement, meta);
    var extracted = extractValues(measurement || {});
    var primary = primaryDisplayValue(extracted);
    return {
      source: "care-ohif",
      type: "measurement",
      studyInstanceUID: m.context.studyInstanceUID || "",
      seriesInstanceUID: m.context.seriesInstanceUID || undefined,
      sopInstanceUID: m.context.sopInstanceUID || undefined,
      frameNumber: m.context.frameNumber != null ? m.context.frameNumber : undefined,
      label: m.label || undefined,
      value: primary != null ? primary : "",
      unit: m.unit || "mm",
      measurementType: m.toolType || undefined,
      annotationId: m.id || undefined,
      intent: m.intent || undefined,
    };
  }

  function buildErpLegacyDeleted(measurementId, studyInstanceUID) {
    return {
      source: "care-ohif",
      type: "measurement-deleted",
      annotationId: String(measurementId || ""),
      studyInstanceUID: studyInstanceUID || undefined,
    };
  }

  function buildCareRemoved(measurementId) {
    return {
      type: "care.viewer.measurementRemoved",
      schemaVersion: SCHEMA_VERSION,
      measurementId: measurementId != null ? String(measurementId) : null,
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    INTENTS: INTENTS,
    CERVICAL_LEVELS: CERVICAL_LEVELS,
    LUMBAR_LEVELS: LUMBAR_LEVELS,
    SPINE_LABELS: SPINE_LABELS,
    BRAIN_LABELS: BRAIN_LABELS,
    GENERAL_LABELS: GENERAL_LABELS,
    normalizeSpinalLevel: normalizeSpinalLevel,
    extractValues: extractValues,
    buildStructuredMeasurement: buildStructuredMeasurement,
    buildCareEvent: buildCareEvent,
    buildErpLegacyMeasurement: buildErpLegacyMeasurement,
    buildErpLegacyDeleted: buildErpLegacyDeleted,
    buildCareRemoved: buildCareRemoved,
    primaryDisplayValue: primaryDisplayValue,
  };
});
