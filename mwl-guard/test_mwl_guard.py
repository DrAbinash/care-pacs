#!/usr/bin/env python3
"""Unit tests for mwl_guard (no Orthanc required)."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mwl_guard  # noqa: E402
from mwl_guard import (  # noqa: E402
    file_is_stable,
    is_valid_uid,
    quarantine,
    validate_worklist,
)


MWL_SOP_CLASS = "1.2.840.10008.5.1.4.31"


def _write_wl(
    path: Path,
    *,
    study_uid: str,
    series_uid: str,
    sop_uid: str,
    sop_class: str = MWL_SOP_CLASS,
    with_sps: bool = True,
    accession: str = "ACC-TEST-1",
    modality: str = "MR",
) -> None:
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = sop_class or MWL_SOP_CLASS
    file_meta.MediaStorageSOPInstanceUID = sop_uid or generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    if sop_class:
        ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    if accession is not None:
        ds.AccessionNumber = accession
    ds.PatientName = "Test^Patient"
    ds.PatientID = "P1"
    if with_sps:
        step = Dataset()
        if modality:
            step.Modality = modality
        step.ScheduledStationAETitle = "ORTHANC2"
        step.ScheduledProcedureStepStartDate = "20260811"
        step.ScheduledProcedureStepStartTime = "090000"
        step.ScheduledProcedureStepDescription = "MRI Brain"
        step.ScheduledProcedureStepID = "ACC-TEST-1"
        ds.ScheduledProcedureStepSequence = Sequence([step])
    ds.save_as(str(path), write_like_original=False)


class TestUid(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(is_valid_uid("1.2.840.10008.5.1.4.31"))

    def test_empty(self):
        self.assertFalse(is_valid_uid(""))
        self.assertFalse(is_valid_uid("[]"))
        self.assertFalse(is_valid_uid(None))

    def test_malformed_chars(self):
        self.assertFalse(is_valid_uid("1.2.840.care.mwl"))
        self.assertFalse(is_valid_uid("not-a-uid"))

    def test_too_long(self):
        long_uid = "1." + "2" * 70
        self.assertGreater(len(long_uid), 64)
        self.assertFalse(is_valid_uid(long_uid))


class TestValidateCrashClass(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "good.wl"
            _write_wl(path, study_uid=generate_uid(), series_uid=generate_uid(), sop_uid=generate_uid())
            ok, crash, warn = validate_worklist(path)
            self.assertTrue(ok, crash)
            self.assertEqual(crash, [])

    def test_empty_study(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.wl"
            _write_wl(path, study_uid="", series_uid=generate_uid(), sop_uid=generate_uid())
            ok, crash, _ = validate_worklist(path)
            self.assertFalse(ok)
            self.assertTrue(any("StudyInstanceUID" in r for r in crash))

    def test_empty_series(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.wl"
            _write_wl(path, study_uid=generate_uid(), series_uid="", sop_uid=generate_uid())
            ok, crash, _ = validate_worklist(path)
            self.assertFalse(ok)
            self.assertTrue(any("SeriesInstanceUID" in r for r in crash))

    def test_empty_sop(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.wl"
            _write_wl(path, study_uid=generate_uid(), series_uid=generate_uid(), sop_uid="")
            ok, crash, _ = validate_worklist(path)
            self.assertFalse(ok)
            self.assertTrue(any("SOPInstanceUID" in r for r in crash))

    def test_malformed_dicom_quarantines(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "junk.wl"
            path.write_bytes(b"NOT-A-DICOM")
            ok, crash, _ = validate_worklist(path)
            self.assertFalse(ok)
            self.assertTrue(crash)


class TestValidateWarnOnly(unittest.TestCase):
    def test_missing_accession_does_not_fail(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "no-acc.wl"
            _write_wl(
                path,
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                sop_uid=generate_uid(),
                accession="",
            )
            ok, crash, warn = validate_worklist(path)
            self.assertTrue(ok, crash)
            self.assertEqual(crash, [])
            self.assertTrue(any("AccessionNumber" in w for w in warn))

    def test_missing_sps_warns_only(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "no-sps.wl"
            _write_wl(
                path,
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                sop_uid=generate_uid(),
                with_sps=False,
            )
            ok, crash, warn = validate_worklist(path)
            self.assertTrue(ok, crash)
            self.assertTrue(any("ScheduledProcedureStepSequence" in w for w in warn))


class TestStableAndQuarantine(unittest.TestCase):
    def test_unstable_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "partial.wl"
            path.write_bytes(b"abc")

            def growing_stat():
                # After sleep in file_is_stable, grow the file
                st = os.stat_result((0, 0, 0, 0, 0, 0, path.stat().st_size, 0, time.time(), 0))
                path.write_bytes(path.read_bytes() + b"x")
                return path.stat()

            # Simpler: call with STABLE_SECONDS mocked tiny and mutate between checks
            old = mwl_guard.STABLE_SECONDS
            mwl_guard.STABLE_SECONDS = 0.05
            try:
                path.write_bytes(b"a")
                # Monkeypatch sleep to append bytes mid-check
                real_sleep = time.sleep

                def sleep_and_grow(s):
                    path.write_bytes(path.read_bytes() + b"more")
                    real_sleep(s)

                with mock.patch("mwl_guard.time.sleep", side_effect=sleep_and_grow):
                    self.assertFalse(file_is_stable(path))
            finally:
                mwl_guard.STABLE_SECONDS = old

    def test_quarantine_preserves_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "work"
            bad = Path(td) / "bad"
            work.mkdir()
            bad.mkdir()
            src = work / "ACC1.wl"
            src.write_bytes(b"content-original")
            old_q = mwl_guard.QUARANTINE_DIR
            mwl_guard.QUARANTINE_DIR = bad
            try:
                dest1 = quarantine(src, ["empty StudyInstanceUID"])
                self.assertIsNotNone(dest1)
                self.assertTrue(dest1.exists())
                self.assertEqual(dest1.read_bytes(), b"content-original")
                self.assertFalse(src.exists())
                self.assertTrue(Path(str(dest1) + ".reason.txt").exists())

                # Second quarantine same stem/same second — must not overwrite
                src2 = work / "ACC1.wl"
                src2.write_bytes(b"content-2")
                # Force same stamp by creating dest that exists
                dest2 = quarantine(src2, ["empty SeriesInstanceUID"])
                self.assertIsNotNone(dest2)
                self.assertNotEqual(dest1, dest2)
                self.assertTrue(dest1.exists())
                self.assertEqual(dest1.read_bytes(), b"content-original")
                self.assertEqual(dest2.read_bytes(), b"content-2")
            finally:
                mwl_guard.QUARANTINE_DIR = old_q

    def test_missing_worklist_dir(self):
        old = mwl_guard.WORKLIST_DIR
        mwl_guard.WORKLIST_DIR = Path("/tmp/mwl-guard-missing-dir-does-not-exist-xyz")
        try:
            self.assertFalse(mwl_guard.runtime_dirs_ok())
        finally:
            mwl_guard.WORKLIST_DIR = old

    def test_unwritable_quarantine(self):
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "work"
            work.mkdir()
            q = Path(td) / "q"
            q.mkdir()
            os.chmod(q, 0o500)  # read+execute only
            old_w, old_q = mwl_guard.WORKLIST_DIR, mwl_guard.QUARANTINE_DIR
            mwl_guard.WORKLIST_DIR = work
            mwl_guard.QUARANTINE_DIR = q
            try:
                # root may still write; skip soft if writable
                if os.access(q, os.W_OK):
                    self.skipTest("environment allows write despite chmod")
                self.assertFalse(mwl_guard.runtime_dirs_ok())
            finally:
                os.chmod(q, 0o700)
                mwl_guard.WORKLIST_DIR = old_w
                mwl_guard.QUARANTINE_DIR = old_q


if __name__ == "__main__":
    unittest.main()
