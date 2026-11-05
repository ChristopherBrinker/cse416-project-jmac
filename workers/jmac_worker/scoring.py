"""Score choice indices without invoking a model or accessing the network."""

from dataclasses import dataclass

from .benchmark import Benchmark

RESULT_SCHEMA_VERSION = "3.0.0"
HEX_DIGEST_LENGTH = 64


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
            # bounds each prediction, so a tampered result cannot commit an invalid choice
            "choice_counts": [len(item.choices) for item in self.benchmark.items],
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
    choice_counts = document.get("choice_counts")
    if not isinstance(choice_counts, list) or len(choice_counts) != len(scores):
        return False
    if any(type(count) is not int or count < 1 for count in choice_counts):
        return False
    if any(
        type(prediction) is not int or not 0 <= prediction < count
        for prediction, count in zip(predictions, choice_counts, strict=True)
    ):
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
    for field in ("content_hash", "output_key"):
        value = benchmark.get(field)
        if not isinstance(value, str) or len(value) != HEX_DIGEST_LENGTH:
            return False
        if any(character not in "0123456789abcdef" for character in value):
            return False
    return isinstance(document.get("inference"), dict)
