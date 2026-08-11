#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc to ERP Sync Service

Reads studies from Orthanc and posts them to the ERP radiology worklist.
Runs separately from Orthanc, so ERP failures do not affect PACS storage.
"""

import datetime
import logging
import time
from typing import Any, Dict

import requests


ORTHANC_URL = "http://care-orthanc:8042"
ORTHANC_USERNAME = ""
ORTHANC_PASSWORD = ""

ERP_BASE_URL = "http://172.16.1.139:8888"
ERP_INTERNAL_API_KEY = "1234"

ERP_STUDY_ENDPOINT = "/api/internal/radiology/studies"
ERP_EVENT_ENDPOINT = "/api/internal/radiology/dicom-event"

POLL_INTERVAL_SECONDS = 300
SYNC_LOOKBACK_DAYS = 7
BACKFILL_EXISTING_STUDIES = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


def orthanc_auth():
    if ORTHANC_USERNAME and ORTHANC_PASSWORD:
        return (ORTHANC_USERNAME, ORTHANC_PASSWORD)
    return None


def orthanc_get(path: str) -> Any:
    response = requests.get(ORTHANC_URL.rstrip("/") + path, auth=orthanc_auth(), timeout=60)
    response.raise_for_status()
    return response.json()


def erp_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {ERP_INTERNAL_API_KEY}",
        "Content-Type": "application/json",
    }


def erp_post(path: str, payload: Dict[str, Any]) -> requests.Response:
    return requests.post(
        ERP_BASE_URL.rstrip("/") + path,
        json=payload,
        headers=erp_headers(),
        timeout=30,
    )


def s(value: Any) -> str:
    return "" if value is None else str(value).strip()


def parse_orthanc_date(date_str: str):
    date_str = s(date_str)
    if len(date_str) != 8:
        return None
    try:
        return datetime.datetime.strptime(date_str, "%Y%m%d").date()
    except Exception:
        return None


def should_sync_study(study_info: Dict[str, Any]) -> bool:
    if BACKFILL_EXISTING_STUDIES:
        return True

    tags = study_info.get("MainDicomTags", {}) or {}
    study_date = parse_orthanc_date(tags.get("StudyDate", ""))
    if study_date is None:
        return True

    cutoff = datetime.date.today() - datetime.timedelta(days=SYNC_LOOKBACK_DAYS)
    return study_date >= cutoff


def build_payload(study_id: str, study_info: Dict[str, Any]) -> Dict[str, Any]:
    main = study_info.get("MainDicomTags", {}) or {}
    patient = study_info.get("PatientMainDicomTags", {}) or {}
    requested = study_info.get("RequestedTags", {}) or {}

    study_uid = s(main.get("StudyInstanceUID"))
    accession = s(main.get("AccessionNumber")) or study_uid or study_id
    patient_id = s(patient.get("PatientID")) or (f"DICOM-{study_uid[-12:]}" if study_uid else f"ORTHANC-{study_id}")
    patient_name = s(patient.get("PatientName")) or "UNKNOWN"
    modality = s(requested.get("ModalitiesInStudy")) or "MR"

    return {
        "studyId": study_uid or study_id,
        "studyInstanceUID": study_uid,
        "orthancStudyId": study_id,
        "accessionNumber": accession,
        "patientId": patient_id,
        "patientName": patient_name,
        "age": "",
        "sex": s(patient.get("PatientSex")),
        "patientBirthDate": s(patient.get("PatientBirthDate")),
        "modality": modality,
        "studyDescription": s(main.get("StudyDescription")),
        "studyDate": s(main.get("StudyDate")),
        "studyTime": s(main.get("StudyTime")),
        "sourcePacs": "Orthanc",
        "sourceAeTitle": "ORTHANC2",
        "sourceIp": "172.16.1.139",
        "receivedAt": datetime.datetime.now().isoformat(),
        "dicomMetadata": {
            "OrthancStudyId": study_id,
            "StudyInstanceUID": study_uid,
            "AccessionNumber": accession,
            "PatientID": patient_id,
            "PatientName": patient_name,
            "PatientSex": s(patient.get("PatientSex")),
            "PatientBirthDate": s(patient.get("PatientBirthDate")),
            "StudyDate": s(main.get("StudyDate")),
            "StudyTime": s(main.get("StudyTime")),
            "StudyDescription": s(main.get("StudyDescription")),
            "ReferringPhysicianName": s(main.get("ReferringPhysicianName")),
            "InstitutionName": s(main.get("InstitutionName")),
            "StudyID": s(main.get("StudyID")),
            "SeriesCount": len(study_info.get("Series", []) or []),
            "InstanceCount": len(study_info.get("Instances", []) or []),
        },
    }


def post_study_to_erp(payload: Dict[str, Any]) -> bool:
    uid = payload.get("studyInstanceUID") or payload.get("studyId")
    try:
        response = erp_post(ERP_STUDY_ENDPOINT, payload)
        logging.info("ERP study POST uid=%s status=%s body=%s", uid, response.status_code, response.text[:500])

        if not response.ok:
            return False

        event_payload = {
            "eventType": "ORTHANC_SYNCED_TO_ERP",
            "studyInstanceUID": payload.get("studyInstanceUID"),
            "accessionNumber": payload.get("accessionNumber"),
            "patientId": payload.get("patientId"),
            "modality": payload.get("modality"),
            "message": "Study synced from Orthanc to ERP",
            "sourcePacs": "Orthanc",
            "sourceAeTitle": "ORTHANC2",
            "eventTime": datetime.datetime.now().isoformat(),
            "metadata": payload,
        }

        event_response = erp_post(ERP_EVENT_ENDPOINT, event_payload)
        logging.info("ERP event POST uid=%s status=%s body=%s", uid, event_response.status_code, event_response.text[:500])
        return event_response.ok

    except Exception as exc:
        logging.exception("ERP POST failed uid=%s error=%s", uid, exc)
        return False


def sync_once() -> None:
    logging.info("CARE ERP SYNC: cycle started")

    try:
        system = orthanc_get("/system")
        logging.info("Connected to Orthanc: Name=%s AET=%s", system.get("Name"), system.get("DicomAet"))
    except Exception as exc:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, exc)
        return

    try:
        studies = orthanc_get("/studies")
    except Exception as exc:
        logging.error("Cannot list Orthanc studies: %s", exc)
        return

    logging.info("Orthanc has %d studies", len(studies))

    synced = 0
    skipped = 0
    failed = 0

    for study_id in studies:
        try:
            study_info = orthanc_get(f"/studies/{study_id}")
            if not should_sync_study(study_info):
                skipped += 1
                continue

            payload = build_payload(study_id, study_info)
            if post_study_to_erp(payload):
                synced += 1
            else:
                failed += 1

        except Exception as exc:
            failed += 1
            logging.exception("Failed processing Orthanc study %s: %s", study_id, exc)

    logging.info("CARE ERP SYNC: cycle finished synced=%d skipped=%d failed=%d", synced, skipped, failed)


def main() -> None:
    logging.info("Care Orthanc ERP Sync starting")
    logging.info("ERP target: %s", ERP_BASE_URL)
    logging.info("Polling every %s seconds", POLL_INTERVAL_SECONDS)

    while True:
        sync_once()
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
