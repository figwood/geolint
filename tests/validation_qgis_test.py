import importlib.util
from pathlib import Path
import unittest


class Checker:
    info = {"version": "3.13.0", "qgisVersion": "3.44"}

    def check(self, geometry):
        if geometry["type"] != "Polygon":
            raise ValueError("unreadable geometry")
        return {"status": "invalid", "reasonCode": "GEOMETRY_INVALID", "reason": "Self-intersection", "location": {"x": 2, "y": 2}}


class BatchTest(unittest.TestCase):
    def test_preserves_indexes_and_skips_without_checking_and_marks_engine_failures(self):
        path = Path(__file__).resolve().parents[1] / "validation/qgis/check.py"
        self.assertTrue(path.exists(), "QGIS batch checker is missing")
        spec = importlib.util.spec_from_file_location("qgis_check", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.inspect_batch({"files": [{"file": "a", "sha256": "abc", "status": "prepared", "records": [
            {"featureIndex": 0, "disposition": "skipped", "reasonCode": "EMPTY_GEOMETRY", "reason": "null"},
            {"featureIndex": 1, "disposition": "check", "geometry": {"type": "Polygon"}},
            {"featureIndex": 2, "disposition": "check", "geometry": {"type": "bad"}},
        ]}]}, Checker())
        self.assertEqual(report["status"], "failed")
        records = report["files"][0]["records"]
        self.assertEqual([record["featureIndex"] for record in records], [0, 1, 2])
        self.assertEqual([record["status"] for record in records], ["skipped", "invalid", "engine_failed"])
        self.assertEqual(records[1]["location"], {"x": 2, "y": 2})
        self.assertNotIn("geometry", records[1])


if __name__ == "__main__":
    unittest.main()
