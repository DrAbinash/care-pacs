/**
 * Shared hanging-protocol matching helpers for CARE protocols.
 * SeriesDescription / ProtocolName / SequenceName heuristics only —
 * never patient identity. Unmatched series stay in the study browser.
 */

function seriesContains(words, weight, required) {
  var rules = [];
  for (var i = 0; i < words.length; i++) {
    rules.push({
      weight: weight || 10,
      attribute: "SeriesDescription",
      constraint: { contains: { value: words[i] } },
      required: !!required,
    });
  }
  return rules;
}

function orDescription(options) {
  // OHIF matcher ANDs rules in a selector; use one weighted contains per selector
  // and rely on multiple selectors. For a single selector with alternatives,
  // prefer the highest-weight single token (callers pass primary token).
  return {
    weight: options.weight || 12,
    attribute: "SeriesDescription",
    constraint: { contains: { value: options.token } },
    required: !!options.required,
  };
}

function modalityRule(mod, weight) {
  return {
    weight: weight || 50,
    attribute: "Modality",
    constraint: { equals: { value: mod } },
    required: true,
  };
}

function imagesRequired() {
  return {
    weight: 5,
    attribute: "numImageFrames",
    constraint: { greaterThan: { value: 0 } },
    required: true,
  };
}

function studyModalityContains(mod, weight) {
  return {
    id: "modality-" + mod,
    weight: weight || 100,
    attribute: "ModalitiesInStudy",
    constraint: { contains: mod },
    required: true,
  };
}

function studyDescriptionContains(token, weight, required) {
  return {
    id: "desc-" + token,
    weight: weight || 40,
    attribute: "StudyDescription",
    constraint: { contains: { value: token } },
    required: !!required,
  };
}

function stackViewport(displaySetId) {
  return {
    viewportOptions: {
      viewportType: "stack",
      toolGroupId: "default",
      allowUnmatchedView: true,
    },
    displaySets: [{ id: displaySetId }],
  };
}

function selector(id, tokens) {
  var rules = [imagesRequired(), modalityRule("MR")];
  for (var i = 0; i < tokens.length; i++) {
    rules.push(orDescription({ token: tokens[i], weight: 15 - i, required: false }));
  }
  return {
    [id]: {
      allowUnmatchedView: true,
      seriesMatchingRules: rules,
    },
  };
}

function ctSelector(id, tokens) {
  var rules = [imagesRequired(), modalityRule("CT")];
  for (var i = 0; i < tokens.length; i++) {
    rules.push(orDescription({ token: tokens[i], weight: 14 - i, required: false }));
  }
  // Prefer axial-ish naming when present, but never require it.
  rules.push(orDescription({ token: "AX", weight: 4, required: false }));
  rules.push(orDescription({ token: "Axial", weight: 4, required: false }));
  return {
    [id]: {
      allowUnmatchedView: true,
      seriesMatchingRules: rules,
    },
  };
}

function mergeSelectors() {
  var out = {};
  for (var a = 0; a < arguments.length; a++) {
    var obj = arguments[a];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = obj[keys[i]];
  }
  return out;
}

module.exports = {
  seriesContains: seriesContains,
  orDescription: orDescription,
  modalityRule: modalityRule,
  imagesRequired: imagesRequired,
  studyModalityContains: studyModalityContains,
  studyDescriptionContains: studyDescriptionContains,
  stackViewport: stackViewport,
  selector: selector,
  ctSelector: ctSelector,
  mergeSelectors: mergeSelectors,
};
