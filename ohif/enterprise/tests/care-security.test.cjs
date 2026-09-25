/**
 * CARE security unit tests (Node).
 * Run: node --test ohif/enterprise/tests/care-security.test.cjs
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const SEC = require("../care-customization/care-security.js");
const PIN = "0b6e9cba7613dba1df883985d3c821a86b3ba0ff";

describe("origin allowlist", () => {
  it("accepts matching https origins", () => {
    assert.equal(SEC.isOriginAllowlisted("https://erp.example", ["https://erp.example"]), true);
  });
  it("rejects non-allowlisted origins", () => {
    assert.equal(SEC.isOriginAllowlisted("https://evil.example", ["https://erp.example"]), false);
  });
  it("rejects empty allowlist (fail closed)", () => {
    assert.equal(SEC.isOriginAllowlisted("https://erp.example", []), false);
  });
  it("normalizes origin (strips path)", () => {
    assert.equal(
      SEC.isOriginAllowlisted("https://erp.example", ["https://erp.example/app"]),
      true
    );
  });
});

describe("trusted message source", () => {
  it("accepts parent frame", () => {
    const parent = {};
    const viewer = { parent, opener: null };
    assert.equal(SEC.isTrustedMessageSource({ source: parent }, viewer), true);
  });
  it("accepts opener", () => {
    const opener = {};
    const viewer = { parent: {}, opener };
    viewer.parent = viewer; // top-level with opener
    assert.equal(SEC.isTrustedMessageSource({ source: opener }, viewer), true);
  });
  it("rejects sibling / unrelated source", () => {
    const parent = {};
    const sibling = {};
    const viewer = { parent, opener: null };
    assert.equal(SEC.isTrustedMessageSource({ source: sibling }, viewer), false);
  });
  it("rejects missing source", () => {
    assert.equal(SEC.isTrustedMessageSource({}, { parent: {}, opener: null }), false);
  });
});

describe("safe return URL", () => {
  const allow = ["https://erp.example"];
  const pageOrigin = "http://nas.local:3010";

  it("allows absolute allowlisted https URL", () => {
    assert.equal(
      SEC.resolveSafeReturnUrl("https://erp.example/radiology", allow, pageOrigin),
      "https://erp.example/radiology"
    );
  });
  it("allows same-origin relative path", () => {
    assert.equal(
      SEC.resolveSafeReturnUrl("/portal/home", allow, pageOrigin),
      "http://nas.local:3010/portal/home"
    );
  });
  it("rejects protocol-relative open redirect", () => {
    assert.equal(SEC.resolveSafeReturnUrl("//evil.example/phish", allow, pageOrigin), null);
  });
  it("rejects triple-slash and encoded authority tricks", () => {
    assert.equal(SEC.resolveSafeReturnUrl("///evil.example/phish", allow, pageOrigin), null);
    assert.equal(SEC.resolveSafeReturnUrl("/%2f%2fevil.example", allow, pageOrigin), null);
    assert.equal(SEC.resolveSafeReturnUrl("/%5c%5cevil.example", allow, pageOrigin), null);
  });
  it("rejects javascript: URL", () => {
    assert.equal(SEC.resolveSafeReturnUrl("javascript:alert(1)", allow, pageOrigin), null);
  });
  it("rejects encoded javascript: URL", () => {
    assert.equal(
      SEC.resolveSafeReturnUrl("javascript%3Aalert(1)", allow, pageOrigin),
      null
    );
  });
  it("rejects non-allowlisted absolute URL", () => {
    assert.equal(SEC.resolveSafeReturnUrl("https://evil.example/", allow, pageOrigin), null);
  });
  it("rejects userinfo URLs", () => {
    assert.equal(
      SEC.resolveSafeReturnUrl("https://user:pass@erp.example/", allow, pageOrigin),
      null
    );
  });
  it("rejects when allowlist empty (fail closed)", () => {
    assert.equal(
      SEC.resolveSafeReturnUrl("https://erp.example/radiology", [], pageOrigin),
      null
    );
  });
  it("returns null when candidate missing", () => {
    assert.equal(SEC.resolveSafeReturnUrl("", allow, pageOrigin), null);
    assert.equal(SEC.resolveSafeReturnUrl(null, allow, pageOrigin), null);
  });
});

describe("context payload", () => {
  it("includes only imaging identifiers (no PHI keys)", () => {
    const payload = SEC.buildContextPayload({
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "1.2.3.4",
      sopInstanceUID: "1.2.3.4.5",
      frameNumber: 2,
      viewerName: "CARE Diagnostics Viewer",
      hrefPath: "/viewer?StudyInstanceUIDs=1.2.3",
      patientName: "SHOULD_NOT_APPEAR",
    });
    assert.equal(payload.type, "care.viewer.context");
    assert.equal(payload.studyInstanceUID, "1.2.3");
    assert.equal(payload.frameNumber, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "patientName"), false);
    SEC.assertNoPhiKeys(payload);
  });
  it("assertNoPhiKeys throws when PHI sneaks in", () => {
    assert.throws(() => SEC.assertNoPhiKeys({ patientName: "x" }), /PHI/);
  });
  it("rejects accessionNumber key", () => {
    assert.throws(() => SEC.assertNoPhiKeys({ accessionNumber: "A1" }), /PHI/);
  });
});

describe("inject-care-customization.sh", () => {
  it("injects CARE scripts into a fake index.html", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "care-ohif-"));
    const dist = path.join(root, "dist");
    const care = path.join(__dirname, "..", "care-customization");
    fs.mkdirSync(dist);
    fs.writeFileSync(
      path.join(dist, "index.html"),
      "<!doctype html><html><body><div id=app></div></body></html>\n"
    );
    const script = path.join(__dirname, "..", "scripts", "inject-care-customization.sh");
    const r = spawnSync("sh", [script, dist, care], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    assert.match(html, /care\/care-security\.js/);
    assert.match(html, /care\/care-bridge\.js/);
    assert.match(html, /care\/care-measurement\.js/);
    assert.match(html, /care\/measurement\/care-measurement-adapter\.js/);
    assert.match(html, /CARE_CUSTOMIZATION_BEGIN/);
    assert.ok(fs.existsSync(path.join(dist, "care", "care-bridge.js")));
    assert.ok(fs.existsSync(path.join(dist, "care", "care-measurement.js")));
    assert.ok(
      fs.existsSync(path.join(dist, "care", "assets", "care-diagnostics-logo.png")),
      "inject must copy CARE logo into dist/care/assets/"
    );
  });
});

describe("record-build-metadata.sh", () => {
  it("writes build-info without secrets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "care-meta-"));
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    const script = path.join(__dirname, "..", "scripts", "record-build-metadata.sh");
    const r = spawnSync(
      "sh",
      [
        script,
        dist,
        "--care-version",
        "1.0.0-foundation",
        "--ohif-ref",
        "v3.10.0",
        "--ohif-commit",
        PIN,
      ],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const json = JSON.parse(fs.readFileSync(path.join(dist, "care", "build-info.json"), "utf8"));
    assert.equal(json.ohifCommit, PIN);
    assert.equal(json.productName, "CARE Diagnostics Viewer");
    const js = fs.readFileSync(path.join(dist, "care", "build-info.js"), "utf8");
    assert.match(js, /__CARE_BUILD_INFO__/);
    assert.doesNotMatch(js, /password|secret|DATABASE|TS_AUTHKEY/i);
  });
});

describe("care-chrome shortcuts panel", () => {
  it("exposes a Keys control without PHI keys", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "care-customization", "care-chrome.js"),
      "utf8"
    );
    assert.match(src, /care-chrome-shortcuts/);
    assert.match(src, /showShortcuts/);
    assert.doesNotMatch(src, /patientName|PatientID|accessionNumber/i);
  });
});

describe("care-config.runtime.js merge", () => {
  it("merges allowlists into window.config.care", () => {
    const vm = require("node:vm");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "care-customization", "care-config.runtime.js"),
      "utf8"
    );
    const sandbox = {
      window: {
        config: { care: { erpOriginAllowlist: [], returnUrlAllowlist: [] } },
        careConfig: {
          erpOriginAllowlist: ["https://erp.example"],
          returnUrlAllowlist: ["https://erp.example"],
          defaultReturnUrl: "https://erp.example/radiology",
        },
      },
    };
    vm.runInNewContext(src, sandbox);
    assert.deepEqual(sandbox.window.config.care.erpOriginAllowlist, ["https://erp.example"]);
    assert.equal(sandbox.window.config.care.defaultReturnUrl, "https://erp.example/radiology");
  });
});
