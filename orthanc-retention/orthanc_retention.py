#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc rolling-study retention

Policy:
- Do nothing at <= CLEANUP_TRIGGER studies (default 520).
- Once above trigger, delete the oldest studies until KEEP_STUDIES remain (default 500).
- "Oldest" means Orthanc LastUpdate (arrival/update time), not DICOM StudyDate.
- Never delete a study updated within the last MIN_STUDY_AGE_MINUTES (default 60).
- Check every CHECK_INTERVAL_SECONDS (default 300).

Gated by Care ERP:
- GET /api/internal/radiology/retention-policy (Bearer INTERNAL_API_KEY)
- When enabled=false (default), this sidecar sleeps without deleting.
- After Orthanc DELETE, POST /api/internal/radiology/purge-reconcile with StudyInstanceUIDs
  so ERP scrubbing matches the Orthanc purge UI cascade.

Orthanc is a short-term working PACS/cache, not the permanent archive.
"""

import datetime as dt
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

ORTHANC_URL = os.getenv("ORTHANC_URL", "http://care-orthanc:8042").rstrip("/")
KEEP_STUDIES = int(os.getenv("KEEP_STUDIES", "500"))
CLEANUP_TRIGGER = int(os.getenv("CLEANUP_TRIGGER", "520"))
CHECK_INTERVAL_SECONDS = int(os.getenv("CHECK_INTERVAL_SECONDS", "300"))
MIN_STUDY_AGE_MINUTES = int(os.getenv("MIN_STUDY_AGE_MINUTES", "60"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))

ERP_BASE_URL = os.getenv("ERP_BASE_URL", "http://172.16.1.139:8888").rstrip("/")
ERP_ALT_BASE_URLS = tuple(
    u.strip().rstrip("/")
    for u in os.getenv("ERP_ALT_BASE_URLS", "http://192.168.1.137:8888").split(",")
    if u.strip()
)
ERP_INTERNAL_API_KEY = os.getenv("ERP_INTERNAL_API_KEY", "1234")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

session = requests.Session()


def get_json(path: str) -> Any:
    r = session.get(ORTHANC_URL + path, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.json()


def delete(path: str) -> None:
    r = session.delete(ORTHANC_URL + path, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()


def erp_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {ERP_INTERNAL_API_KEY}",
        "Content-Type": "application/json",
    }


def erp_bases() -> List[str]:
    bases = [ERP_BASE_URL]
    for alt in ERP_ALT_BASE_URLS:
        if alt and alt not in bases:
            bases.append(alt)
    return bases


def fetch_retention_policy() -> Dict[str, Any]:
    """Return ERP policy; fail closed (enabled=False) on errors."""
    last_err: Optional[Exception] = None
    for base in erp_bases():
        try:
            r = session.get(
                f"{base}/api/internal/radiology/retention-policy",
                headers=erp_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, dict):
                    return data
            last_err = RuntimeError(f"HTTP {r.status_code} from {base}")
        except Exception as e:
            last_err = e
    logging.warning("Could not read ERP retention policy (%s) — treating as disabled", last_err)
    return {"enabled": False}


def reconcile_erp(uids: List[str]) -> None:
    if not uids:
        return
    last_err: Optional[Exception] = None
    for base in erp_bases():
        try:
            r = session.post(
                f"{base}/api/internal/radiology/purge-reconcile",
                headers=erp_headers(),
                json={"studyInstanceUIDs": uids},
                timeout=max(REQUEST_TIMEOUT, 60),
            )
            if r.status_code < 300:
                logging.info("ERP reconcile OK for %d UIDs via %s", len(uids), base)
                return
            last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as e:
            last_err = e
    logging.error("ERP reconcile failed for %d UIDs: %s", len(uids), last_err)


def parse_last_update(value: str) -> Optional[dt.datetime]:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y%m%dT%H%M%S.%f", "%Y%m%dT%H%M%S"):
        try:
            return dt.datetime.strptime(value, fmt)
        except ValueError:
            pass
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def study_meta(study_id: str) -> Optional[Tuple[dt.datetime, str, str]]:
    """Return (last_update, study_id, study_instance_uid) or None."""
    info = get_json(f"/studies/{study_id}")
    parsed = parse_last_update(str(info.get("LastUpdate", "")))
    if parsed is None:
        logging.warning("Skipping study %s: LastUpdate missing/unparseable", study_id)
        return None
    mt = info.get("MainDicomTags") or {}
    uid = str(mt.get("StudyInstanceUID") or "").strip()
    return parsed, study_id, uid


def cleanup_once(keep_studies: int, cleanup_trigger: int) -> None:
    ids = get_json("/studies")
    if not isinstance(ids, list):
        logging.error("Unexpected /studies response: %r", ids)
        return

    count = len(ids)
    if count <= cleanup_trigger:
        logging.info(
            "Retention OK: %d studies (trigger=%d, target=%d)",
            count, cleanup_trigger, keep_studies,
        )
        return

    logging.warning("Retention cleanup starting: %d studies; target=%d", count, keep_studies)

    candidates = []
    for study_id in ids:
        try:
            item = study_meta(str(study_id))
            if item:
                candidates.append(item)
        except Exception as e:
            logging.warning("Could not inspect study %s: %s", study_id, e)

    candidates.sort(key=lambda x: x[0])
    now = dt.datetime.now()
    need_to_delete = max(0, count - keep_studies)
    deleted = 0
    deleted_uids: List[str] = []

    for last_update, study_id, uid in candidates:
        if deleted >= need_to_delete:
            break

        age_minutes = (now - last_update).total_seconds() / 60.0
        if age_minutes < MIN_STUDY_AGE_MINUTES:
            break

        try:
            delete(f"/studies/{study_id}")
            deleted += 1
            if uid:
                deleted_uids.append(uid)
            logging.warning(
                "RETENTION DELETED: Study=%s UID=%s LastUpdate=%s Age=%.1fmin (%d/%d)",
                study_id, uid or "?", last_update.isoformat(), age_minutes, deleted, need_to_delete,
            )
        except Exception as e:
            logging.error("Retention delete failed for Study=%s: %s", study_id, e)

    if deleted_uids:
        reconcile_erp(deleted_uids)

    remaining = count - deleted
    if remaining > keep_studies:
        logging.warning(
            "Retention deferred part of cleanup: approximately %d studies remain. "
            "Recent studies (<%d min) are protected.",
            remaining, MIN_STUDY_AGE_MINUTES,
        )
    else:
        logging.warning("Retention cleanup complete: approximately %d studies remain", remaining)


def main():
    if CLEANUP_TRIGGER <= KEEP_STUDIES:
        raise SystemExit("CLEANUP_TRIGGER must be greater than KEEP_STUDIES")

    logging.info(
        "Care Orthanc retention starting: keep=%d trigger=%d minimum-age=%dmin check=%ds erp=%s",
        KEEP_STUDIES, CLEANUP_TRIGGER, MIN_STUDY_AGE_MINUTES, CHECK_INTERVAL_SECONDS, ERP_BASE_URL,
    )

    while True:
        try:
            policy = fetch_retention_policy()
            enabled = bool(policy.get("enabled"))
            keep = int(policy.get("keepStudies") or KEEP_STUDIES)
            trigger = int(policy.get("cleanupTrigger") or CLEANUP_TRIGGER)
            if trigger <= keep:
                trigger = keep + 20
            if not enabled:
                logging.info("Auto-retention disabled in ERP — sleeping %ds", CHECK_INTERVAL_SECONDS)
            else:
                cleanup_once(keep, trigger)
        except Exception as e:
            logging.exception("Retention cycle failed: %s", e)
        time.sleep(CHECK_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
