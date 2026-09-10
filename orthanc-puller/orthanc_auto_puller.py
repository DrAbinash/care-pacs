#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc Auto Puller with async job monitoring and concurrency limit

Behavior:
- Queries UIH MRI and CT every 5 minutes.
- Searches only the recent date window (LOOKBACK_DAYS=1).
- Detects missing studies.
- Submits C-MOVE retrievals asynchronously to Orthanc.
- Limits active retrieval jobs to MAX_ACTIVE_RETRIEVALS (default 3).
- Tracks Orthanc jobs and logs RETRIEVE SUCCESS / RETRIEVE FAILED.
- X-ray / FILMPLUS Query-Retrieve remains disabled (direct C-STORE unaffected).
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
JOB_POLL_SECONDS = 5
MAX_ACTIVE_RETRIEVALS = 3

MODALITIES = [
    {"name": "UIH_MRI", "enabled": True},
    {"name": "CT_MACHINE", "enabled": True},
    {"name": "XRAY_1", "enabled": False},
    {"name": "XRAY_2", "enabled": False},
    {"name": "XRAY_3", "enabled": False},
    {"name": "XRAY_4", "enabled": False},
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# In-memory tracking of jobs submitted by this process.
PENDING_JOBS: Dict[str, Dict[str, str]] = {}


def auth():
    if ORTHANC_USERNAME and ORTHANC_PASSWORD:
        return (ORTHANC_USERNAME, ORTHANC_PASSWORD)
    return None


def orthanc_get(path: str, timeout: int = 30) -> Any:
    r = requests.get(ORTHANC_URL.rstrip("/") + path, auth=auth(), timeout=timeout)
    r.raise_for_status()
    return r.json()


def orthanc_post(path: str, payload: Dict[str, Any], timeout: int = 30) -> Any:
    r = requests.post(
        ORTHANC_URL.rstrip("/") + path,
        json=payload,
        auth=auth(),
        timeout=timeout,
    )
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
    if tag.lower() in content:
        return extract_value(content[tag.lower()])
    return ""


def local_study_exists(study_uid: str) -> bool:
    # Deliberately no Expand: this is an index lookup only.
    result = orthanc_post(
        "/tools/find",
        {"Level": "Study", "Query": {"StudyInstanceUID": study_uid}},
        timeout=15,
    )
    return isinstance(result, list) and bool(result)


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
            "ModalitiesInStudy": "",
        },
    }
    logging.info("Querying %s with StudyDate=%s", modality, payload["Query"]["StudyDate"])
    result = orthanc_post(f"/modalities/{modality}/query", payload, timeout=30)
    if not isinstance(result, dict) or "ID" not in result:
        logging.error("Query returned unexpected response for %s: %s", modality, result)
        return None
    return str(result["ID"])


def retrieve_answer(query_id: str, answer_id: str, metadata: Dict[str, str]) -> Optional[str]:
    if len(PENDING_JOBS) >= MAX_ACTIVE_RETRIEVALS:
        return None

    payload = {
        "TargetAet": "ORTHANC2",
        "RetrieveMethod": "C-MOVE",
        "Synchronous": False,
    }
    try:
        result = orthanc_post(
            f"/queries/{query_id}/answers/{answer_id}/retrieve",
            payload,
            timeout=30,
        )
        if isinstance(result, dict) and result.get("ID"):
            job_id = str(result["ID"])
            PENDING_JOBS[job_id] = metadata
            logging.warning(
                "ASYNC RETRIEVE SUBMITTED: %s | Patient=%s %s | Modality=%s | Job=%s | Active=%d/%d",
                metadata.get("uid", ""), metadata.get("patient_id", ""),
                metadata.get("patient_name", ""), metadata.get("modality", ""),
                job_id, len(PENDING_JOBS), MAX_ACTIVE_RETRIEVALS,
            )
            return job_id
        logging.warning("Async retrieve accepted but no Job ID returned query=%s answer=%s response=%s",
                        query_id, answer_id, result)
    except Exception as e:
        logging.error("Retrieve submit failed query=%s answer=%s error=%s", query_id, answer_id, e)
    return None


def job_status_text(job: Dict[str, Any]) -> str:
    return str(job.get("State") or job.get("Status") or "").strip()


def job_error_text(job: Dict[str, Any]) -> str:
    for key in ("ErrorDescription", "ErrorCode", "Content", "Message"):
        value = job.get(key)
        if value not in (None, "", {}):
            return str(value)
    return ""


def check_pending_jobs():
    if not PENDING_JOBS:
        return
    completed = []
    for job_id, metadata in list(PENDING_JOBS.items()):
        try:
            job = orthanc_get(f"/jobs/{job_id}", timeout=15)
            if not isinstance(job, dict):
                continue
            state = job_status_text(job)
            state_upper = state.upper()
            if state_upper in ("SUCCESS", "COMPLETED"):
                study_present = False
                try:
                    study_present = local_study_exists(metadata.get("uid", ""))
                except Exception as e:
                    logging.warning("Job succeeded but study verification failed Job=%s UID=%s error=%s",
                                    job_id, metadata.get("uid", ""), e)
                logging.warning(
                    "RETRIEVE SUCCESS: %s | Patient=%s %s | Modality=%s | Job=%s | StudyPresent=%s",
                    metadata.get("uid", ""), metadata.get("patient_id", ""),
                    metadata.get("patient_name", ""), metadata.get("modality", ""),
                    job_id, study_present,
                )
                completed.append(job_id)
            elif state_upper in ("FAILURE", "FAILED", "CANCELED", "CANCELLED"):
                logging.error(
                    "RETRIEVE FAILED: %s | Patient=%s %s | Modality=%s | Job=%s | State=%s | Error=%s",
                    metadata.get("uid", ""), metadata.get("patient_id", ""),
                    metadata.get("patient_name", ""), metadata.get("modality", ""),
                    job_id, state, job_error_text(job),
                )
                completed.append(job_id)
            else:
                logging.info("RETRIEVE RUNNING: %s | Modality=%s | Job=%s | State=%s | Active=%d/%d",
                             metadata.get("uid", ""), metadata.get("modality", ""), job_id,
                             state or "unknown", len(PENDING_JOBS), MAX_ACTIVE_RETRIEVALS)
        except requests.HTTPError as e:
            if getattr(e.response, "status_code", None) == 404:
                logging.error("RETRIEVE JOB LOST: %s | Modality=%s | Job=%s",
                              metadata.get("uid", ""), metadata.get("modality", ""), job_id)
                completed.append(job_id)
            else:
                logging.warning("Could not read Orthanc Job=%s error=%s", job_id, e)
        except Exception as e:
            logging.warning("Could not check Orthanc Job=%s error=%s", job_id, e)

    for job_id in completed:
        PENDING_JOBS.pop(job_id, None)


def process_modality(modality: str):
    try:
        if len(PENDING_JOBS) >= MAX_ACTIVE_RETRIEVALS:
            logging.info("Concurrency limit reached (%d/%d); deferring %s",
                         len(PENDING_JOBS), MAX_ACTIVE_RETRIEVALS, modality)
            return

        query_id = query_modality(modality)
        if not query_id:
            return

        answers = orthanc_get(f"/queries/{query_id}/answers", timeout=30)
        if not isinstance(answers, list):
            logging.error("Unexpected answers for %s: %s", modality, answers)
            return

        logging.info("%s returned %d studies", modality, len(answers))

        for answer_id in answers:
            # Never flood Orthanc's job queue. Remaining studies wait for next cycle.
            if len(PENDING_JOBS) >= MAX_ACTIVE_RETRIEVALS:
                logging.info("Concurrency limit reached (%d/%d); remaining %s studies deferred",
                             len(PENDING_JOBS), MAX_ACTIVE_RETRIEVALS, modality)
                break

            content = orthanc_get(f"/queries/{query_id}/answers/{answer_id}/content", timeout=15)
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

            if any(j.get("uid") == uid for j in PENDING_JOBS.values()):
                logging.info("Retrieve already pending: %s | %s | %s", uid, patient_id, patient_name)
                continue

            logging.warning("MISSING STUDY: pulling %s | Patient=%s %s | Accession=%s | Desc=%s",
                            uid, patient_id, patient_name, accession, study_desc)
            retrieve_answer(
                query_id,
                str(answer_id),
                {
                    "uid": uid,
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "study_desc": study_desc,
                    "accession": accession,
                    "modality": modality,
                },
            )
    except Exception as e:
        logging.exception("Modality cycle failed for %s: %s", modality, e)


def run_once():
    try:
        system = orthanc_get("/system", timeout=15)
        logging.info("Connected to Orthanc: Name=%s AET=%s Port=%s",
                     system.get("Name"), system.get("DicomAet"), system.get("DicomPort"))
    except Exception as e:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, e)
        return

    check_pending_jobs()
    for modality in MODALITIES:
        if modality.get("enabled"):
            check_pending_jobs()
            process_modality(modality["name"])
    check_pending_jobs()


def main():
    logging.info("Care Orthanc Auto Puller with job monitoring + concurrency limit starting")
    logging.info("Polling every %s seconds; max active retrievals=%s; enabled modalities=%s",
                 POLL_INTERVAL_SECONDS, MAX_ACTIVE_RETRIEVALS,
                 ", ".join(m["name"] for m in MODALITIES if m.get("enabled")))

    while True:
        run_once()
        slept = 0
        while slept < POLL_INTERVAL_SECONDS:
            time.sleep(JOB_POLL_SECONDS)
            slept += JOB_POLL_SECONDS
            if PENDING_JOBS:
                check_pending_jobs()


if __name__ == "__main__":
    main()
