import unittest

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("revision_ready", Path(__file__).with_name("revision-ready.py"))
module = module_from_spec(spec)
spec.loader.exec_module(module)


class RevisionReadyTests(unittest.TestCase):
    def test_ready_condition_is_selected_by_type(self):
        self.assertEqual(module.ready_status({"status": {"conditions": [
            {"type": "Active", "status": "False"},
            {"type": "Ready", "status": "True"},
        ]}}), "True")

    def test_not_ready(self):
        self.assertEqual(module.ready_status({"status": {"conditions": [
            {"type": "Ready", "status": "False"},
        ]}}), "False")

    def test_missing_condition_is_unknown(self):
        self.assertEqual(module.ready_status({}), "Unknown")
        self.assertEqual(module.ready_status({"status": {"conditions": [
            {"type": "Active", "status": "True"},
        ]}}), "Unknown")


if __name__ == "__main__":
    unittest.main()
