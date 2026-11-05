"""Score choice indices without invoking a model or accessing the network."""

import json
from dataclasses import dataclass
from pathlib import Path

from .benchmark import Benchmark, parse_benchmark

RESULT_SCHEMA_VERSION = "3.0.0"


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    benchmark: Benchmark
    predictions: tuple[int, ...]
    scores: tuple[bool, ...]

    def to_dict(self) -> dict[str, object]:
        correct = sum(self.scores)
        total = len(self.scores)
        return {
            "schema_version": RESULT_SCHEMA_VERSION,
            "benchmark": {
                "name": self.benchmark.name,
                "version": self.benchmark.version,
                "content_hash": self.benchmark.content_hash,
                # private: keys the on-chain output digest, never published
                "output_key": self.benchmark.output_key,
            },
            "item_ids": [item.item_id for item in self.benchmark.items],
            "predictions": list(self.predictions),
            "scores": list(self.scores),
            "correct": correct,
            "total": total,
            "accuracy": correct / total,
        }


def score_benchmark(benchmark: Benchmark, predictions: object) -> EvaluationResult:
    """Require one valid integer prediction per item, preserving benchmark order."""
    if not isinstance(predictions, list):
        raise ValueError("predictions must be a JSON array")
    if len(predictions) != len(benchmark.items):
        raise ValueError(
            f"Expected {len(benchmark.items)} predictions, got {len(predictions)}"
        )

    validated_predictions: list[int] = []
    scores: list[bool] = []
    for index, (item, prediction) in enumerate(
        zip(benchmark.items, predictions, strict=True)
    ):
        if type(prediction) is not int or not 0 <= prediction < len(item.choices):
            raise ValueError(
                f"predictions[{index}] must be an integer between "
                f"0 and {len(item.choices) - 1}"
            )
        validated_predictions.append(prediction)
        scores.append(prediction == item.correct_choice)

    return EvaluationResult(benchmark, tuple(validated_predictions), tuple(scores))


def is_valid_saved_evaluation(document: object, benchmark: Benchmark) -> bool:
    """Re-score saved predictions against the benchmark; every derived field must match."""
    if not isinstance(document, dict) or not isinstance(
        document.get("inference"), dict
    ):
        return False
    try:
        expected = score_benchmark(benchmark, document.get("predictions")).to_dict()
    except ValueError:
        return False
    saved = {field: document.get(field) for field in expected}
    # JSON text keeps types strict: true is not 1, and 2.0 is not 2.
    return json.dumps(saved, sort_keys=True) == json.dumps(expected, sort_keys=True)


def saved_benchmark_path(result_path: Path) -> Path:
    """Private copy of the evaluated benchmark bytes, kept beside the result."""
    return result_path.with_suffix(".benchmark.json")


def _is_committed_legacy_result(document: object) -> bool:
    """Shape needed to recompute a commitment; the journal and chain pin its values."""
    if (
        not isinstance(document, dict)
        or document.get("schema_version") != RESULT_SCHEMA_VERSION
    ):
        return False
    assignment = document.get("assignment")
    benchmark = document.get("benchmark")
    predictions = document.get("predictions")
    return (
        isinstance(assignment, dict)
        and all(
            isinstance(assignment.get(field), str) and assignment[field]
            for field in ("job_id", "provider_id", "model_id")
        )
        and isinstance(assignment.get("specification", ""), str)
        and isinstance(benchmark, dict)
        and all(
            isinstance(benchmark.get(field), str)
            for field in ("content_hash", "output_key")
        )
        and isinstance(predictions, list)
        and type(document.get("correct")) is int
        and document.get("total") == len(predictions)
    )


def load_saved_evaluation(result_path: Path) -> dict | None:
    """Load a saved result only if it matches the benchmark copy saved beside it.

    Results committed before the copy existed are kept so they can still be
    revealed and claimed. Their commit journal and the on-chain commitment pin
    the digest and count, so any edit fails the commitment checks, and a
    journaled result is never committed afresh.
    """
    benchmark_path = saved_benchmark_path(result_path)
    try:
        document = json.loads(result_path.read_bytes())
        if (
            not benchmark_path.exists()
            and result_path.with_suffix(".commit.json").exists()
        ):
            return document if _is_committed_legacy_result(document) else None
        benchmark = parse_benchmark(benchmark_path.read_bytes())
        valid = is_valid_saved_evaluation(document, benchmark)
    # Deeply nested JSON raises RecursionError rather than ValueError.
    except (OSError, ValueError, RecursionError):
        return None
    return document if valid else None
