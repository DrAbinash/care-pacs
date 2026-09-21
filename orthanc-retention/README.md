# Orthanc retention sidecar

Keeps Orthanc as a short-term working cache (~500 studies).

## Behaviour

- Polls Care ERP `GET /api/internal/radiology/retention-policy` each cycle.
- Does nothing while Advanced → **Auto-retention** is off (default).
- When enabled and study count > trigger (520), deletes oldest by Orthanc `LastUpdate` down to keep (500).
- After deletes, calls `POST /api/internal/radiology/purge-reconcile` so ERP imaging/worklist cache is scrubbed.

## NAS deploy

```bash
# From care-pacs checkout on Synology
mkdir -p /volume1/docker/care-pacs/orthanc-retention
cp orthanc-retention/orthanc_retention.py orthanc-retention/requirements.txt \
  /volume1/docker/care-pacs/orthanc-retention/
# Ensure ERP_BASE_URL / ERP_INTERNAL_API_KEY match care-erp-sync
docker compose up -d orthanc-retention
```

Leave the ERP switch off until the container is healthy.
