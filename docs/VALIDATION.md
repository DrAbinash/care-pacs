# CARE PACS validation checklist (permanent stack)

Run on the Synology NAS after deploying `cursor-pacs-stabilization`.

## 0. Prep folders

```bash
mkdir -p /volume1/docker/care-pacs/orthanc/worklists
mkdir -p /volume1/docker/care-pacs/orthanc/worklists-bad
mkdir -p /volume1/docker/care-pacs/orthanc/worklists-staging
mkdir -p /volume1/docker/care-pacs/mwl-guard
# Ensure mwl_guard.py + requirements.txt are present under mwl-guard/
```

## 1. Compose syntax

```bash
cd /volume1/docker/care-pacs
docker compose config -q && echo OK
```

## 2. Bring up (never `down -v`)

```bash
# Record study count BEFORE
BEFORE=$(curl -s http://127.0.0.1:8042/studies | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo unknown)
echo "studies before=$BEFORE"

docker compose up -d
docker compose ps
```

## 3. Orthanc stable (no restart loop)

```bash
sleep 30
docker ps --filter name=care-orthanc --format '{{.Status}}'
docker logs care-orthanc --since 10m 2>&1 | grep -iE 'terminate|OrthancException|missing StudyInstanceUID' || echo "No crash signatures"
docker logs care-orthanc 2>&1 | grep 'Orthanc has started' | tail -3
```

## 4. REST + DICOM ports

```bash
curl -sf http://127.0.0.1:8042/system | python3 -m json.tool | head
nc -zv 127.0.0.1 5680
nc -zv 127.0.0.1 8042
```

## 5. Study count unchanged

```bash
AFTER=$(curl -s http://127.0.0.1:8042/studies | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')
echo "studies after=$AFTER (before was $BEFORE)"
```

## 6. OHIF

```bash
curl -sf -o /dev/null -w 'ohif:%{http_code}\n' http://127.0.0.1:3010/
curl -sf -o /dev/null -w 'qido:%{http_code}\n' 'http://127.0.0.1:3010/dicom-web/studies?limit=1'
```

## 7. MWL guard

```bash
docker logs care-mwl-guard --tail 50
ls -la /volume1/docker/care-pacs/orthanc/worklists/
ls -la /volume1/docker/care-pacs/orthanc/worklists-bad/ | head
```

## 8. Inject a deliberately bad .wl (proves guard)

```bash
# Create a tiny invalid file Orthanc would crash on if housekeeper saw it
printf 'NOT-A-DICOM' > /volume1/docker/care-pacs/orthanc/worklists/GUARD_TEST_BAD.wl
sleep 5
ls /volume1/docker/care-pacs/orthanc/worklists/GUARD_TEST_BAD.wl 2>/dev/null && echo FAIL_still_present || echo OK_quarantined
ls /volume1/docker/care-pacs/orthanc/worklists-bad/ | grep GUARD_TEST_BAD
docker ps --filter name=care-orthanc --format '{{.Status}}'   # must still be Up
```

## 9. Puller + ERP sync still running

```bash
docker logs care-orthanc-puller --tail 20
docker logs care-erp-sync --tail 20
```

## 10. UIH C-ECHO / C-MOVE (when modalities available)

```bash
# From a host with DCMTK, or Orthanc modalities echo:
curl -sf -X POST http://127.0.0.1:8042/modalities/UIH_MRI/echo && echo ECHO_OK
docker logs care-orthanc --since 5m 2>&1 | grep -i 'C-Move' | tail
```

## 11. Storage discovery (before any StorageDirectory change)

See `docs/STORAGE_DISCOVERY.md` — run those commands and archive the output.
