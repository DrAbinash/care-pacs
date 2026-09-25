/**
 * P2A measurement adapter tests.
 * Run: node --test ohif/enterprise/tests/care-measurement-adapter.test.cjs
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const ADAPTER = require("../care-customization/measurement/care-measurement-adapter.js");
const SEC = require("../care-customization/care-security.js");

function lengthMeasurement(overrides) {
  return Object.assign(
    {
      uid: "ann-length-1",
      toolName: "Length",
      type: "value_type::polyline",
      label: "",
      referenceStudyUID: "1.2.840.study",
      referenceSeriesUID: "1.2.840.series",
      SOPInstanceUID: "1.2.840.sop",
      frameNumber: 3,
      data: {
        "imageId:1": { length: 12.345, unit: "mm" },
      },
    },
    overrides || {}
  );
}

function biMeasurement(overrides) {
  return Object.assign(
    {
      uid: "ann-bi-1",
      toolName: "Bidirectional",
      type: "value_type::shortAxisLongAxis",
      label: "Lesion",
      referenceStudyUID: "1.2.840.study",
      referenceSeriesUID: "1.2.840.series",
      SOPInstanceUID: "1.2.840.sop",
      frameNumber: 1,
      data: {
        "imageId:1": { length: 21.7, width: 18.4, unit: "mm" },
      },
    },
    overrides || {}
  );
}

describe("normalizeSpinalLevel", () => {
  it("normalizes C2-3 and L4/5", () => {
    assert.equal(ADAPTER.normalizeSpinalLevel("C2-3"), "C2-C3");
    assert.equal(ADAPTER.normalizeSpinalLevel("L4/5"), "L4-L5");
    assert.equal(ADAPTER.normalizeSpinalLevel("L5-S1"), "L5-S1");
  });
  it("returns null for garbage (no guessing)", () => {
    assert.equal(ADAPTER.normalizeSpinalLevel("somewhere"), null);
    assert.equal(ADAPTER.normalizeSpinalLevel(""), null);
    assert.equal(ADAPTER.normalizeSpinalLevel(null), null);
  });
});

describe("Length measurement", () => {
  it("maps lengthMm from cachedStats", () => {
    const m = ADAPTER.buildStructuredMeasurement(lengthMeasurement());
    assert.equal(m.values.lengthMm, 12.35);
    assert.equal(m.unit, "mm");
    assert.equal(m.toolType, "Length");
    assert.equal(m.context.frameNumber, 3);
  });
  it("allows null SOP / frame", () => {
    const m = ADAPTER.buildStructuredMeasurement(
      lengthMeasurement({ SOPInstanceUID: null, frameNumber: null, data: { x: { length: 7.8, unit: "mm" } } })
    );
    assert.equal(m.context.sopInstanceUID, null);
    assert.equal(m.context.frameNumber, null);
    assert.equal(m.values.lengthMm, 7.8);
  });
  it("handles missing values without inventing", () => {
    const m = ADAPTER.buildStructuredMeasurement(
      lengthMeasurement({ data: {} })
    );
    assert.equal(m.values.lengthMm, undefined);
  });
});

describe("Bidirectional measurement", () => {
  it("maps long/short axes", () => {
    const m = ADAPTER.buildStructuredMeasurement(biMeasurement());
    assert.equal(m.values.longAxisMm, 21.7);
    assert.equal(m.values.shortAxisMm, 18.4);
    assert.equal(m.toolType, "Bidirectional");
  });
});

describe("spine canal workflow", () => {
  it("attaches intent + level into CARE + ERP payloads", () => {
    const src = lengthMeasurement();
    const care = ADAPTER.buildCareEvent("care.viewer.measurementAdded", src, {
      intent: ADAPTER.INTENTS.CANAL_AP,
      spinalLevel: "C4-5",
      careLabel: "Spinal Canal AP",
    });
    assert.equal(care.type, "care.viewer.measurementAdded");
    assert.equal(care.measurement.spinalLevel, "C4-C5");
    assert.equal(care.measurement.intent, "CANAL_AP");
    assert.match(care.measurement.label, /C4-C5/);
    SEC.assertNoPhiKeys(care);
    SEC.assertNoPhiKeys(care.measurement);

    const erp = ADAPTER.buildErpLegacyMeasurement(src, {
      intent: ADAPTER.INTENTS.CANAL_AP,
      spinalLevel: "L4-5",
      careLabel: "Spinal Canal AP",
    });
    assert.equal(erp.source, "care-ohif");
    assert.equal(erp.type, "measurement");
    assert.equal(erp.intent, "CANAL_AP");
    assert.equal(erp.annotationId, "ann-length-1");
    assert.equal(erp.value, 12.35);
    SEC.assertNoPhiKeys(erp);
  });
});

describe("brain lesion label", () => {
  it("keeps optional label without diagnosing", () => {
    const care = ADAPTER.buildCareEvent("care.viewer.measurementUpdated", biMeasurement(), {
      intent: ADAPTER.INTENTS.LESION,
      careLabel: "Lesion",
    });
    assert.equal(care.measurement.label, "Lesion");
    assert.equal(care.measurement.intent, "LESION");
    assert.equal(care.measurement.values.longAxisMm, 21.7);
  });
});

describe("remove lifecycle", () => {
  it("builds care + erp delete payloads", () => {
    const care = ADAPTER.buildCareRemoved("ann-1");
    assert.equal(care.type, "care.viewer.measurementRemoved");
    assert.equal(care.measurementId, "ann-1");
    const erp = ADAPTER.buildErpLegacyDeleted("ann-1", "1.2.3");
    assert.equal(erp.type, "measurement-deleted");
    assert.equal(erp.annotationId, "ann-1");
  });
});

describe("PHI guard", () => {
  it("throws when PHI sneaks into payload", () => {
    assert.throws(() => SEC.assertNoPhiKeys({ patientName: "x" }), /PHI/);
    assert.throws(
      () => SEC.assertNoPhiKeys({ measurement: { PatientID: "1" } }),
      /PHI/
    );
  });
});
