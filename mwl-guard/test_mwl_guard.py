#!/usr/bin/env python3
"""Unit tests for mwl_guard validation helpers (no Orthanc required)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

# Import after path setup
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mwl_guard import is_valid_uid, validate_worklist  # noqa: E402


MWL_SOP_CLASS = "1.2.840.10008.5.1.4.31"


def _write_wl(path: Path, *, study_uid: str, series_uid: str, sop_uid: str, with_sps: bool = True) -> None:
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = MWL_SOP_CLASS
    file_meta.MediaStorageSOPInstanceUID = sop_uid or generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.SOPClassUID = MWL_SOP_CLASS
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.AccessionNumber = "ACC-TEST-1"
    ds.PatientName = "Test^Patient"
    ds.PatientID = "P1"
    if with_sps:
        step = Dataset()
        step.Modality = "MR"
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
        self.assertFalse(is_valid_uid(""))
        self.assertFalse(is_valid_uid("[]"))
        self.assertFalse(is_valid_uid(None))
        self.assertFalse(is_valid_uid("not-a-uid"))


class TestValidate(unittest.TestCase):
    def test_good_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "good.wl"
            _write_wl(
                path,
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                sop_uid=generate_uid(),
            )
            ok, reasons = validate_worklist(path)
            self.assertTrue(ok, reasons)

    def test_empty_study_uid(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.wl"
            _write_wl(
                path,
                study_uid="",
                series_uid=generate_uid(),
                sop_uid=generate_uid(),
            )
            ok, reasons = validate_worklist(path)
            self.assertFalse(ok)
            self.assertTrue(any("StudyInstanceUID" in r for r in reasons))


if __name__ == "__main__":
    unittest.main()
