# CARE Diagnostics Viewer — OHIF customisation foundation

Operational guide for the CARE-branded OHIF v3.10 viewer. Audit notes:
`docs/AUDIT_OHIF_CARE_FOUNDATION.md`.

## Architecture

```
Modalities → Orthanc (:8042 DICOM :4242)
                ↑ mwl-guard → worklists/
                ↑ care-orthanc-puller / care-erp-sync
                ↓
         OHIF nginx (:3010 → container :80)
                ├── /                 CARE Diagnostics Viewer (OHIF v3.10)
                ├── /app-config.js    CARE runtime config (relative DICOMweb)
                ├── /care/*           CARE-owned scripts + build-info
                ├── /healthz          viewer liveness (no Orthanc dependency)
                ├── /dicom-web/*  ──► Orthanc DICOMweb
                └── /wado         ──► Orthanc WADO
                ↓
         optional Tailscale serve → same ohif:80
```

Pinned upstream: OHIF **v3.10.0** commit `0b6e9cba7613dba1df883985d3c821a86b3ba0ff`.  
Builder: `node:18-bookworm` (apt reliability only — **do not** bump Node or OHIF).  
Image tag: `care-ohif-enterprise:v1`.

## P0 branding (restrained chrome)

- Official logo: `ohif/enterprise/care-customization/assets/care-diagnostics-logo.png`
  → served as `/care/assets/care-diagnostics-logo.png`.
- `whiteLabeling.createLogoComponentFn` in `app-config.js` shows the logo (~26px)
  plus `CARE Diagnostics Viewer`. Kept out of the image viewport and toolbars.
- `investigationalUseDialog: { option: 'never' }` — required for this clinical build.
- Relative DICOMweb roots remain `/dicom-web` and `/wado` (nginx → Orthanc).
- ERP bridge stay fail-closed (empty allowlists until configured on the NAS).

## P1 reading-room UX (config + CARE chrome only)

Still on frozen OHIF `v3.10.0` / `0b6e9cba…` and `node:18-bookworm`.

- `customizationService` in `app-config.js`:
  - CARE-tuned `cornerstone.windowLevelPresets` for **CT / MR / CR / DX / US**
  - Separate CT **Stroke / narrow brain** and **Subdural** presets (not combined)
  - Layout presets including **2×1** compare (`layoutSelector.commonPresets`)
  - Extra W/L hotkeys **5** (liver) and **6** (mediastinum) via `$push` (stock 1–4 kept)
- CARE chrome **Keys** button → non-PHI shortcut cheat sheet (`care-chrome.js`)
- Prefetch / loading indicators via `maxNumRequests` + `showLoadingIndicator`

## P2 radiologist workflow

- **P2A measurements:** `MeasurementService` → CARE adapter → dual postMessage
  (`care.viewer.measurement*` + legacy `source:care-ohif`). See
  `docs/CARE_OHIF_MEASUREMENT_BRIDGE.md`. CARE chrome **Measure** panel for
  Canal AP levels / brain labels (manual only — no auto level guess).
- **P2B hanging protocols:** CARE protocols registered into OHIF default HP module
  (`care.mriBrain`, cervical/lumbar spine, CT brain/chest/abdomen) with
  `modesConfiguration` ranking and `default` fallback.
- Minimal patches: `patches/v3.10.0-0001-…`, `v3.10.0-0002-…` (fail build if stale).

**Still deferred:** ERP→OHIF mutation, automatic prior pairing, custom OHIF mode package.
Do not deploy without explicit NAS approval.

## Integration model (important)

CARE scripts are a **build-time static integration layer**:
they are copied into the OHIF `dist/` tree and injected into compiled
`index.html` by `scripts/inject-care-customization.sh`.

They are **not** a registered OHIF extension / mode / Cornerstone module.
A true Cornerstone-aware OHIF extension is intentionally deferred to a later PR.

Script load order in `index.html`:
1. OHIF loads `/app-config.js` (head / webpack template) first
2. OHIF application bundles boot
3. Near `</body>`, CARE injects: `care-security.js` → `care-config.js` →
   `build-info.js` → `care-bridge.js` → `care-chrome.js`

Missing CARE files or failed injection **fail the Docker build**.

### Runtime allowlists without rebuild

Compose bind-mounts
`ohif/enterprise/care-customization/care-config.runtime.js` over
`/care/care-config.js` (read-only). That host file **must** set
`window.careConfig` **and** merge into `window.config.care` (it replaces the
image’s baked `care-config.js`). Edit allowlists there; empty remain fail-closed.
Do not put secrets in this file.

## Where CARE customisations live

| Path | Role |
|------|------|
| `ohif/enterprise/Dockerfile` | Pins OHIF commit; injects CARE assets; HEALTHCHECK |
| `ohif/enterprise/app-config.js` | Active `window.config` (whiteLabeling, relative DICOMweb, `care.*`) |
| `ohif/enterprise/default.conf` | nginx: viewer, `/care/`, DICOMweb/WADO proxy, `/healthz` |
| `ohif/enterprise/care-customization/` | CARE-owned JS (bridge, chrome, security, config) |
| `ohif/enterprise/scripts/` | Fail-loud inject + build-metadata helpers |
| `ohif/enterprise/patches/` | Reserved; **no patches today** |
| `ohif/enterprise/tests/` | Node static + unit tests |
| `ohif/enterprise/app-config--working.js` | Historical backup (absolute Tailscale roots) — not used |

## Build

On the NAS (compose cwd = `/volume1/docker/care-pacs`):

```bash
cd /volume1/docker/care-pacs
# Never: docker compose down -v
docker compose build ohif
docker compose up -d ohif
```

Smoke:

```bash
curl -sf http://127.0.0.1:3010/healthz
curl -sf http://127.0.0.1:3010/app-config.js | head
curl -sf 'http://127.0.0.1:3010/dicom-web/studies?limit=1' | head
curl -sf http://127.0.0.1:3010/care/build-info.json
```

## Add another CARE feature

1. Add a file under `ohif/enterprise/care-customization/`.
2. Register it in `scripts/inject-care-customization.sh` (copy + `<script>` tag).
3. Extend `window.config.care` in `app-config.js` if configuration is needed.
4. Add a focused test under `ohif/enterprise/tests/`.
5. Rebuild the image; do **not** edit a running container or `dist/`.

Use a full OHIF React extension/mode only when Cornerstone services are required.

## Update the pinned OHIF version

**Do not do this lightly.** Production is frozen at
`0b6e9cba7613dba1df883985d3c821a86b3ba0ff` (v3.10.0) with `node:18-bookworm`.

1. Resolve the immutable commit: `git ls-remote https://github.com/OHIF/Viewers.git <tag>^{}`.
2. Update `OHIF_REF` / `OHIF_COMMIT` in `Dockerfile` and compose build `args`.
3. Rebuild `--no-cache` and re-validate study list / MPR / measurements on Synology.
4. If a patch exists under `patches/`, the Dockerfile must fail when it no longer applies
   (none today).

Branding-only changes (logo, chrome, docs, static tests) must **not** change
`OHIF_REF`, `OHIF_COMMIT`, Node major, nginx major, Orthanc, or storage.

## Rollback (no volume deletes)

```bash
cd /volume1/docker/care-pacs
docker tag care-ohif-enterprise:v1 care-ohif-enterprise:rollback-$(date +%Y%m%d)
# ... build new image ...
# if bad:
docker tag care-ohif-enterprise:rollback-YYYYMMDD care-ohif-enterprise:v1
docker compose up -d ohif
```

Never `docker compose down -v`. Never touch Orthanc storage/index as part of viewer rollback.

## CARE ERP message schema (v1)

Configure `window.config.care.erpOriginAllowlist` (and optional `care-config.js` overrides).

### ERP → viewer

```json
{ "type": "care.viewer.requestContext", "requestId": "optional-string" }
{ "type": "care.viewer.ping", "requestId": "optional-string" }
```

### Viewer → ERP

Replies use `event.source.postMessage(payload, event.origin)` — **never** `"*"`.

```json
{
  "type": "care.viewer.context",
  "version": 1,
  "studyInstanceUID": "1.2.840… or null",
  "seriesInstanceUID": "… or null",
  "sopInstanceUID": "… or null",
  "frameNumber": 1,
  "viewerName": "CARE Diagnostics Viewer",
  "hrefPath": "/viewer?StudyInstanceUIDs=…",
  "requestId": "echoed-if-provided"
}
```

**Not transmitted:** patient name, PatientID, phone, address, pixel data, or other PHI.

### Return-to-CARE

- Optional `window.config.care.defaultReturnUrl` and/or `?careReturnUrl=`
- Must pass `resolveSafeReturnUrl` against `returnUrlAllowlist`
- If no safe destination: Return control is **hidden**

## LAN / Tailscale validation

1. LAN: `http://<nas-lan-ip>:3010/` — study list via same-origin `/dicom-web`.
2. Tailscale: MagicDNS HTTPS URL — same app; DICOMweb remains relative.
3. Confirm `/app-config.js` shows `qidoRoot: '/dicom-web'` (not a Tailscale IP).
4. About CARE panel shows CARE version + OHIF commit.
5. Open viewer without ERP parent — no bridge errors.

## Known limitations

- Series/SOP/frame in the bridge today come from URL query params when present.
- ERP allowlists default to empty (safe); configure for iframe use.
- Prefer root `docker-compose.yml` over `docker-compose.production.yml` (no mwl-guard).
- Full OHIF `yarn build` is heavy; CI may only run Node/Python static tests.
- Not a regulatory certification claim.

## Storage note (unchanged)

Post-`1e10a17` Orthanc storage/index persistence remains in force. This work does **not**
change Orthanc storage paths, AE titles, modality IPs, mwl-guard behaviour, erp-sync,
puller, or Tailscale presence.
