# Audit — CARE OHIF customisation foundation

**Audit date:** 2026-09-05  
**Baseline SHA (confirmed):** `1e10a17f5d789fd345f562b851c0dbc43c37d471` (`Persist Orthanc storage and index on NAS`)  
**Branch for work:** `cursor/care-ohif-customization-foundation`

Legend: **FACT** = verified in this repository / upstream API; **ASSUMPTION** = inferred, not runtime-proven on Synology in this environment.

---

## 1. How OHIF is built and deployed today

**FACT (post-foundation target state in this branch)**

- Active build context: `ohif/enterprise/` (`Dockerfile`, `app-config.js`, `default.conf`).
- Root `docker-compose.yml` service `ohif`:
  - Build context: `./ohif/enterprise` (relative to repo root; Synology checkout at `/volume1/docker/care-pacs`).
  - Image tag: `care-ohif-enterprise:v1`.
  - Host port: `3010:80`.
  - Build args: `OHIF_REF=v3.10.0`, `OHIF_COMMIT`, `CARE_VIEWER_VERSION`.
  - Healthcheck on `/healthz` + `/app-config.js`.
- Dockerfile fetches immutable commit `OHIF_COMMIT` (`git fetch --depth 1` + checkout),
  runs `yarn install --frozen-lockfile`, copies CARE `app-config.js` into webpack `config/default.js`,
  builds with `yarn build`, injects CARE assets, records build metadata, serves
  `platform/app/dist` via `nginx:1.25-alpine`.
- DICOMweb and WADO are reverse-proxied inside the OHIF nginx container to
  `http://orthanc:8042` (`/dicom-web`, `/wado`).

**FACT (pre-foundation baseline at `1e10a17`)**

- Build context was absolute `/volume1/docker/care-pacs/ohif/enterprise`.
- Build arg was `OHIF_BRANCH: v3.10.0` with shallow branch clone (not commit-pinned).

## 2. Does `v3.10.0` resolve reproducibly?

**FACT**

- GitHub tag `v3.10.0` is an **annotated** tag; peeled commit:
  **`0b6e9cba7613dba1df883985d3c821a86b3ba0ff`**.
- **Pre-foundation:** Dockerfile used `git clone --depth 1 --branch` only — not fully
  reproducible if the tag moved.
- **This branch:** Dockerfile pins `OHIF_COMMIT` and verifies `git rev-parse HEAD` matches.

## 3. Active vs backup / historical files

| Path | Status |
|------|--------|
| `ohif/enterprise/Dockerfile` | **Active** (compose build) |
| `ohif/enterprise/app-config.js` | **Active** |
| `ohif/enterprise/default.conf` | **Active** |
| `ohif/enterprise/care-customization/` | **Active** CARE-owned scripts |
| `ohif/enterprise/scripts/` | **Active** inject + metadata helpers |
| `ohif/enterprise/app-config--working.js` | **Historical backup** (not copied by Dockerfile) |
| `ohif/enterprise/INSTALL.txt` | Historical notes; superseded by `docs/OHIF_CARE_CUSTOMIZATION.md` |
| `ohif/config/app-config.js` | **Inactive** duplicate / older tree |
| `ohif/nginx/default.conf` | **Inactive** (enterprise nginx wins) |
| `docker-compose.yml` | **Active** production-oriented compose (includes mwl-guard) |
| `docker-compose.production.yml` | Slimmer variant **without** mwl-guard — treat as alternate/legacy |
| `orthanc/docker-compose*.yml` and `*--working*` / `*before*` | **Historical** Orthanc-era snapshots |

## 4. Configuration duplication / contradiction

**FACT**

- Two app-config trees existed (`ohif/enterprise/` vs `ohif/config/`) historically with
  hard-coded Tailscale root `http://100.65.255.115:3010/...`.
- Active enterprise nginx already same-origin proxies `/dicom-web` and `/wado`.
- Compose build context is now relative `./ohif/enterprise` (portable when cwd is repo root).

## 5. DICOMweb: relative vs Tailscale IP

**FACT**

- Nginx proxies `/dicom-web` → Orthanc DICOMweb root `/dicom-web/` and `/wado` → `/wado`.
- Active `app-config.js` uses **relative** `/dicom-web` and `/wado` (this branch).
- Historical absolute roots remain only in `app-config--working.js` (backup).
- **FACT (lab):** nginx URI-less `proxy_pass http://orthanc:8042;` preserves path + query
  against a mock Orthanc upstream (`ohif/enterprise/tests/nginx-dicomweb-path.test.cjs`),
  including studies, metadata, multipart frames, trailing slash, and WADO-URI.
- **ASSUMPTION (confirm on Synology):** Relative roots work for both LAN
  (`http://<nas-lan>:3010`) and Tailscale (`serve.json` proxies `/` to `http://ohif:80`)
  against the real Orthanc with clinical studies.

## 6. LAN and Tailscale reach the same viewer

**FACT**

- LAN: host publishes `3010:80` on the OHIF container.
- Tailscale: `tailscale-ohif` service with `serve.json` proxying HTTPS `/` → `http://ohif:80`.
- Same OHIF container serves both paths; no second viewer build.

## 7–8. Safest OHIF v3.10 customisation mechanism / mode needed?

**FACT (upstream v3.10.0)**

- Supported runtime config: `window.config` / `app-config.js` including
  `whiteLabeling.createLogoComponentFn`, dataSources, investigationalUseDialog.
- Full React extensions/modes require monorepo plugin wiring (heavier; better later).

**Decision (this PR)**

- **No custom mode** yet — default longitudinal mode remains.
- **Build-time static integration layer** (repo-owned classic scripts + `app-config.js`
  white-label), copied into `dist/` and injected into compiled `index.html` by a fail-loud
  script. **Not** a registered OHIF/Cornerstone extension (deferred to a later PR).
- Avoid vendoring the OHIF monorepo; pin immutable commit.
- No OHIF core source patches in this PR (`patches/` reserved and empty of patch files).
- Behavioural app-config hygiene: do **not** set `investigationalUseDialog: never`,
  `strictZSpacingForVolumeViewport`, or `dicomUploadEnabled: true` in this foundation.
  Keep Orthanc compatibility flags `omitQuotationForMultipartRequest` + `bulkDataURI`.

## 9. Build / config / smoke-test gaps (pre-foundation)

**FACT**

- No automated test that OHIF config is valid JS or that CARE assets are present.
- No OHIF container healthcheck in compose.
- No recorded upstream commit in the image.
- Python tests exist for `mwl-guard` only.
- Full `yarn build` of OHIF requires significant resources/network.

**This branch adds:** Node security/static tests, healthcheck, commit pin, build metadata.

## 10. Documentation drift

**FACT**

- `INSTALL.txt` historically referenced copying compose into `orthanc/` and Watchtower stop.
- Storage discovery docs correctly warn not to change Orthanc storage without migration
  (post-`1e10a17` persistence) — **leave storage config unchanged**.
