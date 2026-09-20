#!/usr/bin/env python3
"""
Care Diagnostics - Orthanc rolling-study retention

Policy:
- Do nothing at <= 520 studies.
- Once > 520 studies, delete the oldest studies until 500 remain.
- "Oldest" means Orthanc LastUpdate (arrival/update time), not DICOM StudyDate.
- Never delete a study updated within the last 60 minutes.
- Check every 5 minutes.

This is intended for Orthanc as a short-term working PACS/cache, not as the
permanent archive.
"""

import datetime as dt
import logging
import os
import time
from typing import Optional, Tuple

import requests

ORTHANC_URL = os.getenv("ORTHANC_URL", "http://care-orthanc:8042").rstrip("/")
KEEP_STUDIES = int(os.getenv("KEEP_STUDIES", "500"))
CLEANUP_TRIGGER = int(os.getenv("CLEANUP_TRIGGER", "520"))
CHECK_INTERVAL_SECONDS = int(os.getenv("CHECK_INTERVAL_SECONDS", "300"))
MIN_STUDY_AGE_MINUTES = int(os.getenv("MIN_STUDY_AGE_MINUTES", "60"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

session = requests.Session()


def get_json(path):
    r = session.get(ORTHANC_URL + path, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.json()


def delete(path):
    r = session.delete(ORTHANC_URL + path, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()


def parse_last_update(value: str) -> Optional[dt.datetime]:
    if not value:
        return None
    value = value.strip()
    # Typical Orthanc value: YYYYMMDDTHHMMSS[.ffffff]
    for fmt in ("%Y%m%dT%H%M%S.%f", "%Y%m%dT%H%M%S"):
        try:
            return dt.datetime.strptime(value, fmt)
        except ValueError:
            pass
    # Also accept ISO-ish values if a future Orthanc version changes formatting.
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def study_age_key(study_id: str) -> Optional[Tuple[dt.datetime, str]]:
    info = get_json(f"/studies/{study_id}")
    parsed = parse_last_update(str(info.get("LastUpdate", "")))
    if parsed is None:
        logging.warning("Skipping study %s: LastUpdate missing/unparseable", study_id)
        return None
    return parsed, study_id


def cleanup_once():
    ids = get_json("/studies")
    if not isinstance(ids, list):
        logging.error("Unexpected /studies response: %r", ids)
        return

    count = len(ids)
    if count <= CLEANUP_TRIGGER:
        logging.info("Retention OK: %d studies (trigger=%d, target=%d)",
                     count, CLEANUP_TRIGGER, KEEP_STUDIES)
        return

    logging.warning("Retention cleanup starting: %d studies; target=%d", count, KEEP_STUDIES)

    candidates = []
    for study_id in ids:
        try:
            item = study_age_key(str(study_id))
            if item:
                candidates.append(item)
        except Exception as e:
            logging.warning("Could not inspect study %s: %s", study_id, e)

    candidates.sort(key=lambda x: x[0])
    now = dt.datetime.now()
    need_to_delete = max(0, count - KEEP_STUDIES)
    deleted = 0

    for last_update, study_id in candidates:
        if deleted >= need_to_delete:
            break

        age_minutes = (now - last_update).total_seconds() / 60.0
        if age_minutes < MIN_STUDY_AGE_MINUTES:
            # Sorted oldest -> newest, so all following items are even newer.
            break

        try:
            delete(f"/studies/{study_id}")
            deleted += 1
            logging.warning("RETENTION DELETED: Study=%s LastUpdate=%s Age=%.1fmin (%d/%d)",
                            study_id, last_update.isoformat(), age_minutes, deleted, need_to_delete)
        except Exception as e:
            logging.error("Retention delete failed for Study=%s: %s", study_id, e)

    remaining = count - deleted
    if remaining > KEEP_STUDIES:
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
        "Care Orthanc retention starting: keep=%d trigger=%d minimum-age=%dmin check=%ds",
        KEEP_STUDIES, CLEANUP_TRIGGER, MIN_STUDY_AGE_MINUTES, CHECK_INTERVAL_SECONDS,
    )

    while True:
        try:
            cleanup_once()
        except Exception as e:
            logging.exception("Retention cycle failed: %s", e)
        time.sleep(CHECK_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
