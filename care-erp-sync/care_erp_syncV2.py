#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc to ERP Sync Service  (v2)

Reads studies from Orthanc and posts them to the ERP radiology worklist.
Runs separately from Orthanc, so ERP failures do not affect PACS storage.

What changed vs v1 (and why USG / Voluson measurements now work):
  1. dicomMetadata is now sent as a JSON *string*. The ERP intake only accepts
     dicomMetadata when it is a string (it ignores an object), so the v1 dict was
     silently dropped — no measurement extraction ever ran.
  2. Modality is resolved from the study's series (v1 read RequestedTags, which is
     never populated by GET /studies/{id}, so every study defaulted to "MR" and no
     ultrasound study was recognised).
  3. For ULTRASOUND studies, the study's DICOM Structured Report is fetched via
     DICOMweb (the DICOM-JSON model the ERP's usgExtractor.parseDicomSr expects)
     and sent as dicomMetadata, so fetal biometry / Doppler auto-extracts on
     intake (pending radiologist review — never auto-finalized).
  4. Incremental: only STABLE studies are synced, and a study is skipped if its
     Orthanc LastUpdate hasn't changed since last sync (persisted to a small
     state file) — no more re-POSTing every study every cycle.

NOTE — avoid double-sync: the ERP also ships an in-process Orthanc poller. Run
ONE of the two. If you keep this script, set ORTHANC_CHANGES_POLLER=false in the
ERP environment. (Intake is idempotent, so running both isn't harmful — just
wasteful and confusing.)
"""

import datetime
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests


ORTHANC_URL = "http://care-orthanc:8042"
ORTHANC_USERNAME = ""
ORTHANC_PASSWORD = ""

ERP_BASE_URL = "http://172.16.1.139:8888"
ERP_INTERNAL_API_KEY = "1234"  # must equal the ERP INTERNAL_API_KEY (consider a stronger secret)

ERP_STUDY_ENDPOINT = "/api/internal/radiology/studies"
ERP_EVENT_ENDPOINT = "/api/internal/radiology/dicom-event"

POLL_INTERVAL_SECONDS = 300
ONLY_STABLE_STUDIES = True
STATE_FILE = "/app/care_erp_sync_state.json"  # remembers last-synced LastUpdate per study

# Ultrasound modality aliases (mirror of the ERP's usgModality list) — decides
# whether we bother fetching the SR for measurement extraction.
US_MODALITIES = {"US", "USG", "OB US", "OBUS", "DOPPLER", "US-DOPPLER"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def orthanc_auth():
    if ORTHANC_USERNAME and ORTHANC_PASSWORD:
        return (ORTHANC_USERNAME, ORTHANC_PASSWORD)
    return None


def orthanc_get(path: str) -> Any:
    r = requests.get(ORTHANC_URL.rstrip("/") + path, auth=orthanc_auth(), timeout=60)
    r.raise_for_status()
    return r.json()


def erp_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {ERP_INTERNAL_API_KEY}", "Content-Type": "application/json"}


def erp_post(path: str, payload: Dict[str, Any]) -> requests.Response:
    return requests.post(ERP_BASE_URL.rstrip("/") + path, json=payload, headers=erp_headers(), timeout=30)


def s(value: Any) -> str:
    return "" if value is None else str(value).strip()


# ── State (incremental sync) ────────────────────────────────────────────────

def load_state() -> Dict[str, str]:
    try:
        with open(STATE_FILE, "r") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(state: Dict[str, str]) -> None:
    try:
        with open(STATE_FILE, "w") as fh:
            json.dump(state, fh)
    except Exception as exc:
        logging.warning("Could not persist state: %s", exc)


# ── Modality resolution (series-based, reliable) ────────────────────────────

def resolve_modality(study_info: Dict[str, Any]) -> str:
    main = study_info.get("MainDicomTags", {}) or {}
    raw = s(main.get("ModalitiesInStudy"))
    if raw:
        parts = [p.strip().upper() for p in raw.replace(",", "\\").split("\\") if p.strip()]
        for m in parts:
            if m not in ("SR", "PR", "KO", "DOC", "OT"):
                return m
        if parts:
            return parts[0]
    # Fall back to the first non-report series' Modality.
    for sid in (study_info.get("Series", []) or [])[:8]:
        try:
            series = orthanc_get(f"/series/{sid}")
            m = s((series.get("MainDicomTags", {}) or {}).get("Modality")).upper()
            if m and m not in ("SR", "PR", "KO", "DOC", "OT"):
                return m
        except Exception:
            continue
    return "OT"


def is_ultrasound(modality: str) -> bool:
    m = (modality or "").upper()
    return m in US_MODALITIES or "US" in m or "DOPPLER" in m or "USG" in m


# ── SR fetch (DICOM-JSON via DICOMweb) for USG measurement extraction ───────

def fetch_sr_metadata(study_uid: str) -> Optional[Dict[str, Any]]:
    if not study_uid:
        return None
    try:
        arr = orthanc_get(f"/dicom-web/studies/{study_uid}/metadata")
        if not isinstance(arr, list):
            return None
        for inst in arr:
            modality = (inst.get("00080060", {}) or {}).get("Value", [""])
            if modality and str(modality[0]).upper() == "SR":
                return inst  # DICOM-JSON model with ContentSequence (0040A730) at root
    except Exception as exc:
        logging.warning("SR metadata fetch failed for %s: %s", study_uid, exc)
    return None


# ── Payload ─────────────────────────────────────────────────────────────────

def build_payload(study_id: str, study_info: Dict[str, Any], modality: str,
                  sr_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    main = study_info.get("MainDicomTags", {}) or {}
    patient = study_info.get("PatientMainDicomTags", {}) or {}

    study_uid = s(main.get("StudyInstanceUID"))
    accession = s(main.get("AccessionNumber"))  # may be empty for USG — UID is the identifier
    patient_id = s(patient.get("PatientID"))
    patient_name = s(patient.get("PatientName")) or "UNKNOWN"

    payload: Dict[str, Any] = {
        "studyInstanceUID": study_uid,
        "accessionNumber": accession,
        "patientId": patient_id,
        "patientName": patient_name,
        "sex": s(patient.get("PatientSex")),
        "modality": modality,
        "studyDescription": s(main.get("StudyDescription")),
        "studyDate": s(main.get("StudyDate")),
        "referringDoctor": s(main.get("ReferringPhysicianName")),
        "aeTitle": "ORTHANC2",
        "sourcePacs": "ORTHANC",
    }
    # dicomMetadata MUST be a JSON string; for USG send the SR so measurements
    # extract, otherwise leave it out.
    if sr_metadata is not None:
        payload["dicomMetadata"] = json.dumps(sr_metadata)
    return payload


def post_study_to_erp(payload: Dict[str, Any]) -> bool:
    uid = payload.get("studyInstanceUID")
    try:
        r = erp_post(ERP_STUDY_ENDPOINT, payload)
        logging.info("ERP study POST uid=%s status=%s body=%s", uid, r.status_code, r.text[:300])
        if not r.ok:
            return False
        evt = {
            "eventType": "ORTHANC_SYNCED_TO_ERP",
            "studyInstanceUID": uid,
            "accessionNumber": payload.get("accessionNumber"),
            "patientId": payload.get("patientId"),
            "modality": payload.get("modality"),
            "message": "Study synced from Orthanc to ERP",
            "sourcePacs": "Orthanc",
            "sourceAeTitle": "ORTHANC2",
        }
        er = erp_post(ERP_EVENT_ENDPOINT, evt)
        logging.info("ERP event POST uid=%s status=%s", uid, er.status_code)
        return True
    except Exception as exc:
        logging.exception("ERP POST failed uid=%s error=%s", uid, exc)
        return False


# ── Sync cycle ──────────────────────────────────────────────────────────────

def sync_once(state: Dict[str, str]) -> None:
    logging.info("CARE ERP SYNC: cycle started")
    try:
        system = orthanc_get("/system")
        logging.info("Connected to Orthanc: Name=%s AET=%s", system.get("Name"), system.get("DicomAet"))
    except Exception as exc:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, exc)
        return

    try:
        studies: List[str] = orthanc_get("/studies")
    except Exception as exc:
        logging.error("Cannot list Orthanc studies: %s", exc)
        return

    logging.info("Orthanc has %d studies", len(studies))
    synced = skipped = failed = 0

    for study_id in studies:
        try:
            info = orthanc_get(f"/studies/{study_id}")
            if ONLY_STABLE_STUDIES and not info.get("IsStable", True):
                skipped += 1
                continue
            # Skip unchanged studies (incremental).
            last_update = s(info.get("LastUpdate"))
            if state.get(study_id) == last_update and last_update:
                skipped += 1
                continue

            modality = resolve_modality(info)
            study_uid = s((info.get("MainDicomTags", {}) or {}).get("StudyInstanceUID"))
            sr_metadata = fetch_sr_metadata(study_uid) if is_ultrasound(modality) else None
            if is_ultrasound(modality) and sr_metadata is None:
                logging.info("USG study %s has no SR — intake will fall back to OCR", study_uid)

            payload = build_payload(study_id, info, modality, sr_metadata)
            if post_study_to_erp(payload):
                synced += 1
                if last_update:
                    state[study_id] = last_update
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            logging.exception("Failed processing Orthanc study %s: %s", study_id, exc)

    save_state(state)
    logging.info("CARE ERP SYNC: cycle finished synced=%d skipped=%d failed=%d", synced, skipped, failed)


def main() -> None:
    logging.info("Care Orthanc ERP Sync v2 starting — ERP target: %s", ERP_BASE_URL)
    logging.info("Polling every %s seconds", POLL_INTERVAL_SECONDS)
    state = load_state()
    while True:
        sync_once(state)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
