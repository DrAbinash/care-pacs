CARE DIAGNOSTICS - COMBINED ORTHANC + OHIF COMPOSE

This file restores the old working OHIF setup that avoided the polyfill.io issue:

OHIF image:
  ohif/app:v3.9.2

OHIF config mount:
  /volume1/docker/care-pacs/ohif/config/default.js
  ->
  /usr/share/nginx/html/app-config.js:ro

This keeps the working services:
- care-orthanc
- care-orthanc-puller
- care-erp-sync

And adds OHIF:
- care-ohif on port 3010

Place docker-compose.yml at your Orthanc project folder, replacing the current project compose:
  /volume1/docker/care-pacs/orthanc/docker-compose.yml

Do not delete:
  /volume1/docker/care-pacs/orthanc/data
  /volume1/docker/care-pacs/orthanc-puller
  /volume1/docker/care-pacs/care-erp-sync

Important:
You still need:
  /volume1/docker/care-pacs/ohif/config/default.js

After redeploy:
  sudo docker logs care-ohif --tail 100
  open http://192.168.1.137:3010
