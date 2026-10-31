"""Score choice indices without invoking a model or accessing the network."""

from dataclasses import dataclass

from .benchmark import Benchmark

RESULT_SCHEMA_VERSION = "2.0.0"


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


def is_valid_saved_evaluation(document: object) -> bool:
    """Check score-vector integrity and the metadata needed to reuse a model result."""
    if (
        not isinstance(document, dict)
        or document.get("schema_version") != RESULT_SCHEMA_VERSION
    ):
        return False
    scores = document.get("scores")
    predictions = document.get("predictions")
    item_ids = document.get("item_ids")
    if (
        not isinstance(scores, list)
        or not scores
        or any(type(score) is not bool for score in scores)
    ):
        return False
    if not isinstance(predictions, list) or len(predictions) != len(scores):
        return False
    if any(type(prediction) is not int or prediction < 0 for prediction in predictions):
        return False
    if not isinstance(item_ids, list) or len(item_ids) != len(scores):
        return False
    if any(not isinstance(item_id, str) or not item_id for item_id in item_ids):
        return False
    correct = document.get("correct")
    total = document.get("total")
    accuracy = document.get("accuracy")
    if type(correct) is not int or correct != sum(scores):
        return False
    if type(total) is not int or total != len(scores):
        return False
    if type(accuracy) not in (int, float) or accuracy != correct / total:
        return False
    benchmark = document.get("benchmark")
    if not isinstance(benchmark, dict):
        return False
    if not isinstance(benchmark.get("name"), str) or not benchmark["name"]:
        return False
    if not isinstance(benchmark.get("version"), str):
        return False
    content_hash = benchmark.get("content_hash")
    if not isinstance(content_hash, str) or len(content_hash) != 64:
        return False
    if any(character not in "0123456789abcdef" for character in content_hash):
        return False
    return isinstance(document.get("inference"), dict)
