/**
 * CARE hanging protocol definitions (OHIF v3.10 HangingProtocolService shape).
 * CommonJS for Node tests; also loaded by care-hanging-protocols.runtime.js.
 */
"use strict";

var h = require("./helpers.cjs");

function grid2x2(ids) {
  return {
    viewportStructure: {
      layoutType: "grid",
      properties: { rows: 2, columns: 2 },
    },
    viewports: ids.map(function (id) {
      return h.stackViewport(id);
    }),
  };
}

function grid2x1(ids) {
  return {
    viewportStructure: {
      layoutType: "grid",
      properties: { rows: 1, columns: 2 },
    },
    viewports: ids.map(function (id) {
      return h.stackViewport(id);
    }),
  };
}

function grid1x1(id) {
  return {
    viewportStructure: {
      layoutType: "grid",
      properties: { rows: 1, columns: 1 },
    },
    viewports: [h.stackViewport(id)],
  };
}

var mriBrain = {
  id: "care.mriBrain",
  name: "CARE MRI Brain",
  protocolMatchingRules: [
    h.studyModalityContains("MR", 120),
    h.studyDescriptionContains("BRAIN", 80, false),
    h.studyDescriptionContains("HEAD", 50, false),
    h.studyDescriptionContains("NEURO", 40, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.selector("t2", ["T2", "t2_"]),
    h.selector("flair", ["FLAIR", "Flair", "T2FLAIR"]),
    h.selector("dwi", ["DWI", "DIFF", "Diffusion"]),
    h.selector("adc", ["ADC", "Apparent Diffusion"]),
    h.selector("swi", ["SWI", "SWAN", "VenBold", "T2*", "GRE"]),
    h.selector("t1", ["T1", "t1_"]),
    h.selector("t1c", ["T1C", "T1+C", "POST", "GD", "Gad", "Contrast"])
  ),
  defaultViewport: h.stackViewport("t2"),
  stages: [
    {
      id: "care-mri-brain-2x2",
      name: "T2/FLAIR/DWI/ADC",
      stageActivation: {
        enabled: { minViewportsMatched: 1 },
      },
      ...grid2x2(["t2", "flair", "dwi", "adc"]),
    },
  ],
};

var mriCervicalSpine = {
  id: "care.mriCervicalSpine",
  name: "CARE MRI Cervical Spine",
  protocolMatchingRules: [
    h.studyModalityContains("MR", 120),
    h.studyDescriptionContains("CERVICAL", 90, false),
    h.studyDescriptionContains("C-SPINE", 90, false),
    h.studyDescriptionContains("CSPINE", 80, false),
    h.studyDescriptionContains("C SPINE", 80, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.selector("sagT1", ["SAG T1", "SAGITTAL T1", "T1 SAG"]),
    h.selector("sagT2", ["SAG T2", "SAGITTAL T2", "T2 SAG"]),
    h.selector("stir", ["STIR", "T2 STIR", "T2FS", "T2 FAT"]),
    h.selector("axT2", ["AX T2", "AXIAL T2", "T2 AX"])
  ),
  defaultViewport: h.stackViewport("sagT2"),
  stages: [
    {
      id: "care-mri-cspine-2x2",
      name: "Sag T1/T2 / STIR / Ax T2",
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      ...grid2x2(["sagT1", "sagT2", "stir", "axT2"]),
    },
  ],
};

var mriLumbarSpine = {
  id: "care.mriLumbarSpine",
  name: "CARE MRI Lumbar Spine",
  protocolMatchingRules: [
    h.studyModalityContains("MR", 120),
    h.studyDescriptionContains("LUMBAR", 90, false),
    h.studyDescriptionContains("L-SPINE", 90, false),
    h.studyDescriptionContains("LSPINE", 80, false),
    h.studyDescriptionContains("L SPINE", 80, false),
    h.studyDescriptionContains("LUMBOSACRAL", 70, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.selector("sagT1", ["SAG T1", "SAGITTAL T1", "T1 SAG"]),
    h.selector("sagT2", ["SAG T2", "SAGITTAL T2", "T2 SAG"]),
    h.selector("stir", ["STIR", "T2 STIR", "T2FS", "T2 FAT"]),
    h.selector("axT2", ["AX T2", "AXIAL T2", "T2 AX"])
  ),
  defaultViewport: h.stackViewport("sagT2"),
  stages: [
    {
      id: "care-mri-lspine-2x2",
      name: "Sag T1/T2 / STIR / Ax T2",
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      ...grid2x2(["sagT1", "sagT2", "stir", "axT2"]),
    },
  ],
};

var ctBrain = {
  id: "care.ctBrain",
  name: "CARE CT Brain",
  protocolMatchingRules: [
    h.studyModalityContains("CT", 120),
    h.studyDescriptionContains("BRAIN", 80, false),
    h.studyDescriptionContains("HEAD", 60, false),
    h.studyDescriptionContains("SKULL", 40, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.ctSelector("axial", ["AX", "Axial", "BRAIN", "HEAD"]),
    h.ctSelector("bone", ["BONE", "BONEALG", "KERNEL"])
  ),
  defaultViewport: h.stackViewport("axial"),
  stages: [
    {
      id: "care-ct-brain-1x1",
      name: "CT Brain axial",
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      ...grid1x1("axial"),
    },
  ],
};

var ctChest = {
  id: "care.ctChest",
  name: "CARE CT Chest",
  protocolMatchingRules: [
    h.studyModalityContains("CT", 120),
    h.studyDescriptionContains("CHEST", 90, false),
    h.studyDescriptionContains("THORAX", 80, false),
    h.studyDescriptionContains("LUNG", 50, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.ctSelector("axial", ["AX", "Axial", "CHEST", "THORAX", "LUNG"])
  ),
  defaultViewport: h.stackViewport("axial"),
  stages: [
    {
      id: "care-ct-chest-1x1",
      name: "CT Chest axial",
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      ...grid1x1("axial"),
    },
  ],
};

var ctAbdomen = {
  id: "care.ctAbdomen",
  name: "CARE CT Abdomen",
  protocolMatchingRules: [
    h.studyModalityContains("CT", 120),
    h.studyDescriptionContains("ABDOMEN", 90, false),
    h.studyDescriptionContains("ABDO", 70, false),
    h.studyDescriptionContains("PELVIS", 40, false),
  ],
  toolGroupIds: ["default"],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: h.mergeSelectors(
    h.ctSelector("axial", ["AX", "Axial", "ABDOMEN", "ABDO", "PORTAL", "VENOUS"])
  ),
  defaultViewport: h.stackViewport("axial"),
  stages: [
    {
      id: "care-ct-abdomen-1x1",
      name: "CT Abdomen axial",
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      ...grid1x1("axial"),
    },
  ],
};

/** Ranked list for modesConfiguration (fallback default last). */
var ACTIVE_PROTOCOL_IDS = [
  "care.mriBrain",
  "care.mriCervicalSpine",
  "care.mriLumbarSpine",
  "care.ctBrain",
  "care.ctChest",
  "care.ctAbdomen",
  "default",
];

var ALL = [mriBrain, mriCervicalSpine, mriLumbarSpine, ctBrain, ctChest, ctAbdomen];

/**
 * Conservative protocol engine simulator for unit tests —
 * mirrors OHIF idea: required rules must pass; highest weight wins;
 * no required match → fall back (null).
 */
function scoreProtocol(protocol, studyMeta) {
  var rules = protocol.protocolMatchingRules || [];
  var score = 0;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var attr = rule.attribute;
    var actual = studyMeta[attr];
    var ok = false;
    if (rule.constraint && rule.constraint.contains != null) {
      var needle =
        typeof rule.constraint.contains === "object"
          ? rule.constraint.contains.value
          : rule.constraint.contains;
      if (Array.isArray(actual)) {
        ok = actual.indexOf(needle) !== -1;
      } else if (typeof actual === "string") {
        ok = actual.toUpperCase().indexOf(String(needle).toUpperCase()) !== -1;
      }
    }
    if (rule.constraint && rule.constraint.equals) {
      var eq =
        typeof rule.constraint.equals === "object"
          ? rule.constraint.equals.value
          : rule.constraint.equals;
      ok = actual === eq;
    }
    if (!ok) {
      if (rule.required) return { id: protocol.id, score: -1, failed: true };
      continue;
    }
    score += rule.weight || 1;
  }
  return { id: protocol.id, score: score, failed: false };
}

function selectProtocol(studyMeta, protocols) {
  var list = protocols || ALL;
  var best = null;
  for (var i = 0; i < list.length; i++) {
    var r = scoreProtocol(list[i], studyMeta);
    if (r.failed || r.score < 0) continue;
    // Require some anatomy signal beyond modality alone for CARE protocols.
    if (r.score <= 120) continue;
    if (!best || r.score > best.score) best = r;
  }
  return best ? best.id : "default";
}

module.exports = {
  mriBrain: mriBrain,
  mriCervicalSpine: mriCervicalSpine,
  mriLumbarSpine: mriLumbarSpine,
  ctBrain: ctBrain,
  ctChest: ctChest,
  ctAbdomen: ctAbdomen,
  ALL: ALL,
  ACTIVE_PROTOCOL_IDS: ACTIVE_PROTOCOL_IDS,
  scoreProtocol: scoreProtocol,
  selectProtocol: selectProtocol,
};
