CARE DIAGNOSTICS - PHASE 2 ORTHANC AUTO PULLER

Your test has already proven:
Orthanc can query UIH MRI and retrieve/store MRI instances.

This package creates a separate Python puller service.
It queries UIH MRI every 5 minutes and retrieves missing studies into Orthanc.

DO NOT run Lua polling inside Orthanc.
This separate service is safer because it cannot crash Orthanc.

Files:
1. orthanc_auto_puller.py
2. requirements.txt
3. docker-compose-service-snippet.yml

Where to place:
Create folder:
/volume1/docker/care-pacs/orthanc-puller

Put:
orthanc_auto_puller.py
requirements.txt

Then add the service snippet into your existing:
/volume1/docker/care-pacs/orthanc/docker-compose.yml

It must be under services: at same indentation level as orthanc.

Example:

services:
  orthanc:
    ...
  orthanc-puller:
    image: python:3.11-slim
    ...

Deploy/rebuild the Orthanc project.

Check logs:
sudo docker logs -f care-orthanc-puller

Expected:
Care Orthanc Phase 2 Auto Puller starting
Connected to Orthanc: Name=CareDiagnostics AET=ORTHANC2
Querying UIH_MRI
UIH_MRI returned X studies
Already present ...
or
MISSING STUDY: pulling ...
Retrieve job submitted ...

Current version:
Only UIH_MRI enabled.
Do not enable CT/X-ray until MRI is stable.
