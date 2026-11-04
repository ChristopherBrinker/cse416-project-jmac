"""Integrity boundaries independent of backend, chain, or model availability."""

import json
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from test_jobs import ASSIGNMENT, BENCHMARK, RECORD

from jmac_worker.benchmark import parse_benchmark
from jmac_worker.jobs import JobConfig, parse_assignments, result_path
from jmac_worker.provider_api import ProviderAPIError
from jmac_worker.specification import validate_specification, verify_content


class IntegrityTests(unittest.TestCase):
    def test_hash_is_checked_before_json_parsing(self):
        with patch("jmac_worker.specification.parse_benchmark") as parse:
            with self.assertRaisesRegex(ValueError, "benchmark_integrity"):
                verify_content(b"private malformed bytes", ASSIGNMENT.specification)
            parse.assert_not_called()

    def test_original_bytes_are_required(self):
        with self.assertRaisesRegex(ValueError, "benchmark_integrity"):
            verify_content(BENCHMARK + b"\n", ASSIGNMENT.specification)
        verify_content(BENCHMARK, ASSIGNMENT.specification)

    def test_missing_unsupported_and_expired_specs(self):
        for spec in (
            None,
            {},
            {**RECORD["specification"], "model_revision": "other"},
            {**RECORD["specification"], "commit_deadline": 1},
        ):
            with self.subTest(spec=spec), self.assertRaises(ProviderAPIError):
                parse_assignments([{**RECORD, "specification": spec}], "provider")

    def test_count_and_version_mismatch(self):
        for change in ({"item_count": 2}, {"benchmark_version": "other"}):
            spec = validate_specification({**RECORD["specification"], **change})
            with self.assertRaisesRegex(ValueError, "benchmark_identity"):
                verify_content(BENCHMARK, spec)

    def test_duplicate_and_oversized_items(self):
        document = json.loads(BENCHMARK)
        document["items"][1]["item_id"] = document["items"][0]["item_id"]
        with self.assertRaises(ValueError):
            parse_benchmark(json.dumps(document).encode())
        document = json.loads(BENCHMARK)
        document["items"][0]["prompt"] = "x" * 8193
        with self.assertRaises(ValueError):
            parse_benchmark(json.dumps(document).encode())

    def test_changed_specification_changes_cache_path(self):
        config = JobConfig("https://example.convex.site", "model", Path("output"))
        changed = replace(
            ASSIGNMENT,
            specification=validate_specification(
                {**RECORD["specification"], "benchmark_sha256": "0" * 64}
            ),
        )
        self.assertNotEqual(
            result_path(config, ASSIGNMENT), result_path(config, changed)
        )
