# care-mwl-guard

Defense-in-depth against Orthanc Worklist Housekeeper crashes.

**Not a race-free gate after Orthanc is running.** Primary safety is Care ERP
atomic publish. This service polls and may miss a brief window.

## Quarantine policy

| Class | Condition | Action |
|-------|-----------|--------|
| A Crash | empty/invalid Study/Series/SOP Instance UID; unreadable DICOM | Quarantine → `worklists-bad/` |
| B Clinical | missing SOPClassUID / SPS / Modality | Warn only |
| C CARE business | missing AccessionNumber | Warn only |

## Startup (fail-closed)

1. Require worklists dir exists
2. Require quarantine dir writable
3. Startup sweep of crash-class files
4. Write ready file → Orthanc `depends_on: service_healthy`
5. Continue polling

If pip/pydicom/install fails, ready file is never written → Orthanc does not start.


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
