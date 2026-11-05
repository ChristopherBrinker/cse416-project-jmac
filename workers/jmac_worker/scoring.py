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


def load_saved_evaluation(result_path: Path) -> dict | None:
    """Load a saved result only if it matches the benchmark copy saved beside it."""
    try:
        document = json.loads(result_path.read_bytes())
        benchmark = parse_benchmark(saved_benchmark_path(result_path).read_bytes())
    except (OSError, ValueError):
        return None
    return document if is_valid_saved_evaluation(document, benchmark) else None
