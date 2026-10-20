"""Validate benchmark boundaries, scoring rules, and the command-line workflow."""

import json
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

from jmac_worker.benchmark import load_benchmark
from jmac_worker.scoring import score_benchmark

WORKERS_DIRECTORY = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = WORKERS_DIRECTORY / "examples" / "benchmark.json"
PREDICTIONS_PATH = WORKERS_DIRECTORY / "examples" / "predictions.json"


class BenchmarkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "benchmark.json"
        self.document = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))

    def write_document(self, document: object) -> None:
        self.path.write_text(json.dumps(document), encoding="utf-8")

    def test_loads_example_and_hashes_original_bytes(self) -> None:
        benchmark = load_benchmark(BENCHMARK_PATH)
        self.assertEqual(benchmark.name, "Worker scoring example")
        self.assertEqual(benchmark.version, "1.0.0")
        self.assertEqual(len(benchmark.items), 3)
        self.assertEqual(benchmark.items[0].choices, ("3", "4", "5"))
        self.assertEqual(
            benchmark.content_hash, sha256(BENCHMARK_PATH.read_bytes()).hexdigest()
        )

    def test_hash_changes_with_whitespace(self) -> None:
        self.write_document(self.document)
        original = load_benchmark(self.path)
        self.path.write_text(
            self.path.read_text(encoding="utf-8") + "\n", encoding="utf-8"
        )
        changed = load_benchmark(self.path)
        self.assertEqual(original.items, changed.items)
        self.assertNotEqual(original.content_hash, changed.content_hash)

    def test_accepts_empty_description_version_and_extra_fields(self) -> None:
        self.document.update(description="", version="", extra="ignored")
        self.write_document(self.document)
        benchmark = load_benchmark(self.path)
        self.assertEqual(benchmark.description, "")
        self.assertEqual(benchmark.version, "")

    def test_accepts_integral_answer_numbers_like_backend(self) -> None:
        self.document["items"][0]["correct_choice"] = 1.0
        self.write_document(self.document)
        self.assertEqual(load_benchmark(self.path).items[0].correct_choice, 1)

    def test_rejects_missing_required_fields(self) -> None:
        for field in ("schema_version", "name", "description", "version", "items"):
            with self.subTest(field=field):
                document = deepcopy(self.document)
                del document[field]
                self.write_document(document)
                with self.assertRaisesRegex(ValueError, field):
                    load_benchmark(self.path)

    def test_rejects_invalid_metadata(self) -> None:
        cases = (
            ("schema_version", "2.0.0"),
            ("name", ""),
            ("name", 1),
            ("description", None),
            ("version", 1),
            ("items", []),
            ("items", {}),
        )
        for field, value in cases:
            with self.subTest(field=field, value=value):
                document = deepcopy(self.document)
                document[field] = value
                self.write_document(document)
                with self.assertRaisesRegex(ValueError, field):
                    load_benchmark(self.path)

    def test_rejects_nonobject_benchmarks_and_items(self) -> None:
        for value in (None, [], "benchmark", 42):
            with self.subTest(value=value):
                self.write_document(value)
                with self.assertRaisesRegex(ValueError, "benchmark must be an object"):
                    load_benchmark(self.path)
        self.document["items"][0] = None
        self.write_document(self.document)
        with self.assertRaisesRegex(ValueError, r"items\[0\] must be an object"):
            load_benchmark(self.path)

    def test_rejects_missing_item_fields(self) -> None:
        for field in ("item_id", "prompt", "choices", "correct_choice"):
            with self.subTest(field=field):
                document = deepcopy(self.document)
                del document["items"][0][field]
                self.write_document(document)
                with self.assertRaisesRegex(ValueError, field):
                    load_benchmark(self.path)

    def test_rejects_invalid_item_fields(self) -> None:
        cases = (
            ("item_id", ""),
            ("item_id", 7),
            ("prompt", ""),
            ("prompt", None),
            ("choices", []),
            ("choices", "abc"),
            ("choices", ["", "valid"]),
            ("choices", ["valid", 5]),
            ("choices", [None]),
            ("correct_choice", -1),
            ("correct_choice", 3),
            ("correct_choice", 0.5),
            ("correct_choice", True),
            ("correct_choice", "1"),
            ("correct_choice", None),
        )
        for field, value in cases:
            with self.subTest(field=field, value=value):
                document = deepcopy(self.document)
                document["items"][0][field] = value
                self.write_document(document)
                with self.assertRaisesRegex(ValueError, field):
                    load_benchmark(self.path)

    def test_rejects_invalid_json_and_encoding(self) -> None:
        for content in (b"", b"{broken", b"\xff"):
            with self.subTest(content=content):
                self.path.write_bytes(content)
                with self.assertRaises(ValueError):
                    load_benchmark(self.path)


class ScoringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.benchmark = load_benchmark(BENCHMARK_PATH)

    def test_known_predictions_produce_expected_result(self) -> None:
        result = score_benchmark(self.benchmark, [1, 0, 1]).to_dict()
        self.assertEqual(
            result,
            {
                "schema_version": "2.0.0",
                "benchmark": {
                    "name": "Worker scoring example",
                    "version": "1.0.0",
                    "content_hash": self.benchmark.content_hash,
                },
                "item_ids": ["arithmetic", "capital", "comparison"],
                "predictions": [1, 0, 1],
                "scores": [True, False, True],
                "correct": 2,
                "total": 3,
                "accuracy": 2 / 3,
            },
        )

    def test_scores_are_booleans_in_memory_and_json(self) -> None:
        result = score_benchmark(self.benchmark, [1, 0, 1])
        self.assertTrue(all(type(score) is bool for score in result.scores))
        document = json.loads(json.dumps(result.to_dict()))
        self.assertTrue(all(type(score) is bool for score in document["scores"]))
        self.assertTrue(all(type(index) is int for index in document["predictions"]))
        self.assertIs(type(document["correct"]), int)
        self.assertIs(type(document["total"]), int)

    def test_all_correct_and_all_wrong(self) -> None:
        for predictions, scores, correct, accuracy in (
            ([1, 2, 1], [True, True, True], 3, 1.0),
            ([0, 0, 0], [False, False, False], 0, 0.0),
        ):
            with self.subTest(predictions=predictions):
                result = score_benchmark(self.benchmark, predictions).to_dict()
                self.assertEqual(result["scores"], scores)
                self.assertEqual(result["correct"], correct)
                self.assertEqual(result["accuracy"], accuracy)

    def test_rejects_missing_or_extra_predictions(self) -> None:
        for predictions in ([], [1, 0], [1, 0, 1, 0]):
            with self.subTest(predictions=predictions):
                with self.assertRaisesRegex(ValueError, "Expected 3 predictions"):
                    score_benchmark(self.benchmark, predictions)

    def test_rejects_nonarray_predictions(self) -> None:
        for predictions in (None, {}, "101", 1):
            with self.subTest(predictions=predictions):
                with self.assertRaisesRegex(
                    ValueError, "predictions must be a JSON array"
                ):
                    score_benchmark(self.benchmark, predictions)

    def test_rejects_invalid_predictions(self) -> None:
        for prediction in (-1, 3, True, False, 1.0, 0.5, "1", None):
            with self.subTest(prediction=prediction):
                with self.assertRaisesRegex(ValueError, r"predictions\[0\]"):
                    score_benchmark(self.benchmark, [prediction, 0, 1])
        with self.assertRaisesRegex(ValueError, r"predictions\[2\]"):
            score_benchmark(self.benchmark, [1, 0, 2])

    def test_scoring_does_not_mutate_predictions(self) -> None:
        predictions = [1, 0, 1]
        result = score_benchmark(self.benchmark, predictions)
        predictions[0] = 0
        self.assertEqual(result.predictions, (1, 0, 1))
        self.assertEqual(self.benchmark.items[0].correct_choice, 1)


class CommandLineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name) / "result.json"

    def run_worker(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "jmac_worker", *args],
            cwd=WORKERS_DIRECTORY,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_example_command_and_repeatability(self) -> None:
        args = (
            "--benchmark",
            str(BENCHMARK_PATH),
            "--predictions",
            str(PREDICTIONS_PATH),
            "--output",
            str(self.output),
        )
        first = self.run_worker(*args)
        self.assertEqual(first.returncode, 0, first.stderr)
        result_bytes = self.output.read_bytes()
        result = json.loads(result_bytes)
        self.assertEqual(result["scores"], [True, False, True])
        self.assertTrue(all(type(score) is bool for score in result["scores"]))
        self.assertEqual(result["accuracy"], 2 / 3)
        second = self.run_worker(*args)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.output.read_bytes(), result_bytes)

    def test_invalid_input_does_not_replace_existing_result(self) -> None:
        predictions = Path(self.directory.name) / "predictions.json"
        self.output.write_text("existing result", encoding="utf-8")
        for content in ("[1]", "{broken", "[true, 0, 1]"):
            with self.subTest(content=content):
                predictions.write_text(content, encoding="utf-8")
                completed = self.run_worker(
                    "--benchmark",
                    str(BENCHMARK_PATH),
                    "--predictions",
                    str(predictions),
                    "--output",
                    str(self.output),
                )
                self.assertNotEqual(completed.returncode, 0)
                self.assertIn("error:", completed.stderr)
                self.assertNotIn("Traceback", completed.stderr)
                self.assertEqual(
                    self.output.read_text(encoding="utf-8"), "existing result"
                )

    def test_missing_input_reports_file_error(self) -> None:
        completed = self.run_worker(
            "--benchmark",
            str(Path(self.directory.name) / "missing.json"),
            "--predictions",
            str(PREDICTIONS_PATH),
            "--output",
            str(self.output),
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("error:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertFalse(self.output.exists())

    def test_refuses_to_overwrite_inputs(self) -> None:
        for source in (BENCHMARK_PATH, PREDICTIONS_PATH):
            with self.subTest(source=source):
                original = source.read_bytes()
                completed = self.run_worker(
                    "--benchmark",
                    str(BENCHMARK_PATH),
                    "--predictions",
                    str(PREDICTIONS_PATH),
                    "--output",
                    str(source),
                )
                self.assertNotEqual(completed.returncode, 0)
                self.assertIn("Output must be different", completed.stderr)
                self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
