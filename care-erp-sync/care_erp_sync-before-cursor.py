#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc to ERP Sync Service  (v3 — /changes based)

Reads studies from Orthanc and posts them to the ERP radiology worklist.
Runs separately from Orthanc, so ERP failures do not affect PACS storage.

v3 vs v2 — scales to a large archive:
  Instead of listing ALL studies every cycle, this drains Orthanc's /changes
  feed and only processes studies that just became STABLE, persisting the last
  processed change sequence. First run drains the whole history (one-time
  backfill of existing studies), then each cycle only touches new studies.

Still included from v2 (the fixes that make USG / Voluson measurements work):
  - dicomMetadata is sent as a JSON *string* (the ERP intake ignores an object).
  - Modality is resolved from the study's series (not the never-populated
    RequestedTags), so ultrasound studies are recognised as "US".
  - For ultrasound studies the DICOM Structured Report is fetched via DICOMweb
    (the DICOM-JSON model the ERP's usgExtractor.parseDicomSr expects) and sent
    as dicomMetadata, so fetal biometry / Doppler auto-extract on intake
    (pending radiologist review — never auto-finalized).

Intake is idempotent (upsert on StudyInstanceUID), so re-processing a change is
harmless.

AVOID DOUBLE-SYNC: the ERP also ships an in-process Orthanc poller doing the same
job. Run ONE. If you keep this script, set ORTHANC_CHANGES_POLLER=false in the
ERP environment.
"""

import json
import logging
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

POLL_INTERVAL_SECONDS = 60          # can be low now — each cycle is cheap
CHANGES_PAGE_LIMIT = 100
MAX_PAGES_PER_CYCLE = 100           # backstop so a huge first backfill can't run forever in one cycle
STATE_FILE = "/app/care_erp_sync_state.json"  # remembers the last processed /changes sequence

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


# ── State: last processed /changes sequence ─────────────────────────────────

def load_since() -> int:
    try:
        with open(STATE_FILE, "r") as fh:
            data = json.load(fh)
            v = int(data.get("since", 0))
            return v if v >= 0 else 0
    except Exception:
        return 0


def save_since(seq: int) -> None:
    try:
        with open(STATE_FILE, "w") as fh:
            json.dump({"since": seq}, fh)
    except Exception as exc:
        logging.warning("Could not persist cursor: %s", exc)


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


# ── Payload + post ──────────────────────────────────────────────────────────

def build_payload(study_info: Dict[str, Any], modality: str,
                  sr_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    main = study_info.get("MainDicomTags", {}) or {}
    patient = study_info.get("PatientMainDicomTags", {}) or {}

    payload: Dict[str, Any] = {
        "studyInstanceUID": s(main.get("StudyInstanceUID")),
        "accessionNumber": s(main.get("AccessionNumber")),  # may be empty for USG — UID is the identifier
        "patientId": s(patient.get("PatientID")),
        "patientName": s(patient.get("PatientName")) or "UNKNOWN",
        "sex": s(patient.get("PatientSex")),
        "modality": modality,
        "studyDescription": s(main.get("StudyDescription")),
        "studyDate": s(main.get("StudyDate")),
        "referringDoctor": s(main.get("ReferringPhysicianName")),
        "aeTitle": "ORTHANC2",
        "sourcePacs": "ORTHANC",
    }
    if sr_metadata is not None:
        payload["dicomMetadata"] = json.dumps(sr_metadata)  # MUST be a string
    return payload


# Returns one of: "ok" (synced), "rejected" (ERP responded with an error — a bad
# study we should NOT retry forever), or "unreachable" (ERP down / network — we
# must NOT advance the cursor past this study, so the next cycle retries it).
def post_study_to_erp(payload: Dict[str, Any]) -> str:
    uid = payload.get("studyInstanceUID")
    try:
        r = erp_post(ERP_STUDY_ENDPOINT, payload)
        logging.info("ERP study POST uid=%s modality=%s status=%s body=%s",
                     uid, payload.get("modality"), r.status_code, r.text[:300])
        if not r.ok:
            return "rejected"
        erp_post(ERP_EVENT_ENDPOINT, {
            "eventType": "ORTHANC_SYNCED_TO_ERP",
            "studyInstanceUID": uid,
            "accessionNumber": payload.get("accessionNumber"),
            "patientId": payload.get("patientId"),
            "modality": payload.get("modality"),
            "message": "Study synced from Orthanc to ERP",
            "sourcePacs": "Orthanc",
            "sourceAeTitle": "ORTHANC2",
        })
        return "ok"
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
        logging.error("ERP unreachable uid=%s: %s", uid, exc)
        return "unreachable"
    except Exception as exc:
        logging.exception("ERP POST failed uid=%s error=%s", uid, exc)
        return "rejected"


def process_study(orthanc_study_id: str) -> str:
    try:
        info = orthanc_get(f"/studies/{orthanc_study_id}")
    except Exception as exc:
        logging.warning("Study %s not retrievable (deleted?): %s", orthanc_study_id, exc)
        return "rejected"
    modality = resolve_modality(info)
    study_uid = s((info.get("MainDicomTags", {}) or {}).get("StudyInstanceUID"))
    sr = fetch_sr_metadata(study_uid) if is_ultrasound(modality) else None
    if is_ultrasound(modality) and sr is None:
        logging.info("USG study %s has no SR — intake will fall back to OCR", study_uid)
    return post_study_to_erp(build_payload(info, modality, sr))


# ── /changes drain ──────────────────────────────────────────────────────────

def sync_once() -> None:
    try:
        system = orthanc_get("/system")
        logging.info("Connected to Orthanc: Name=%s AET=%s", system.get("Name"), system.get("DicomAet"))
    except Exception as exc:
        logging.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, exc)
        return

    since = load_since()
    # Highest sequence we've fully handled (synced or ERP-rejected). We only ever
    # persist up to here, so a study we couldn't DELIVER (ERP down) is retried.
    handled_seq = since
    synced = rejected = 0

    for _ in range(MAX_PAGES_PER_CYCLE):
        try:
            page = orthanc_get(f"/changes?since={since}&limit={CHANGES_PAGE_LIMIT}")
        except Exception as exc:
            logging.error("Cannot read /changes since=%s: %s", since, exc)
            break
        changes: List[Dict[str, Any]] = page.get("Changes", []) if isinstance(page, dict) else []
        for ch in changes:
            seq = ch.get("Seq")
            if ch.get("ChangeType") == "StableStudy" and ch.get("ID"):
                result = process_study(ch["ID"])
                if result == "unreachable":
                    # Pause: persist only up to the last fully-handled change and
                    # retry from there next cycle — never skip an undelivered study.
                    save_since(handled_seq)
                    logging.warning("ERP unreachable — pausing sync at cursor %d (will retry)", handled_seq)
                    return
                if result == "ok":
                    synced += 1
                else:
                    rejected += 1
            if isinstance(seq, int):
                handled_seq = seq
        last = page.get("Last", since)
        if isinstance(last, int):
            since = last
        save_since(since)
        handled_seq = since
        if page.get("Done", True):
            break

    if synced or rejected:
        logging.info("CARE ERP SYNC: cycle done synced=%d rejected=%d cursor=%d", synced, rejected, since)


def main() -> None:
    logging.info("Care Orthanc ERP Sync v3 (/changes) starting — ERP target: %s", ERP_BASE_URL)
    logging.info("Polling every %s seconds; first run backfills from cursor 0", POLL_INTERVAL_SECONDS)
    while True:
        sync_once()
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
