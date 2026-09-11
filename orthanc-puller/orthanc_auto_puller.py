#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc Auto Puller v2
Fair MRI/CT scheduling + restart-safe job tracking.

Behavior:
- Queries UIH MRI and CT only.
- Searches recent StudyDate window (LOOKBACK_DAYS=1).
- X-ray / FILMPLUS Query-Retrieve stays disabled; direct C-STORE unaffected.
- Uses asynchronous C-MOVE to ORTHANC2.
- Never intentionally exceeds MAX_ACTIVE_RETRIEVALS (default 3).
- Alternates MRI and CT so one modality cannot permanently monopolize all slots.
- Persists puller-submitted Orthanc job IDs + StudyInstanceUIDs to disk.
- Reconciles persisted jobs against Orthanc /jobs at startup.
- Conservatively counts other active Orthanc jobs against the concurrency ceiling.
- Prevents duplicate submission of a tracked StudyInstanceUID.
"""

import datetime
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

ORTHANC_URL = os.getenv("ORTHANC_URL", "http://care-orthanc:8042")
ORTHANC_USERNAME = os.getenv("ORTHANC_USERNAME", "")
ORTHANC_PASSWORD = os.getenv("ORTHANC_PASSWORD", "")

POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "1"))
JOB_POLL_SECONDS = int(os.getenv("JOB_POLL_SECONDS", "5"))
MAX_ACTIVE_RETRIEVALS = int(os.getenv("MAX_ACTIVE_RETRIEVALS", "3"))

STATE_FILE = Path(os.getenv("PULLER_STATE_FILE", "/app/puller_state.json"))

MODALITIES = [
    {"name": "UIH_MRI", "enabled": True},
    {"name": "CT_MACHINE", "enabled": True},
    {"name": "XRAY_1", "enabled": False},
    {"name": "XRAY_2", "enabled": False},
    {"name": "XRAY_3", "enabled": False},
    {"name": "XRAY_4", "enabled": False},
]

TERMINAL_STATES = {"SUCCESS", "COMPLETED", "FAILURE", "FAILED", "CANCELED", "CANCELLED"}
SUCCESS_STATES = {"SUCCESS", "COMPLETED"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

PENDING_JOBS: Dict[str, Dict[str, str]] = {}
ROUND_ROBIN_START = 0


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


def save_state() -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(STATE_FILE.suffix + ".tmp")
        tmp.write_text(
            json.dumps({"pending_jobs": PENDING_JOBS}, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        tmp.replace(STATE_FILE)
    except Exception as e:
        logging.error("Could not persist puller state to %s: %s", STATE_FILE, e)


def load_state() -> None:
    global PENDING_JOBS
    if not STATE_FILE.exists():
        logging.info("No previous puller state file found at %s", STATE_FILE)
        return
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        jobs = data.get("pending_jobs", {})
        if isinstance(jobs, dict):
            PENDING_JOBS = {
                str(job_id): meta
                for job_id, meta in jobs.items()
                if isinstance(meta, dict)
            }
            logging.info("Loaded %d tracked job(s) from %s", len(PENDING_JOBS), STATE_FILE)
    except Exception as e:
        logging.error("Could not read puller state %s: %s", STATE_FILE, e)


def job_status_text(job: Dict[str, Any]) -> str:
    return str(job.get("State") or job.get("Status") or "").strip()


def job_error_text(job: Dict[str, Any]) -> str:
    for key in ("ErrorDescription", "ErrorCode", "Content", "Message"):
        value = job.get(key)
        if value not in (None, "", {}):
            return str(value)
    return ""


def orthanc_job_ids() -> List[str]:
    jobs = orthanc_get("/jobs", timeout=15)
    if not isinstance(jobs, list):
        return []
    return [str(j) for j in jobs]


def active_orthanc_jobs() -> Set[str]:
    active: Set[str] = set()
    try:
        for job_id in orthanc_job_ids():
            try:
                job = orthanc_get(f"/jobs/{job_id}", timeout=10)
                if not isinstance(job, dict):
                    continue
                state = job_status_text(job).upper()
                if state not in TERMINAL_STATES:
                    active.add(job_id)
            except Exception as e:
                logging.warning("Could not inspect Orthanc job %s: %s", job_id, e)
    except Exception as e:
        logging.warning("Could not enumerate Orthanc jobs: %s", e)
    return active


def local_study_exists(study_uid: str) -> bool:
    result = orthanc_post(
        "/tools/find",
        {"Level": "Study", "Query": {"StudyInstanceUID": study_uid}},
        timeout=15,
    )
    return isinstance(result, list) and bool(result)


def reconcile_state_with_orthanc() -> None:
    if not PENDING_JOBS:
        return
    changed = False
    for job_id, metadata in list(PENDING_JOBS.items()):
        try:
            job = orthanc_get(f"/jobs/{job_id}", timeout=15)
            if not isinstance(job, dict):
                continue
            state = job_status_text(job).upper()
            if state in TERMINAL_STATES:
                if state in SUCCESS_STATES:
                    present = False
                    uid = metadata.get("uid", "")
                    if uid:
                        try:
                            present = local_study_exists(uid)
                        except Exception:
                            pass
                    logging.warning(
                        "RECOVERED TERMINAL JOB: Job=%s State=%s UID=%s StudyPresent=%s",
                        job_id, state, uid, present,
                    )
                else:
                    logging.error(
                        "RECOVERED FAILED JOB: Job=%s State=%s UID=%s Error=%s",
                        job_id, state, metadata.get("uid", ""), job_error_text(job),
                    )
                PENDING_JOBS.pop(job_id, None)
                changed = True
        except requests.HTTPError as e:
            if getattr(e.response, "status_code", None) == 404:
                logging.warning(
                    "Persisted job no longer exists in Orthanc: Job=%s UID=%s",
                    job_id, metadata.get("uid", ""),
                )
                PENDING_JOBS.pop(job_id, None)
                changed = True
        except Exception as e:
            logging.warning("Could not reconcile Orthanc Job=%s: %s", job_id, e)
    if changed:
        save_state()


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


def pending_uids() -> Set[str]:
    return {
        str(meta.get("uid", ""))
        for meta in PENDING_JOBS.values()
        if meta.get("uid")
    }


def available_slots() -> int:
    active = active_orthanc_jobs()
    effective = active.union(PENDING_JOBS.keys())
    slots = max(0, MAX_ACTIVE_RETRIEVALS - len(effective))
    logging.info(
        "Job capacity: OrthancActive=%d PullerTracked=%d EffectiveActive=%d Max=%d Free=%d",
        len(active), len(PENDING_JOBS), len(effective), MAX_ACTIVE_RETRIEVALS, slots,
    )
    return slots


def collect_missing_candidates(modality: str) -> List[Tuple[str, str, Dict[str, str]]]:
    candidates: List[Tuple[str, str, Dict[str, str]]] = []
    try:
        query_id = query_modality(modality)
        if not query_id:
            return candidates
        answers = orthanc_get(f"/queries/{query_id}/answers", timeout=30)
        if not isinstance(answers, list):
            logging.error("Unexpected answers for %s: %s", modality, answers)
            return candidates
        logging.info("%s returned %d studies", modality, len(answers))
        already_pending = pending_uids()

        for answer_id in answers:
            content = orthanc_get(
                f"/queries/{query_id}/answers/{answer_id}/content",
                timeout=15,
            )
            uid = get_tag(content, "0020,000D", "StudyInstanceUID")
            patient_name = get_tag(content, "0010,0010", "PatientName")
            patient_id = get_tag(content, "0010,0020", "PatientID")
            study_desc = get_tag(content, "0008,1030", "StudyDescription")
            accession = get_tag(content, "0008,0050", "AccessionNumber")

            if not uid:
                continue
            if uid in already_pending:
                continue
            if local_study_exists(uid):
                continue

            candidates.append((
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
            ))
    except Exception as e:
        logging.exception("Candidate collection failed for %s: %s", modality, e)
    return candidates


def submit_retrieve(query_id: str, answer_id: str, metadata: Dict[str, str]) -> Optional[str]:
    uid = metadata.get("uid", "")
    if uid and uid in pending_uids():
        logging.info("Duplicate submission blocked: UID=%s", uid)
        return None
    if available_slots() <= 0:
        logging.info("No retrieval slot available; deferring UID=%s", uid)
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
            save_state()
            logging.warning(
                "ASYNC RETRIEVE SUBMITTED: UID=%s | Patient=%s %s | Modality=%s | Job=%s",
                uid,
                metadata.get("patient_id", ""),
                metadata.get("patient_name", ""),
                metadata.get("modality", ""),
                job_id,
            )
            return job_id
    except Exception as e:
        logging.error(
            "Retrieve submit failed query=%s answer=%s UID=%s error=%s",
            query_id, answer_id, uid, e,
        )
    return None


def check_pending_jobs() -> None:
    if not PENDING_JOBS:
        return
    completed: List[str] = []
    for job_id, metadata in list(PENDING_JOBS.items()):
        try:
            job = orthanc_get(f"/jobs/{job_id}", timeout=15)
            if not isinstance(job, dict):
                continue
            state = job_status_text(job)
            state_upper = state.upper()

            if state_upper in SUCCESS_STATES:
                study_present = False
                try:
                    study_present = local_study_exists(metadata.get("uid", ""))
                except Exception:
                    pass
                logging.warning(
                    "RETRIEVE SUCCESS: UID=%s | Modality=%s | Job=%s | StudyPresent=%s",
                    metadata.get("uid", ""),
                    metadata.get("modality", ""),
                    job_id,
                    study_present,
                )
                completed.append(job_id)
            elif state_upper in TERMINAL_STATES:
                logging.error(
                    "RETRIEVE FAILED: UID=%s | Modality=%s | Job=%s | State=%s | Error=%s",
                    metadata.get("uid", ""),
                    metadata.get("modality", ""),
                    job_id,
                    state,
                    job_error_text(job),
                )
                completed.append(job_id)
        except requests.HTTPError as e:
            if getattr(e.response, "status_code", None) == 404:
                logging.error(
                    "RETRIEVE JOB LOST: UID=%s | Modality=%s | Job=%s",
                    metadata.get("uid", ""),
                    metadata.get("modality", ""),
                    job_id,
                )
                completed.append(job_id)
        except Exception as e:
            logging.warning("Could not check Orthanc Job=%s error=%s", job_id, e)

    if completed:
        for job_id in completed:
            PENDING_JOBS.pop(job_id, None)
        save_state()


def fair_schedule_once() -> None:
    global ROUND_ROBIN_START

    enabled = [m["name"] for m in MODALITIES if m.get("enabled")]
    if not enabled:
        return

    candidate_map: Dict[str, List[Tuple[str, str, Dict[str, str]]]] = {}
    for modality in enabled:
        candidate_map[modality] = collect_missing_candidates(modality)

    order = enabled[ROUND_ROBIN_START:] + enabled[:ROUND_ROBIN_START]
    ROUND_ROBIN_START = (ROUND_ROBIN_START + 1) % len(enabled)
    indexes = {m: 0 for m in enabled}

    while available_slots() > 0:
        progress = False
        for modality in order:
            if available_slots() <= 0:
                break

            candidates = candidate_map.get(modality, [])
            idx = indexes[modality]
            if idx >= len(candidates):
                continue

            query_id, answer_id, metadata = candidates[idx]
            indexes[modality] += 1

            uid = metadata.get("uid", "")
            try:
                if uid and local_study_exists(uid):
                    logging.info("Arrived before submit; skipping UID=%s", uid)
                    progress = True
                    continue
            except Exception:
                pass

            if submit_retrieve(query_id, answer_id, metadata):
                progress = True

        if not progress:
            break


def run_once() -> None:
    try:
        system = orthanc_get("/system", timeout=15)
        logging.info(
            "Connected to Orthanc: Name=%s AET=%s Port=%s",
            system.get("Name"), system.get("DicomAet"), system.get("DicomPort"),
        )
    except Exception as e:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, e)
        return

    check_pending_jobs()
    fair_schedule_once()
    check_pending_jobs()


def main() -> None:
    logging.info("Care Orthanc Auto Puller v2 starting")
    logging.info(
        "Polling every %s seconds; max active retrievals=%s; enabled modalities=%s",
        POLL_INTERVAL_SECONDS,
        MAX_ACTIVE_RETRIEVALS,
        ", ".join(m["name"] for m in MODALITIES if m.get("enabled")),
    )
    logging.info("Persistent state file: %s", STATE_FILE)

    load_state()

    try:
        orthanc_get("/system", timeout=15)
        reconcile_state_with_orthanc()
        active = active_orthanc_jobs()
        if active:
            logging.warning(
                "Startup detected %d active Orthanc job(s); they count against the %d-job ceiling",
                len(active), MAX_ACTIVE_RETRIEVALS,
            )
    except Exception as e:
        logging.warning("Startup job reconciliation deferred: %s", e)

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
