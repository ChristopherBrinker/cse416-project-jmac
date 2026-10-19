"""Score choice indices without invoking a model or accessing the network."""

from dataclasses import dataclass

from .benchmark import Benchmark

RESULT_SCHEMA_VERSION = "1.0.0"


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    benchmark: Benchmark
    predictions: tuple[int, ...]
    scores: tuple[int, ...]

    def to_dict(self) -> dict[str, object]:
        correct = sum(self.scores)
        total = len(self.scores)
        return {
            "schema_version": RESULT_SCHEMA_VERSION,
            "benchmark": {
                "name": self.benchmark.name,
                "version": self.benchmark.version,
                "content_hash": self.benchmark.content_hash,
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
    scores: list[int] = []
    for index, (item, prediction) in enumerate(
        zip(benchmark.items, predictions, strict=True)
    ):
        if type(prediction) is not int or not 0 <= prediction < len(item.choices):
            raise ValueError(
                f"predictions[{index}] must be an integer between "
                f"0 and {len(item.choices) - 1}"
            )
        validated_predictions.append(prediction)
        scores.append(int(prediction == item.correct_choice))

    return EvaluationResult(benchmark, tuple(validated_predictions), tuple(scores))
