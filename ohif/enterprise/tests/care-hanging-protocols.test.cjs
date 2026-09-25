/**
 * P2B hanging protocol selection tests (conservative matcher).
 * Run: node --test ohif/enterprise/tests/care-hanging-protocols.test.cjs
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const HP = require("../care-customization/hanging-protocols/protocols.cjs");

describe("CARE hanging protocol ranking", () => {
  it("selects MRI brain when anatomy signal present", () => {
    assert.equal(
      HP.selectProtocol({
        ModalitiesInStudy: ["MR"],
        StudyDescription: "MRI BRAIN WITH CONTRAST",
      }),
      "care.mriBrain"
    );
  });

  it("selects cervical spine", () => {
    assert.equal(
      HP.selectProtocol({
        ModalitiesInStudy: ["MR"],
        StudyDescription: "MRI CERVICAL SPINE",
      }),
      "care.mriCervicalSpine"
    );
  });

  it("selects lumbar spine", () => {
    assert.equal(
      HP.selectProtocol({
        ModalitiesInStudy: ["MR"],
        StudyDescription: "MRI LUMBOSACRAL SPINE",
      }),
      "care.mriLumbarSpine"
    );
  });

  it("selects CT brain / chest / abdomen", () => {
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["CT"], StudyDescription: "CT BRAIN PLAIN" }),
      "care.ctBrain"
    );
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["CT"], StudyDescription: "CT CHEST" }),
      "care.ctChest"
    );
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["CT"], StudyDescription: "CT ABDOMEN PELVIS" }),
      "care.ctAbdomen"
    );
  });

  it("falls back to default when only modality matches (ambiguous)", () => {
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["MR"], StudyDescription: "MRI STUDY" }),
      "default"
    );
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["CT"], StudyDescription: "" }),
      "default"
    );
  });

  it("falls back for CR/DX (no CARE complex HP)", () => {
    assert.equal(
      HP.selectProtocol({ ModalitiesInStudy: ["CR"], StudyDescription: "CHEST PA" }),
      "default"
    );
  });

  it("MRI brain selectors keep allowUnmatchedView", () => {
    const sels = HP.mriBrain.displaySetSelectors;
    Object.keys(sels).forEach((k) => {
      assert.equal(sels[k].allowUnmatchedView, true);
    });
  });

  it("ACTIVE_PROTOCOL_IDS ends with default fallback", () => {
    assert.equal(HP.ACTIVE_PROTOCOL_IDS[HP.ACTIVE_PROTOCOL_IDS.length - 1], "default");
    assert.ok(HP.ACTIVE_PROTOCOL_IDS.includes("care.mriBrain"));
  });
});
