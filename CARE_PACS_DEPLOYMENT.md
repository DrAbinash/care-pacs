# CARE PACS deployment on Synology

## Final folder structure

Create and keep the stack under:

```text
/volume1/docker/care-pacs/
├── docker-compose.yml
├── .env
├── orthanc/
│   ├── config/
│   │   └── orthanc.json
│   ├── data/
│   └── scripts/
├── orthanc-puller/
│   ├── orthanc_auto_puller.py
│   └── requirements.txt
├── care-erp-sync/
│   ├── care_erp_sync.py
│   └── requirements.txt
├── ohif/
│   └── enterprise/
│       ├── Dockerfile
│       └── ...existing OHIF source/build files...
└── tailscale-ohif/
    ├── serve.json
    └── state/
```

## Where to paste the files

1. Open **DSM → File Station**.
2. Go to `/volume1/docker/care-pacs/`.
3. Rename the current compose file as a backup, for example:
   `docker-compose.before-watchtower-removal.yml`.
4. Upload the supplied `docker-compose.production.yml` into this folder.
5. Rename it to exactly:
   `docker-compose.yml`.
6. Create `/volume1/docker/care-pacs/.env` and paste the real Tailscale auth key:

```env
TS_AUTHKEY=tskey-auth-YOUR_REAL_KEY
```

Do not put spaces around `=` and do not share this file.

## Required existing files

Before starting, verify these paths exist:

```text
/volume1/docker/care-pacs/orthanc/config/orthanc.json
/volume1/docker/care-pacs/orthanc-puller/requirements.txt
/volume1/docker/care-pacs/orthanc-puller/orthanc_auto_puller.py
/volume1/docker/care-pacs/care-erp-sync/requirements.txt
/volume1/docker/care-pacs/care-erp-sync/care_erp_sync.py
/volume1/docker/care-pacs/ohif/enterprise/Dockerfile
/volume1/docker/care-pacs/tailscale-ohif/serve.json
```

## Deploy using Synology Container Manager

Use **Container Manager → Project**:

1. Stop the existing CARE PACS project.
2. Edit or recreate the project using:
   `/volume1/docker/care-pacs/docker-compose.yml`.
3. Build/start the project.
4. Confirm these containers are running:
   - `care-mwl-guard`
   - `care-orthanc`
   - `care-orthanc-puller`
   - `care-erp-sync`
   - `care-ohif`
   - `care-tailscale-ohif`
5. Confirm that `care-watchtower` is absent.

See also:
- `docs/PERMANENT_ARCHITECTURE.md`
- `docs/STORAGE_DISCOVERY.md`
- `docs/VALIDATION.md`
- `mwl-guard/README.md`

## Verification

Open:

```text
Orthanc: http://172.16.1.139:8042
OHIF:    http://172.16.1.139:3010
```

Then verify:

- Orthanc opens normally.
- Existing studies remain visible.
- Query/Retrieve lists the configured modalities.
- `XRAY_TEST_80` can be tested separately after confirming its AE/IP/port.
- The puller and ERP sync logs show no repeated errors.

## Removing the old Watchtower container

After the new project is healthy:

1. Open **Container Manager → Container**.
2. Stop `care-watchtower` if it still exists.
3. Delete only the `care-watchtower` container.
4. Do not delete Orthanc data, configuration, or any shared folders.

The new compose has no Watchtower service and no Watchtower labels, so future deployments will not recreate it.
