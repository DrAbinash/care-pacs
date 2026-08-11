# Synology deploy pack — Care PACS + Care ERP + Hope (2026-07-31)

Ready-to-copy configs derived from your uploaded live files, plus the MWL /
Hope↔Care / name-match work from this agent.

## What was wrong in the uploads

| File | Issue | Fix in this pack |
|---|---|---|
| `orthanc.json` | Only DicomWeb plugin — **no Worklists** | Enable Worklists plugin + Database folder |
| `docker-compose` (care-pacs) | No shared worklists volume | Mount `orthanc/worklists` |
| `env-care` | No `ORTHANC_WORKLIST_DIR` | Added + Hope block kept |
| `env-hope` | Fine for referrals; MRI deep-link uses `CARE_REFERRAL_URL` base | Comment + optional staff URL |
| `auto_pull.lua` | Logging-only OnStoredInstance (correct) | **Leave as-is** — do not add ERP HTTP POST |
| `env` (Tailscale) | Auth key exposed in chat | Copied into care-pacs `.env` — **rotate the key** |

### `care_erp_sync.py` ERP URL (do not “fix” blindly)

The NAS/Care ERP is **dual-homed** — both are valid on different segments:

| Address | Role |
|---|---|
| `http://172.16.1.139:8888` | **Preferred / currently working** path from live `care-erp-sync` — keep this |
| `http://192.168.1.137:8888` | Alternate LAN segment — also reaches Care |

This pack keeps `ERP_BASE_URL=http://172.16.1.139:8888`. Change it only if a probe
**from inside the `care-erp-sync` container** shows the preferred path unreachable
and the alternate works. Startup logs probe both; the script does **not** auto-switch.

```bash
docker exec care-erp-sync curl -sS -m 3 -o /dev/null -w '%{http_code}\n' http://172.16.1.139:8888/health
docker exec care-erp-sync curl -sS -m 3 -o /dev/null -w '%{http_code}\n' http://192.168.1.137:8888/health
```

Architecture (unchanged): **`auto_pull.lua` = logging only**; **`care_erp_sync.py` = sole Orthanc→ERP sender**. Keep `ORTHANC_CHANGES_POLLER=false` on Care ERP.

## Copy order (Container Manager / File Station)

### 1) Create shared MWL folder on NAS
```
/volume1/docker/care-pacs/orthanc/worklists
```
(empty folder is fine; Care API writes `.wl` files here)

### 2) care-pacs stack
Copy into `/volume1/docker/care-pacs/`:
- `care-pacs/docker-compose.yml` → replace compose
- `care-pacs/orthanc.json` → `orthanc/config/orthanc.json`
- `care-pacs/care_erp_sync.py` → `care-erp-sync/care_erp_sync.py`
- `care-pacs/orthanc_auto_puller.py` → `orthanc-puller/` (unchanged logic; MRI-only)
- `care-pacs/.env` → Tailscale key for OHIF serve
- `care-pacs/auto_pull.lua` → keep logging-only (optional copy; do not replace with an ERP-push Lua)

Then **Project → Build** (or recreate) care-pacs. Orthanc must pick up the new JSON (recreate `care-orthanc`).

### 3) Care ERP stack
Merge `care-erp/env-care.env` into your live Care `.env` (do **not** wipe DB_PASSWORD / secrets blindly — merge the new MWL lines):
```
ORTHANC_WORKLIST_DIR=/orthanc-worklists
ORTHANC_WORKLIST_HOST_DIR=/volume1/docker/care-pacs/orthanc/worklists
```
Pull branch `cursor/hope-care-auto-bootstrap-362a` (or merge PR #354), then rebuild care-api so it mounts the worklists folder.

### 4) Hope ERP stack
Merge `hope-erp/env-hope.env` Care block (already has ENABLE_CARE_INTEGRATION). Rebuild Hope after pushing the OPD MRI button commit (needs write access to hope repo).

## Verify

1. Bill an MRI in Care → row in **Radiology → MWL** (`radiology_scheduled_procedures`) with ERP patient name + accession.
2. On NAS: `ls /volume1/docker/care-pacs/orthanc/worklists` shows `ACC-….wl` after bill (when Care API rebuilt with the mount).
3. From MRI console: MWL C-FIND against Orthanc AET `ORTHANC2` / port `5680` (mapped DICOM) — patient name matches the bill.
4. After scan: `care-erp-sync` logs `ERP study POST … status=200` (and startup `ERP path probe` lines); worklist match is GREEN on accession even if name order differs.
5. Hope OPD with MRI in Rx → **Report MRI in CARE** opens `/erp/radiology/open?…`.

## Do not

- Wipe Docker volumes when rebuilding.
- Change `DB_PASSWORD` / `INTERNAL_API_KEY` without rotating every copy together (`care_erp_sync.py` still has `1234`).
- Replace `auto_pull.lua` with an ERP HTTP POST (would double-sync with `care_erp_sync.py`).
- Commit these artifact `.env` files to GitHub (they contain live secrets).
- Flip `ERP_BASE_URL` between `172.16.1.139` and `192.168.1.137` without a container-side probe.
