# Orthanc storage discovery (DATA-CRITICAL)

## Why this matters

Compose mounts:

```text
Host:  /volume1/docker/care-pacs/orthanc/data
Cont:  /var/lib/orthanc/db
```

But Orthanc logs have reported:

```text
Storage directory: /startup/OrthancStorage
SQLite index directory: /startup/OrthancStorage
```

If Orthanc is using `/startup/OrthancStorage` inside the container, the NAS
bind-mount may **not** hold the live study database. Changing
`StorageDirectory` / `IndexDirectory` without a migration can make all
existing studies disappear from Orthanc/OHIF.

**Do not set those keys until the commands below identify the live store.**

## Commands to run on the NAS (read-only)

```bash
# 1. Confirm container
docker ps --filter name=care-orthanc --format '{{.ID}} {{.Status}} {{.Image}}'

# 2. What Orthanc logged at last start
docker logs care-orthanc 2>&1 | grep -E 'Storage directory|SQLite index|Orthanc has started' | tail -20

# 3. Mounts
docker inspect care-orthanc --format '{{json .Mounts}}' | python3 -m json.tool

# 4. Find Orthanc.sqlite on host
find /volume1/docker/care-pacs/orthanc -name 'Orthanc.sqlite*' 2>/dev/null
ls -lah /volume1/docker/care-pacs/orthanc/data 2>/dev/null | head

# 5. Find Orthanc.sqlite inside container
docker exec care-orthanc sh -c 'find /startup /var/lib/orthanc -name "Orthanc.sqlite*" 2>/dev/null'
docker exec care-orthanc sh -c 'ls -lah /startup/OrthancStorage 2>/dev/null | head'
docker exec care-orthanc sh -c 'ls -lah /var/lib/orthanc/db 2>/dev/null | head'

# 6. Study counts (REST)
curl -s http://127.0.0.1:8042/statistics | python3 -m json.tool
curl -s http://127.0.0.1:8042/studies | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))'

# 7. Disk usage comparison
docker exec care-orthanc sh -c 'du -sh /startup/OrthancStorage /var/lib/orthanc/db 2>/dev/null'
```

## Decision matrix

| Finding | Action |
|---------|--------|
| Studies live under mounted `/var/lib/orthanc/db` and logs agree | Safe to add explicit StorageDirectory/IndexDirectory = that path in a **future** PR |
| Studies live under `/startup/OrthancStorage` and host `data/` is empty/small | **STOP**. Plan offline migration; do not edit config yet |
| Both locations have data | **STOP**. Investigate which Orthanc is actually serving; risk of split brain |

## Migration outline (DO NOT RUN until approved)

1. Stop modalities / freeze C-STORE
2. `docker stop care-orthanc` (not `down -v`)
3. Copy/rsync the proven live store onto the NAS bind-mount path
4. Set StorageDirectory + IndexDirectory in orthanc.json to `/var/lib/orthanc/db`
5. Start Orthanc; verify study count unchanged
6. Only then resume modalities

Never delete Orthanc.sqlite. Never create a fresh empty DB over a live one.
