"""Validate the benchmark format shared with the Convex backend."""

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

BENCHMARK_SCHEMA_VERSION = "1.0.0"


@dataclass(frozen=True, slots=True)
class BenchmarkItem:
    item_id: str
    prompt: str
    choices: tuple[str, ...]
    correct_choice: int


@dataclass(frozen=True, slots=True)
class Benchmark:
    name: str
    description: str
    version: str
    content_hash: str
    items: tuple[BenchmarkItem, ...]


def _require_object(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _require_string(value: object, field: str, *, nonempty: bool = False) -> str:
    if not isinstance(value, str) or (nonempty and len(value) == 0):
        requirement = "a non-empty string" if nonempty else "a string"
        raise ValueError(f"{field} must be {requirement}")
    return value


def _require_array(value: object, field: str) -> list[object]:
    if not isinstance(value, list) or len(value) == 0:
        raise ValueError(f"{field} must be a non-empty array")
    return value


def _parse_item(value: object, index: int) -> BenchmarkItem:
    field = f"items[{index}]"
    item = _require_object(value, field)
    item_id = _require_string(item.get("item_id"), f"{field}.item_id", nonempty=True)
    prompt = _require_string(item.get("prompt"), f"{field}.prompt", nonempty=True)
    choices = tuple(
        _require_string(choice, f"{field}.choices[{choice_index}]", nonempty=True)
        for choice_index, choice in enumerate(
            _require_array(item.get("choices"), f"{field}.choices")
        )
    )
    answer = item.get("correct_choice")
    # JSON numbers such as 1.0 are also integral in the backend's JS validator.
    if isinstance(answer, float) and answer.is_integer():
        answer = int(answer)
    if type(answer) is not int or not 0 <= answer < len(choices):
        raise ValueError(
            f"{field}.correct_choice must be an integer between 0 and {len(choices) - 1}"
        )
    return BenchmarkItem(item_id, prompt, choices, answer)


def load_benchmark(path: Path) -> Benchmark:
    """Load a UTF-8 benchmark and hash its original bytes, as the backend does."""
    content = path.read_bytes()
    document = _require_object(json.loads(content.decode("utf-8")), "benchmark")
    if document.get("schema_version") != BENCHMARK_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {BENCHMARK_SCHEMA_VERSION}")
    name = _require_string(document.get("name"), "name", nonempty=True)
    description = _require_string(document.get("description"), "description")
    version = _require_string(document.get("version"), "version")
    items = tuple(
        _parse_item(item, index)
        for index, item in enumerate(_require_array(document.get("items"), "items"))
    )
    return Benchmark(name, description, version, sha256(content).hexdigest(), items)
