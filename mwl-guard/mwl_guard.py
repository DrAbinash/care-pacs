#!/usr/bin/env python3
"""
CARE PACS — Modality Worklist Guard (permanent safety layer)

Orthanc's worklist housekeeper TERMINATES the Orthanc process when it reads a
.wl file with empty/missing StudyInstanceUID, SeriesInstanceUID, or
SOPInstanceUID. ERP is supposed to write only valid files; this guard is the
defense-in-depth layer that keeps Orthanc alive if a bad file ever appears.

Behavior:
  - Polls WORKLIST_DIR for *.wl files
  - Validates required DICOM UIDs (and ScheduledProcedureStepSequence when present)
  - Moves invalid files to QUARANTINE_DIR (never deletes)
  - Writes a sidecar .reason.txt next to each quarantined file
  - Does NOT talk to ERP; does NOT modify Orthanc storage

This service is intentionally separate from Orthanc so a bug here cannot crash
the PACS core.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

try:
    import pydicom
    from pydicom.errors import InvalidDicomError
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pydicom is required. Install with: pip install -r requirements.txt"
    ) from exc


WORKLIST_DIR = Path(os.environ.get("MWL_WORKLIST_DIR", "/var/lib/orthanc/worklists"))
QUARANTINE_DIR = Path(
    os.environ.get("MWL_QUARANTINE_DIR", "/var/lib/orthanc/worklists-bad")
)
POLL_SECONDS = float(os.environ.get("MWL_GUARD_POLL_SECONDS", "2"))
STABLE_SECONDS = float(os.environ.get("MWL_GUARD_STABLE_SECONDS", "1.0"))

# DICOM UID: digits and dots, no empty components, not blank
UID_RE = re.compile(r"^[0-9]+(\.[0-9]+)+$")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("mwl-guard")


def is_valid_uid(value: object) -> bool:
    if value is None:
        return False
    text = str(value).strip().rstrip("\x00")
    if not text or text == "[]":
        return False
    if len(text) > 64:
        return False
    return bool(UID_RE.match(text))


def validate_worklist(path: Path) -> Tuple[bool, List[str]]:
    """Return (ok, reasons). Never raises for expected DICOM problems."""
    reasons: List[str] = []
    try:
        ds = pydicom.dcmread(str(path), force=True)
    except InvalidDicomError as exc:
        return False, [f"not a readable DICOM dataset: {exc}"]
    except Exception as exc:  # pragma: no cover
        return False, [f"read failure: {type(exc).__name__}: {exc}"]

    study = getattr(ds, "StudyInstanceUID", None)
    series = getattr(ds, "SeriesInstanceUID", None)
    sop = getattr(ds, "SOPInstanceUID", None)
    sop_class = getattr(ds, "SOPClassUID", None)

    if not is_valid_uid(study):
        reasons.append(
            f"missing/invalid StudyInstanceUID ({study!r}) — "
            "Orthanc housekeeper would terminate Orthanc"
        )
    if not is_valid_uid(series):
        reasons.append(f"missing/invalid SeriesInstanceUID ({series!r})")
    if not is_valid_uid(sop):
        reasons.append(f"missing/invalid SOPInstanceUID ({sop!r})")
    if not is_valid_uid(sop_class):
        # Soft requirement for Orthanc; still quarantine to be safe
        reasons.append(f"missing/invalid SOPClassUID ({sop_class!r})")

    # Scheduled Procedure Step Sequence is required for useful MWL C-FIND
    if not hasattr(ds, "ScheduledProcedureStepSequence"):
        reasons.append("missing ScheduledProcedureStepSequence (0040,0100)")
    else:
        steps = ds.ScheduledProcedureStepSequence
        if not steps:
            reasons.append("ScheduledProcedureStepSequence is empty")
        else:
            step0 = steps[0]
            if not getattr(step0, "Modality", None):
                reasons.append("ScheduledProcedureStepSequence[0] missing Modality")

    accession = str(getattr(ds, "AccessionNumber", "") or "").strip()
    if not accession:
        reasons.append("missing AccessionNumber (clinical linking key)")

    return (len(reasons) == 0), reasons


def file_is_stable(path: Path) -> bool:
    """Skip files still being written (size changing)."""
    try:
        size1 = path.stat().st_size
        mtime1 = path.stat().st_mtime
        time.sleep(min(STABLE_SECONDS, 0.5))
        size2 = path.stat().st_size
        mtime2 = path.stat().st_mtime
        return size1 == size2 and mtime1 == mtime2 and size2 > 0
    except FileNotFoundError:
        return False


def quarantine(path: Path, reasons: List[str]) -> None:
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = QUARANTINE_DIR / f"{path.stem}__{stamp}{path.suffix}"
    # Avoid overwrite collisions
    n = 1
    while dest.exists():
        dest = QUARANTINE_DIR / f"{path.stem}__{stamp}_{n}{path.suffix}"
        n += 1

    reason_path = dest.with_suffix(dest.suffix + ".reason.txt")
    reason_body = (
        f"quarantined_at_utc={stamp}\n"
        f"source={path}\n"
        f"reasons:\n"
        + "\n".join(f"  - {r}" for r in reasons)
        + "\n"
    )
    try:
        reason_path.write_text(reason_body, encoding="utf-8")
    except OSError as exc:
        log.error("Could not write reason file for %s: %s", path.name, exc)

    try:
        shutil.move(str(path), str(dest))
        log.warning(
            "QUARANTINED %s → %s | %s",
            path.name,
            dest.name,
            "; ".join(reasons),
        )
    except OSError as exc:
        log.error("Failed to quarantine %s: %s", path, exc)


def scan_once() -> int:
    if not WORKLIST_DIR.is_dir():
        log.warning("Worklist dir missing: %s (waiting)", WORKLIST_DIR)
        return 0

    quarantined = 0
    for path in sorted(WORKLIST_DIR.glob("*.wl")):
        if not path.is_file():
            continue
        if not file_is_stable(path):
            log.info("Skipping unstable write: %s", path.name)
            continue
        ok, reasons = validate_worklist(path)
        if ok:
            continue
        quarantine(path, reasons)
        quarantined += 1
    return quarantined


READY_FILE = Path(os.environ.get("MWL_GUARD_READY_FILE", "/tmp/mwl-guard-ready"))


def mark_ready() -> None:
    try:
        READY_FILE.write_text("ok\n", encoding="utf-8")
    except OSError as exc:
        log.warning("Could not write ready file %s: %s", READY_FILE, exc)


def main() -> None:
    log.info("CARE MWL Guard starting")
    log.info("Watch: %s", WORKLIST_DIR)
    log.info("Quarantine: %s", QUARANTINE_DIR)
    log.info("Poll every %ss", POLL_SECONDS)
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        READY_FILE.unlink(missing_ok=True)
    except OSError:
        pass

    # Startup sweep — clear any bad files left from before Orthanc starts
    n = scan_once()
    if n:
        log.warning("Startup quarantine moved %d invalid worklist file(s)", n)
    else:
        log.info("Startup sweep: no invalid worklists")
    mark_ready()
    log.info("Ready for Orthanc (first sweep complete)")

    while True:
        try:
            scan_once()
        except Exception:
            log.exception("Scan cycle failed")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
