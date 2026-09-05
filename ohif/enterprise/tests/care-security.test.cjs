/**
 * CARE OHIF customisation — unit tests (Node, no browser).
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

describe("CARE_SECURITY.origin allowlist", () => {
  it("accepts matching https origins", () => {
    assert.equal(
      SEC.isOriginAllowlisted("https://erp.example", ["https://erp.example"]),
      true
    );
  });

  it("rejects non-allowlisted origins", () => {
    assert.equal(
      SEC.isOriginAllowlisted("https://evil.example", ["https://erp.example"]),
      false
    );
  });

  it("rejects empty allowlist", () => {
    assert.equal(SEC.isOriginAllowlisted("https://erp.example", []), false);
  });

  it("normalizes origin (strips path)", () => {
    assert.equal(
      SEC.isOriginAllowlisted("https://erp.example", ["https://erp.example/app"]),
      true
    );
  });
});

describe("CARE_SECURITY.resolveSafeReturnUrl", () => {
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

  it("rejects open redirect via protocol-relative URL", () => {
    assert.equal(SEC.resolveSafeReturnUrl("//evil.example/phish", allow, pageOrigin), null);
  });

  it("rejects javascript: URL", () => {
    assert.equal(SEC.resolveSafeReturnUrl("javascript:alert(1)", allow, pageOrigin), null);
  });

  it("rejects non-allowlisted absolute URL", () => {
    assert.equal(SEC.resolveSafeReturnUrl("https://evil.example/", allow, pageOrigin), null);
  });

  it("returns null when candidate missing", () => {
    assert.equal(SEC.resolveSafeReturnUrl("", allow, pageOrigin), null);
    assert.equal(SEC.resolveSafeReturnUrl(null, allow, pageOrigin), null);
  });
});

describe("CARE_SECURITY.buildContextPayload", () => {
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
    assert.match(html, /CARE_CUSTOMIZATION_BEGIN/);
    assert.ok(fs.existsSync(path.join(dist, "care", "care-bridge.js")));
  });
});

describe("record-build-metadata.sh", () => {
  it("writes build-info.json and build-info.js without secrets", () => {
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
