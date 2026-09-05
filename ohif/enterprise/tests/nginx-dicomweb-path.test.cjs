#!/usr/bin/env node
/**
 * Verify nginx DICOMweb/WADO path preservation against a mock Orthanc upstream.
 * Requires Docker. Fails if upstream is never hit (502/504 alone is NOT success).
 *
 * Mock Orthanc is a Python HTTP server on the host (Node http.Server is not
 * reachable from curl/containers in this agent environment). Nginx reaches it
 * via host.docker.internal. Request clients use curl against nginx (C server).
 *
 * Run: node ohif/enterprise/tests/nginx-dicomweb-path.test.cjs
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const ENTERPRISE = path.join(__dirname, "..");
const CONF_SRC = fs.readFileSync(path.join(ENTERPRISE, "default.conf"), "utf8");
const NGX = "care-nginx-path-test";

function sh(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function curlRaw(url, extraArgs = []) {
  const r = sh("curl", [
    "-sS",
    "--max-time",
    "10",
    "-D",
    "-",
    ...extraArgs,
    url,
  ]);
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

(async () => {
  assert.match(CONF_SRC, /proxy_pass http:\/\/orthanc:8042;/);
  assert.doesNotMatch(CONF_SRC, /proxy_pass http:\/\/\$/);
  assert.doesNotMatch(CONF_SRC, /proxy_pass http:\/\/orthanc:8042\//);

  const upstreamPort = await freePort();
  const httpPort = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "care-nginx-"));
  const receivedPath = path.join(tmp, "received.jsonl");
  fs.writeFileSync(receivedPath, "");

  const mockPy = path.join(tmp, "mock_orthanc.py");
  fs.writeFileSync(
    mockPy,
    `
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
LOG = sys.argv[2]

class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def _record(self):
        entry = {
            "method": self.command,
            "url": self.path,
            "host": self.headers.get("Host"),
            "range": self.headers.get("Range"),
        }
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\\n")
    def do_GET(self):
        self._record()
        if "/frames/" in self.path:
            b = "MockBoundary"
            body = f"--{b}\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\nFRAMEDATA\\r\\n--{b}--\\r\\n"
            self.send_response(200)
            self.send_header("Content-Type", f'multipart/related; type="application/octet-stream"; boundary={b}')
            self.end_headers()
            self.wfile.write(body.encode())
            return
        if "/metadata" in self.path:
            body = json.dumps([{"00080018": {"Value": ["1.2.3"]}}])
            self.send_response(200)
            self.send_header("Content-Type", "application/dicom+json")
            self.end_headers()
            self.wfile.write(body.encode())
            return
        if self.path.startswith("/dicom-web"):
            body = json.dumps([{"0020000D": {"Value": ["1.2.840.1"]}}])
            self.send_response(200)
            self.send_header("Content-Type", "application/dicom+json")
            self.end_headers()
            self.wfile.write(body.encode())
            return
        if self.path.startswith("/wado"):
            self.send_response(200)
            self.send_header("Content-Type", "application/dicom")
            self.end_headers()
            self.wfile.write(b"WADOURI")
            return
        self.send_response(404)
        self.end_headers()
        self.wfile.write(("missing " + self.path).encode())

ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
`
  );

  const mockProc = spawn("python3", [mockPy, String(upstreamPort), receivedPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  function readReceived() {
    const text = fs.readFileSync(receivedPath, "utf8").trim();
    if (!text) return [];
    return text.split("\n").map((line) => JSON.parse(line));
  }

  function clearReceived() {
    fs.writeFileSync(receivedPath, "");
  }

  // Wait for Python mock readiness (curl works against Python).
  let mockReady = false;
  for (let i = 0; i < 40; i++) {
    const probe = sh("curl", [
      "-sf",
      "--max-time",
      "2",
      `http://127.0.0.1:${upstreamPort}/dicom-web/studies?limit=1`,
    ]);
    if (probe.status === 0 && /0020000D/.test(probe.stdout || "")) {
      mockReady = true;
      break;
    }
    if (mockProc.exitCode != null) break;
    await sleep(100);
  }
  if (!mockReady) {
    console.error("python mock Orthanc failed to become ready");
    console.error(mockProc.stderr.read?.() || "");
    mockProc.kill("SIGKILL");
    process.exit(1);
  }
  clearReceived();
  console.log("PASS python mock Orthanc ready on", upstreamPort);

  const html = path.join(tmp, "html");
  fs.mkdirSync(path.join(html, "care"), { recursive: true });
  fs.writeFileSync(path.join(html, "index.html"), "<html><body>ok</body></html>");
  fs.writeFileSync(path.join(html, "app-config.js"), "window.config={};");
  fs.writeFileSync(path.join(html, "care", "build-info.json"), "{}");

  let conf = CONF_SRC.replace(/orthanc:8042/g, `host.docker.internal:${upstreamPort}`);
  conf = conf.replace(/proxy_connect_timeout\s+300;/g, "proxy_connect_timeout 5;");
  conf = conf.replace(/proxy_send_timeout\s+300;/g, "proxy_send_timeout 5;");
  conf = conf.replace(/proxy_read_timeout\s+300;/g, "proxy_read_timeout 5;");
  const confPath = path.join(tmp, "default.conf");
  fs.writeFileSync(confPath, conf);

  sh("sudo", ["docker", "rm", "-f", NGX]);

  const run = sh("sudo", [
    "docker",
    "run",
    "-d",
    "--name",
    NGX,
    "--add-host=host.docker.internal:host-gateway",
    "-p",
    `${httpPort}:80`,
    "-v",
    `${html}:/usr/share/nginx/html:ro`,
    "-v",
    `${confPath}:/etc/nginx/conf.d/default.conf:ro`,
    "nginx:1.25-alpine",
  ]);
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    mockProc.kill("SIGKILL");
    process.exit(1);
  }

  let ready = false;
  for (let i = 0; i < 30; i++) {
    const hz = sh("curl", [
      "-sf",
      "--max-time",
      "3",
      `http://127.0.0.1:${httpPort}/healthz`,
    ]);
    if (hz.status === 0 && /ok/.test(hz.stdout || "")) {
      ready = true;
      break;
    }
    await sleep(200);
  }
  if (!ready) {
    console.error("nginx failed to become ready");
    console.error(sh("sudo", ["docker", "logs", NGX]).stdout);
    sh("sudo", ["docker", "rm", "-f", NGX]);
    mockProc.kill("SIGKILL");
    process.exit(1);
  }
  console.log("PASS /healthz");

  const cases = [
    {
      path: "/dicom-web/studies?limit=1&offset=0",
      expectUrl: "/dicom-web/studies?limit=1&offset=0",
      bodyIncludes: "0020000D",
    },
    {
      path: "/dicom-web/studies/1.2.840.1/metadata",
      expectUrl: "/dicom-web/studies/1.2.840.1/metadata",
      bodyIncludes: "00080018",
    },
    {
      path: "/dicom-web/studies/1.2.840.1/series/1.2.3/instances/1.2.3.4/frames/1",
      expectUrl: "/dicom-web/studies/1.2.840.1/series/1.2.3/instances/1.2.3.4/frames/1",
      bodyIncludes: "FRAMEDATA",
      headerIncludes: "multipart/related",
      extraCurl: ["-H", "Range: bytes=0-1023"],
      expectRange: "bytes=0-1023",
    },
    {
      path: "/dicom-web/studies/",
      expectUrl: "/dicom-web/studies/",
      bodyIncludes: "0020000D",
    },
    {
      path: "/wado?requestType=WADO&studyUID=1.2.840.1&seriesUID=1.2.3&objectUID=1.2.3.4",
      expectUrl:
        "/wado?requestType=WADO&studyUID=1.2.840.1&seriesUID=1.2.3&objectUID=1.2.3.4",
      bodyIncludes: "WADOURI",
    },
  ];

  let failed = 0;
  for (const c of cases) {
    clearReceived();
    const out = curlRaw(`http://127.0.0.1:${httpPort}${c.path}`, c.extraCurl || []);
    const upstream = readReceived()[0] || null;
    try {
      assert.equal(out.status, 0, out.stderr);
      assert.ok(
        upstream,
        `no upstream hit for ${c.path} (body=${out.stdout.slice(0, 200)})`
      );
      assert.equal(upstream.url, c.expectUrl, `URI mismatch for ${c.path}`);
      assert.match(out.stdout, new RegExp(c.bodyIncludes));
      if (c.headerIncludes) {
        assert.match(out.stdout, new RegExp(c.headerIncludes, "i"));
      }
      if (c.expectRange) assert.equal(upstream.range, c.expectRange);
      console.log("PASS", c.path, "→", upstream.url, "Host=", upstream.host);
    } catch (err) {
      failed += 1;
      console.error("FAIL", c.path, err.message, "upstream=", upstream);
      console.error(out.stdout.slice(0, 300));
    }
  }

  sh("sudo", ["docker", "rm", "-f", NGX]);
  mockProc.kill("SIGKILL");

  if (failed) {
    console.error(`nginx-dicomweb-path: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("nginx-dicomweb-path: OK (paths preserved against mock Orthanc)");
})().catch((err) => {
  console.error(err);
  sh("sudo", ["docker", "rm", "-f", NGX]);
  process.exit(1);
});
