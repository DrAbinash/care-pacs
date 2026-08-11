# care-mwl-guard

Permanent defense against Orthanc Worklist Housekeeper crashes.

## What it does

1. On startup, scans `/var/lib/orthanc/worklists` for `*.wl`
2. Validates Study/Series/SOP Instance UIDs + ScheduledProcedureStepSequence
3. Moves invalid files to `/var/lib/orthanc/worklists-bad/` (never deletes)
4. Writes a `.reason.txt` sidecar explaining why
5. Marks healthy only after the first sweep (so Orthanc waits)
6. Keeps polling every 2 seconds

## NAS layout

```text
/volume1/docker/care-pacs/mwl-guard/          ← this folder (bind-mounted :ro)
/volume1/docker/care-pacs/orthanc/worklists/  ← Orthanc Database folder
/volume1/docker/care-pacs/orthanc/worklists-bad/
/volume1/docker/care-pacs/orthanc/worklists-staging/  ← ERP atomic publish (ERP side)
```

## Local test

```bash
cd mwl-guard
pip install -r requirements.txt
python test_mwl_guard.py
```

## Logs

```bash
docker logs -f care-mwl-guard
```

Look for `QUARANTINED` lines if ERP ever writes a bad file again.
