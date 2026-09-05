/**
 * Static validation for CARE OHIF foundation files.
 * Run: node ohif/enterprise/tests/static-validate.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const enterprise = path.join(__dirname, "..");
const root = path.join(__dirname, "..", "..", "..");
const PIN = "0b6e9cba7613dba1df883985d3c821a86b3ba0ff";

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

const appConfig = fs.readFileSync(path.join(enterprise, "app-config.js"), "utf8");
assert.match(appConfig, /CARE Diagnostics Viewer/);
assert.match(appConfig, /window\.config\s*=/);
assert.match(appConfig, /qidoRoot:\s*['\"]\/dicom-web['\"]/);
assert.match(appConfig, /wadoUriRoot:\s*['\"]\/wado['\"]/);
assert.doesNotMatch(appConfig, /100\.65\.255\.115/);
assert.match(appConfig, /whiteLabeling/);
assert.match(appConfig, /createLogoComponentFn/);
assert.match(appConfig, /erpOriginAllowlist/);
assert.match(appConfig, /dicomUploadEnabled:\s*false/);
assert.doesNotMatch(appConfig, /investigationalUseDialog/);
assert.doesNotMatch(appConfig, /strictZSpacingForVolumeViewport/);

const dockerfile = fs.readFileSync(path.join(enterprise, "Dockerfile"), "utf8");
assert.match(dockerfile, new RegExp(`OHIF_COMMIT=${PIN}`));
assert.match(dockerfile, /git fetch --depth 1 origin/);
assert.match(dockerfile, /inject-care-customization\.sh/);
assert.match(dockerfile, /HEALTHCHECK/);
assert.match(dockerfile, /COPY default\.conf/);

const nginx = fs.readFileSync(path.join(enterprise, "default.conf"), "utf8");
assert.match(nginx, /location = \/healthz/);
assert.match(nginx, /location \/dicom-web/);
assert.match(nginx, /proxy_pass http:\/\/orthanc:8042;/);
assert.match(nginx, /Host orthanc:8042/);
assert.doesNotMatch(nginx, /proxy_pass http:\/\/\$/);
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
  assert.match(dc.stdout, /care-config\.js/);
  console.log("docker compose config: OK");
}

console.log("static-validate: OK (" + jsFiles.length + " JS files checked)");
