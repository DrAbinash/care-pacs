# CARE PACS — Permanent Architecture (2026-08)

Long-term design for a stable production PACS with optional ERP integration.
Branch: `cursor-pacs-stabilization` (never merge casually into `main` /
`baseline-care-pacs-2026-08-11` without review).

## Target data path

```
MRI / CT / USG / X-ray
        │  C-STORE / C-FIND / C-MOVE
        ▼
   care-orthanc  (ORTHANC2 :4242 / host :5680, HTTP :8042)
        │
        ├── DICOMweb/WADO ──► care-ohif (:3010) ──► (optional) Tailscale
        │
        ├── /changes ──► care-erp-sync ──► Care ERP intake API
        │
        └── worklists/*.wl ◄── Care ERP (dump2dcm) 
                 ▲
                 │ validated / quarantined by care-mwl-guard
```

## Race model (honest)

**Primary guarantee = Care ERP** (companion repo):

```
generate dump → assertValidMwlDump()
  → dump2dcm into worklists-staging/ (outside Orthanc watch)
  → validate DICOM UIDs (dcmdump when available)
  → atomic rename into worklists/*.wl  (same filesystem required)
```

**`care-mwl-guard` is defense-in-depth, not a race-free gate.**

After Orthanc is running, the guard polls every ~2s. A malformed `.wl`
that appears in `worklists/` can theoretically be read by Orthanc's
housekeeper in the poll gap before quarantine. Do **not** treat the guard
as making Orthanc completely safe under a hostile/broken writer.

Startup is safer: Orthanc `depends_on: service_healthy`, and the guard
only becomes healthy after the first crash-class sweep succeeds and
runtime dirs are writable.

## Guard quarantine policy

| Class | Fields | Action |
|-------|--------|--------|
| **A — Crash** | Study/Series/SOP Instance UID empty/invalid; unreadable DICOM | **Quarantine** |
| **B — Clinical** | SOPClassUID, ScheduledProcedureStepSequence, Modality | Warn only |
| **C — CARE business** | AccessionNumber | Warn only |

## Orthanc Worklists options

`SetStudyInstanceUidIfMissing` and `DeleteWorklistsOnStableStudy` are valid
on the modern Worklists plugin (Orthanc Book). Importantly:

- **SetStudyInstanceUidIfMissing** applies to **REST API creates**, not to
  repairing empty UIDs already present in filesystem `.wl` files. It does
  **not** prevent housekeeper crashes on empty-UID files.
- **DeleteWorklistsOnStableStudy** removes matched worklists after a stable
  study arrives; it does not sanitize malformed files and does not hide
  upstream generation bugs from operators (quarantine + ERP logs do).

This stack keeps `"Database"` (plugin 0.9.x wording used in live Care logs).
Newer docs may say `"Directory"` — do not rename without verifying the
installed plugin.

## Component roles (permanent)

| Service | Role | Keep? |
|---------|------|-------|
| `care-orthanc` | DICOM store + DICOMweb + MWL SCP | **Required** |
| `care-ohif` | Viewer | **Required** |
| `care-tailscale-ohif` | Remote viewer access | Optional |
| `care-orthanc-puller` | Auto C-MOVE missing MRI studies from UIH | **Keep** (PACS ingestion) |
| `care-erp-sync` | Orthanc → ERP study POST | **Keep** for long-term ERP |
| `care-mwl-guard` | Quarantine invalid `.wl` before Orthanc crashes | **Required while MWL on** |
| `auto_pull.lua` | Logging only; not loaded unless LuaScripts set | Leave alone |

## MWL contract (ERP must obey)

Every `.wl` file Orthanc sees MUST have non-empty:

- `(0008,0016)` SOP Class UID = `1.2.840.10008.5.1.4.31`
- `(0008,0018)` SOP Instance UID (digits + dots only)
- `(0020,000D)` Study Instance UID
- `(0020,000E)` Series Instance UID
- `(0040,0100)` ScheduledProcedureStepSequence with Modality

**Atomic publish (ERP):**

1. Build + validate dump text (reject `UI []`)
2. `dump2dcm` into `worklists-staging/` (NOT Orthanc Database folder)
3. `rename` / atomic move into `worklists/*.wl`

**PACS guard:**

1. Starts before Orthanc (`depends_on: service_healthy`)
2. Startup sweep quarantines bad files → `worklists-bad/`
3. Continues polling every 2s

## Storage — DO NOT CHANGE BLINDLY

Compose mounts:

```text
/volume1/docker/care-pacs/orthanc/data  →  /var/lib/orthanc/db
```

`orthanc.json` intentionally does **not** set `StorageDirectory` /
`IndexDirectory` until NAS discovery confirms where live studies reside.
Live logs have shown `/startup/OrthancStorage` (image default). Changing
paths without migration can orphan patient studies.

See `docs/STORAGE_DISCOVERY.md`.

## Deploy on Synology

```bash
# Host folders
mkdir -p /volume1/docker/care-pacs/orthanc/worklists
mkdir -p /volume1/docker/care-pacs/orthanc/worklists-bad
mkdir -p /volume1/docker/care-pacs/orthanc/worklists-staging
mkdir -p /volume1/docker/care-pacs/mwl-guard

# Copy mwl-guard sources into NAS path (compose bind-mounts this)
# Then from /volume1/docker/care-pacs:
docker compose config -q
docker compose up -d

# One-time: quarantine any existing bad worklists (move, do not delete)
# Prefer letting mwl-guard do this on startup.
```

## What we deliberately do NOT do

- Disable MWL permanently
- Disable care-erp-sync permanently
- Change OHIF app-config / image / Tailscale
- Change StorageDirectory without discovery + migration plan
- Delete Orthanc.sqlite or DICOM objects
- `docker compose down -v`
- Touch `main` / `baseline-care-pacs-2026-08-11`
