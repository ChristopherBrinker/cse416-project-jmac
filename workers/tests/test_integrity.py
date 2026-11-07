"""Integrity boundaries independent of backend, chain, or model availability."""

import json
import subprocess
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from test_jobs import ASSIGNMENT, BENCHMARK, RECORD

from jmac_worker.benchmark import parse_benchmark
from jmac_worker.inference import LocalModelRunner
from jmac_worker.jobs import JobConfig, parse_assignments, result_path
from jmac_worker.provider_api import ProviderAPIError
from jmac_worker.scoring import saved_benchmark_path
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

    def test_timeout_is_enforced_and_error_is_safe(self):
        from jmac_worker.specification import MAX_SECONDS

        runner = object.__new__(LocalModelRunner)
        runner.cache_directory = Path("unused")
        with patch(
            "subprocess.run",
            side_effect=subprocess.TimeoutExpired("private", MAX_SECONDS),
        ) as run:
            with self.assertRaisesRegex(RuntimeError, "^isolated_inference_failed$"):
                runner.predict_isolated([])
        self.assertEqual(run.call_args.kwargs["timeout"], MAX_SECONDS)
        self.assertTrue(run.call_args.kwargs["check"])

    def test_artifact_hash_is_retained_without_rereading_files(self):
        from jmac_worker.specification import worker_artifact

        expected = worker_artifact()
        with patch(
            "pathlib.Path.read_bytes", side_effect=AssertionError("source reread")
        ):
            self.assertEqual(worker_artifact(), expected)
            self.assertEqual(
                validate_specification(RECORD["specification"]),
                ASSIGNMENT.specification,
            )

    def test_historical_result_survives_worker_upgrade(self):
        import tempfile
        from unittest.mock import Mock

        from jmac_worker.jobs import evaluate, has_saved_result, saved_assignments

        old = {**RECORD["specification"], "worker_sha256": "0" * 64}
        with self.assertRaisesRegex(ValueError, "unsupported_configuration"):
            validate_specification(old)
        historical = replace(
            ASSIGNMENT, specification=validate_specification(old, supported=False)
        )
        runner = Mock()
        runner.predict.return_value = [1, 0, 1]
        runner.metadata.return_value = {"revision": "old"}
        document = evaluate(BENCHMARK, runner)
        document["assignment"] = historical.identity()
        with tempfile.TemporaryDirectory() as directory:
            config = JobConfig("https://example.convex.site", "model", Path(directory))
            path = result_path(config, historical)
            saved_benchmark_path(path).write_bytes(BENCHMARK)
            path.write_text(json.dumps(document))
            self.assertEqual(saved_assignments(config, "provider"), (historical,))
            self.assertTrue(has_saved_result(config, historical))

    def test_legacy_result_retains_original_identity_and_filename(self):
        import tempfile
        from hashlib import sha256
        from unittest.mock import Mock

        from jmac_worker.jobs import (
            Assignment,
            evaluate,
            has_saved_result,
            saved_assignments,
        )

        identity = {"job_id": "job", "provider_id": "provider", "model_id": "model"}
        legacy = Assignment("job", "provider", "model")
        self.assertEqual(legacy.identity(), identity)
        runner = Mock()
        runner.predict.return_value = [1, 0, 1]
        runner.metadata.return_value = {"revision": "old"}
        document = evaluate(BENCHMARK, runner)
        document["assignment"] = identity
        with tempfile.TemporaryDirectory() as directory:
            config = JobConfig("https://example.convex.site", "model", Path(directory))
            original = Path(directory) / (
                sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
                + ".json"
            )
            saved_benchmark_path(original).write_bytes(BENCHMARK)
            original.write_text(json.dumps(document))
            self.assertEqual(result_path(config, legacy), original)
            self.assertEqual(saved_assignments(config, "provider"), (legacy,))
            self.assertTrue(has_saved_result(config, legacy))
