/**
 * Static validation for CARE OHIF foundation files.
 * Run: node ohif/enterprise/tests/static-validate.cjs
 *
 * Enforces the frozen OHIF pin, Bookworm builder, CARE branding, relative
 * DICOMweb paths, and investigational-use dialog disabled.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const enterprise = path.join(__dirname, "..");
const root = path.join(__dirname, "..", "..", "..");
const PIN = "0b6e9cba7613dba1df883985d3c821a86b3ba0ff";
const OHIF_REF = "v3.10.0";
const LOGO = path.join(
  enterprise,
  "care-customization",
  "assets",
  "care-diagnostics-logo.png"
);

function checkJs(file) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(r.status, 0, `${file}: ${r.stderr}`);
}

const jsFiles = [
  "app-config.js",
  "care-customization/care-security.js",
  "care-customization/care-bridge.js",
  "care-customization/care-chrome.js",
  "care-customization/care-config.js",
  "care-customization/care-config.runtime.js",
].map((f) => path.join(enterprise, f));

for (const f of jsFiles) {
  assert.ok(fs.existsSync(f), `missing ${f}`);
  checkJs(f);
}

// Official CARE logo (must exist; inject copies assets/ into dist).
assert.ok(fs.existsSync(LOGO), "missing CARE logo asset care-diagnostics-logo.png");
assert.ok(fs.statSync(LOGO).size > 1000, "CARE logo asset unexpectedly tiny");

const appConfig = fs.readFileSync(path.join(enterprise, "app-config.js"), "utf8");
assert.match(appConfig, /CARE Diagnostics Viewer/);
assert.match(appConfig, /window\.config\s*=/);
assert.match(appConfig, /qidoRoot:\s*['\"]\/dicom-web['\"]/);
assert.match(appConfig, /wadoRoot:\s*['\"]\/dicom-web['\"]/);
assert.match(appConfig, /wadoUriRoot:\s*['\"]\/wado['\"]/);
assert.doesNotMatch(appConfig, /100\.65\.255\.115/);
assert.doesNotMatch(appConfig, /qidoRoot:\s*['\"]https?:\/\//);
assert.match(appConfig, /whiteLabeling/);
assert.match(appConfig, /createLogoComponentFn/);
assert.match(appConfig, /care-diagnostics-logo\.png/);
assert.match(appConfig, /erpOriginAllowlist/);
assert.match(appConfig, /erpOriginAllowlist:\s*\[\s*\]/);
assert.match(appConfig, /returnUrlAllowlist:\s*\[\s*\]/);
assert.match(appConfig, /dicomUploadEnabled:\s*false/);
// Clinical deployment: investigational-use dialog must stay disabled.
assert.match(appConfig, /investigationalUseDialog\s*:\s*\{[\s\S]*option\s*:\s*['\"]never['\"]/);
assert.doesNotMatch(appConfig, /strictZSpacingForVolumeViewport/);

const dockerfile = fs.readFileSync(path.join(enterprise, "Dockerfile"), "utf8");
assert.match(dockerfile, /FROM node:18-bookworm AS builder/);
assert.doesNotMatch(dockerfile, /node:18-bullseye/);
assert.match(dockerfile, new RegExp(`OHIF_REF=${OHIF_REF}`));
assert.match(dockerfile, new RegExp(`OHIF_COMMIT=${PIN}`));
assert.match(dockerfile, /git fetch --depth 1 origin/);
assert.match(dockerfile, /inject-care-customization\.sh/);
assert.match(dockerfile, /HEALTHCHECK/);
assert.match(dockerfile, /COPY default\.conf/);
assert.match(dockerfile, /care-diagnostics-logo\.png/);
// Pin must appear as the ARG default — no second divergent commit SHA.
const commitMatches = dockerfile.match(/OHIF_COMMIT=([0-9a-f]{40})/g) || [];
assert.ok(commitMatches.length >= 1, "Dockerfile must declare OHIF_COMMIT pin");
for (const m of commitMatches) {
  assert.equal(m, `OHIF_COMMIT=${PIN}`, `unexpected OHIF_COMMIT value: ${m}`);
}

const nginx = fs.readFileSync(path.join(enterprise, "default.conf"), "utf8");
assert.match(nginx, /location = \/healthz/);
assert.match(nginx, /location \/dicom-web/);
assert.match(nginx, /location \/wado/);
assert.match(nginx, /location \/care\//);
assert.match(nginx, /set \$orthanc_upstream orthanc:8042;/);
assert.match(nginx, /proxy_pass http:\/\/\$orthanc_upstream;/);
assert.match(nginx, /Host orthanc:8042/);
assert.match(nginx, /resolver 127\.0\.0\.11/);
// Variable upstream is URI-less (no path after host) — path+query preserved.
assert.doesNotMatch(nginx, /proxy_pass http:\/\/\$orthanc_upstream\//);
assert.doesNotMatch(nginx, /proxy_pass http:\/\/orthanc:8042\//);

const runtimeCfg = fs.readFileSync(
  path.join(enterprise, "care-customization", "care-config.runtime.js"),
  "utf8"
);
assert.match(runtimeCfg, /window\.config\.care/);
assert.match(runtimeCfg, /erpOriginAllowlist/);

const compose = path.join(root, "docker-compose.yml");
const dc = spawnSync("docker", ["compose", "-f", compose, "config"], {
  encoding: "utf8",
  cwd: root,
});
if (dc.status !== 0) {
  console.warn("WARN: docker compose config failed:");
  console.warn(dc.stderr || dc.stdout);
} else {
  assert.match(dc.stdout, /care-ohif/);
  assert.match(dc.stdout, new RegExp(PIN));
  assert.match(dc.stdout, /OHIF_REF/);
  assert.match(dc.stdout, /care-config\.js/);
  console.log("docker compose config: OK");
}

console.log("static-validate: OK (" + jsFiles.length + " JS files checked, logo present, pin frozen)");
