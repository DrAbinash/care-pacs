#!/usr/bin/env python3
"""
CARE PACS — Modality Worklist Guard (defense-in-depth)

Orthanc's worklist housekeeper TERMINATES Orthanc when it reads a .wl with
empty/missing StudyInstanceUID, SeriesInstanceUID, or SOPInstanceUID.

PRIMARY guarantee is Care ERP:
  generate → validate dump → dump2dcm (staging) → validate DICOM → atomic rename
  into the Orthanc-watched worklists/ folder.

This guard is NOT a race-free gate after Orthanc is running. It polls every
POLL_SECONDS and can miss a brief window where Orthanc's housekeeper reads a
bad file first. Treat it as defense-in-depth for leftovers / alternate writers.

Quarantine policy (intentional):
  A) Crash-class — empty/invalid Study/Series/SOP Instance UID, or unreadable
     DICOM → QUARANTINE (reproduces Orthanc terminate)
  B) Clinical-usability — missing SOPClassUID / ScheduledProcedureStepSequence /
     Modality → LOG WARNING only (do not quarantine; Orthanc may still serve)
  C) CARE business — missing AccessionNumber → LOG WARNING only
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

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
READY_FILE = Path(os.environ.get("MWL_GUARD_READY_FILE", "/tmp/mwl-guard-ready"))

# DICOM UID: digits and dots, no empty components, not blank, ≤64 chars
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


def validate_worklist(path: Path) -> Tuple[bool, List[str], List[str]]:
    """
    Return (ok_for_orthanc_crash_safety, crash_reasons, warn_reasons).

    ok_for_orthanc_crash_safety=False → quarantine.
    Warnings alone do NOT quarantine.
    """
    crash: List[str] = []
    warn: List[str] = []
    try:
        ds = pydicom.dcmread(str(path), force=True)
    except InvalidDicomError as exc:
        return False, [f"not a readable DICOM dataset: {exc}"], []
    except Exception as exc:  # pragma: no cover
        return False, [f"read failure: {type(exc).__name__}: {exc}"], []

    study = getattr(ds, "StudyInstanceUID", None)
    series = getattr(ds, "SeriesInstanceUID", None)
    sop = getattr(ds, "SOPInstanceUID", None)
    sop_class = getattr(ds, "SOPClassUID", None)

    # --- A) Crash-class (Orthanc housekeeper terminate) ----------------------
    if not is_valid_uid(study):
        crash.append(
            f"missing/invalid StudyInstanceUID ({study!r}) — "
            "Orthanc housekeeper would terminate Orthanc"
        )
    if not is_valid_uid(series):
        crash.append(
            f"missing/invalid SeriesInstanceUID ({series!r}) — "
            "Orthanc housekeeper would terminate Orthanc"
        )
    if not is_valid_uid(sop):
        crash.append(
            f"missing/invalid SOPInstanceUID ({sop!r}) — "
            "Orthanc housekeeper would terminate Orthanc"
        )

    # --- B) Clinical usability (warn only) ----------------------------------
    if not is_valid_uid(sop_class):
        warn.append(f"missing/invalid SOPClassUID ({sop_class!r}) — MWL may be less interoperable")
    if not hasattr(ds, "ScheduledProcedureStepSequence"):
        warn.append("missing ScheduledProcedureStepSequence (0040,0100) — modalities may see empty MWL")
    else:
        steps = ds.ScheduledProcedureStepSequence
        if not steps:
            warn.append("ScheduledProcedureStepSequence is empty")
        elif not getattr(steps[0], "Modality", None):
            warn.append("ScheduledProcedureStepSequence[0] missing Modality")

    # --- C) CARE business rule (warn only) ----------------------------------
    accession = str(getattr(ds, "AccessionNumber", "") or "").strip()
    if not accession:
        warn.append("missing AccessionNumber — CARE billing/link matching may fail (not an Orthanc crash)")

    return (len(crash) == 0), crash, warn


def file_is_stable(path: Path) -> bool:
    """Skip files still being written (size/mtime changing)."""
    try:
        size1 = path.stat().st_size
        mtime1 = path.stat().st_mtime
        time.sleep(min(STABLE_SECONDS, 0.5))
        size2 = path.stat().st_size
        mtime2 = path.stat().st_mtime
        return size1 == size2 and mtime1 == mtime2 and size2 > 0
    except FileNotFoundError:
        return False


def quarantine(path: Path, reasons: List[str]) -> Path | None:
    """Move bad file to quarantine; never overwrite; never delete. Returns dest or None."""
    try:
        QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        log.error("Cannot create quarantine dir %s: %s", QUARANTINE_DIR, exc)
        return None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = QUARANTINE_DIR / f"{path.stem}__{stamp}{path.suffix}"
    n = 1
    while dest.exists():
        dest = QUARANTINE_DIR / f"{path.stem}__{stamp}_{n}{path.suffix}"
        n += 1

    reason_path = Path(str(dest) + ".reason.txt")
    reason_body = (
        f"quarantined_at_utc={stamp}\n"
        f"source={path}\n"
        f"severity=crash-class\n"
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
        return dest
    except OSError as exc:
        log.error("Failed to quarantine %s: %s", path, exc)
        return None


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
        ok, crash, warn = validate_worklist(path)
        for w in warn:
            log.warning("MWL warn %s: %s", path.name, w)
        if ok:
            continue
        if quarantine(path, crash) is not None:
            quarantined += 1
    return quarantined


def clear_ready() -> None:
    try:
        READY_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def mark_ready() -> bool:
    try:
        READY_FILE.write_text("ok\n", encoding="utf-8")
        return True
    except OSError as exc:
        log.error("Could not write ready file %s: %s", READY_FILE, exc)
        return False


def runtime_dirs_ok() -> bool:
    """Fail closed: Orthanc must not start if we cannot watch/quarantine."""
    if not WORKLIST_DIR.is_dir():
        log.error("Worklist dir missing or not a directory: %s", WORKLIST_DIR)
        return False
    try:
        QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
        probe = QUARANTINE_DIR / ".mwl-guard-write-test"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        log.error("Quarantine dir not writable: %s (%s)", QUARANTINE_DIR, exc)
        return False
    return True


def wait_until_runtime_ready() -> None:
    clear_ready()
    while not runtime_dirs_ok():
        log.error("Runtime dirs not ready — NOT marking healthy (Orthanc will wait)")
        time.sleep(5)


def main() -> None:
    log.info("CARE MWL Guard starting (defense-in-depth; ERP is primary guarantee)")
    log.info("Watch: %s", WORKLIST_DIR)
    log.info("Quarantine: %s", QUARANTINE_DIR)
    log.info("Poll every %ss (post-startup race window up to ~poll+stable)", POLL_SECONDS)

    wait_until_runtime_ready()

    n = scan_once()
    if n:
        log.warning("Startup quarantine moved %d crash-class worklist file(s)", n)
    else:
        log.info("Startup sweep: no crash-class worklists")

    if not mark_ready():
        log.error("Failed to mark ready — exiting so Orthanc does not get a false healthy")
        raise SystemExit(2)

    log.info("Ready for Orthanc (first sweep complete). Guard remains polling.")

    while True:
        try:
            if not runtime_dirs_ok():
                clear_ready()
                log.error("Runtime dirs lost — cleared ready; waiting to recover")
                wait_until_runtime_ready()
                scan_once()
                mark_ready()
            else:
                scan_once()
        except Exception:
            log.exception("Scan cycle failed")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
