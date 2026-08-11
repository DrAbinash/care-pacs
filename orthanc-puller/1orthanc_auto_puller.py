#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc Phase 2 Auto Puller

Phase 2 purpose:
- Orthanc queries MRI every 5 minutes.
- Missing studies are retrieved into Orthanc automatically.
- This prevents dependence on technician-controlled auto-send.

First deployment:
- UIH MRI only.
- CT/X-ray disabled until MRI is stable.
"""

import datetime
import logging
import time
from typing import Any, Dict, Optional

import requests


ORTHANC_URL = "http://care-orthanc:8042"
ORTHANC_USERNAME = ""
ORTHANC_PASSWORD = ""

POLL_INTERVAL_SECONDS = 300
LOOKBACK_DAYS = 1

MODALITIES = [
    {"name": "UIH_MRI", "enabled": True},
    {"name": "CT_MACHINE", "enabled": False},
    {"name": "XRAY_1", "enabled": False},
    {"name": "XRAY_2", "enabled": False},
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


def auth():
    if ORTHANC_USERNAME and ORTHANC_PASSWORD:
        return (ORTHANC_USERNAME, ORTHANC_PASSWORD)
    return None


def orthanc_get(path: str) -> Any:
    r = requests.get(ORTHANC_URL.rstrip("/") + path, auth=auth(), timeout=60)
    r.raise_for_status()
    return r.json()


def orthanc_post(path: str, payload: Dict[str, Any]) -> Any:
    r = requests.post(ORTHANC_URL.rstrip("/") + path, json=payload, auth=auth(), timeout=120)
    r.raise_for_status()
    if r.text.strip():
        return r.json()
    return None


def date_query() -> str:
    since = datetime.date.today() - datetime.timedelta(days=LOOKBACK_DAYS)
    return since.strftime("%Y%m%d") + "-"


def extract_value(v):
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        if isinstance(v.get("Value"), str):
            return v["Value"].strip()
        if isinstance(v.get("Value"), list) and v["Value"]:
            return str(v["Value"][0]).strip()
    return ""


def get_tag(content: Dict[str, Any], tag: str, keyword: str = "") -> str:
    if keyword and keyword in content:
        return extract_value(content[keyword])
    if tag in content:
        return extract_value(content[tag])
    lower = tag.lower()
    if lower in content:
        return extract_value(content[lower])
    return ""


def local_study_exists(study_uid: str) -> bool:
    result = orthanc_post("/tools/find", {
        "Level": "Study",
        "Query": {
            "StudyInstanceUID": study_uid
        }
    })
    return isinstance(result, list) and len(result) > 0


def query_modality(modality: str) -> Optional[str]:
    payload = {
        "Level": "Study",
        "Query": {
            "StudyDate": date_query(),
            "PatientName": "",
            "PatientID": "",
            "AccessionNumber": "",
            "StudyInstanceUID": "",
            "StudyDescription": "",
            "ModalitiesInStudy": ""
        }
    }

    logging.info("Querying %s with StudyDate=%s", modality, payload["Query"]["StudyDate"])
    result = orthanc_post(f"/modalities/{modality}/query", payload)

    if not isinstance(result, dict) or "ID" not in result:
        logging.error("Query returned unexpected response for %s: %s", modality, result)
        return None

    return result["ID"]


def retrieve_answer(query_id: str, answer_id: str) -> bool:
    try:
        orthanc_post(f"/queries/{query_id}/answers/{answer_id}/retrieve", {"TargetAet": "ORTHANC2"})
        return True
    except Exception as e:
        logging.error("Retrieve submit failed query=%s answer=%s error=%s", query_id, answer_id, e)
        return False


def process_modality(modality: str):
    try:
        query_id = query_modality(modality)
        if not query_id:
            return

        answers = orthanc_get(f"/queries/{query_id}/answers")
        if not isinstance(answers, list):
            logging.error("Unexpected answers for %s: %s", modality, answers)
            return

        logging.info("%s returned %d studies", modality, len(answers))

        for answer_id in answers:
            content = orthanc_get(f"/queries/{query_id}/answers/{answer_id}/content")

            uid = get_tag(content, "0020,000D", "StudyInstanceUID")
            patient_name = get_tag(content, "0010,0010", "PatientName")
            patient_id = get_tag(content, "0010,0020", "PatientID")
            study_desc = get_tag(content, "0008,1030", "StudyDescription")
            accession = get_tag(content, "0008,0050", "AccessionNumber")

            if not uid:
                logging.warning("Skipping answer %s: no StudyInstanceUID", answer_id)
                continue

            if local_study_exists(uid):
                logging.info("Already present: %s | %s | %s", uid, patient_id, patient_name)
                continue

            logging.warning(
                "MISSING STUDY: pulling %s | Patient=%s %s | Accession=%s | Desc=%s",
                uid, patient_id, patient_name, accession, study_desc
            )

            if retrieve_answer(query_id, str(answer_id)):
                logging.warning("Retrieve job submitted for %s", uid)

    except Exception as e:
        logging.exception("Modality cycle failed for %s: %s", modality, e)


def run_once():
    try:
        system = orthanc_get("/system")
        logging.info(
            "Connected to Orthanc: Name=%s AET=%s Port=%s",
            system.get("Name"),
            system.get("DicomAet"),
            system.get("DicomPort"),
        )
    except Exception as e:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, e)
        return

    for m in MODALITIES:
        if m.get("enabled"):
            process_modality(m["name"])


def main():
    logging.info("Care Orthanc Phase 2 Auto Puller starting")
    logging.info("Polling every %s seconds", POLL_INTERVAL_SECONDS)
    while True:
        run_once()
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
