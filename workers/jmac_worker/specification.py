"""Fail-closed v1 assignment contract; canonicalization is local cache identity only."""

import json
import re
import time
from hashlib import sha256
from pathlib import Path

from .benchmark import parse_benchmark
from .inference import METHOD, MODEL_ID, MODEL_REVISION, PROMPT_VERSION

MAX_BYTES = 16 * 1024 * 1024
MAX_ITEMS = 100
MAX_PROMPT = 8192
MAX_CHOICES = 10
MAX_CHOICE = 2048
MAX_SECONDS = 300


def _hash_worker_artifact() -> str:
    digest = sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


# Retain the startup artifact identity even if files on disk change. Deployment
# must still use an immutable image; a running interpreter cannot safely hot reload.
WORKER_ARTIFACT = _hash_worker_artifact()


def worker_artifact() -> str:
    return WORKER_ARTIFACT


def supported_settings() -> dict[str, object]:
    return {
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "tokenizer_revision": MODEL_REVISION,
        "worker_sha256": worker_artifact(),
        "method": METHOD,
        "prompt_version": PROMPT_VERSION,
        "scoring": "ordered-choice-equality-v1",
        "device": "cpu",
        "dtype": "float32",
        "seed": 0,
        "threads": 1,
        "attention": "eager",
        "max_context_tokens": 2048,
        "max_seconds": MAX_SECONDS,
    }


def validate_specification(
    value: object, *, eligible: bool = True, supported: bool = True
) -> str:
    """Enforce runner support for new work, retain historical settings for recovery."""
    if not isinstance(value, dict):
        raise ValueError("missing_specification")
    settings = supported_settings()
    required = set(settings) | {
        "benchmark_id",
        "benchmark_version",
        "benchmark_sha256",
        "item_count",
        "commit_deadline",
        "reveal_deadline",
        "chain_id",
        "contract_address",
    }
    if set(value) != required:
        raise ValueError("unsupported_specification")
    if any(
        type(value[k]) is not type(v) or (supported and value[k] != v)
        for k, v in settings.items()
    ):
        raise ValueError("unsupported_configuration")
    for key in ("benchmark_id", "benchmark_version"):
        if not isinstance(value[key], str) or not value[key]:
            raise ValueError("invalid_specification")
    if not isinstance(value["benchmark_sha256"], str) or not re.fullmatch(
        r"[0-9a-f]{64}", value["benchmark_sha256"]
    ):
        raise ValueError("invalid_hash")
    for key in ("item_count", "chain_id", "commit_deadline", "reveal_deadline"):
        if type(value[key]) is not int or value[key] <= 0:
            raise ValueError("invalid_specification")
    if (
        value["item_count"] > MAX_ITEMS
        or value["reveal_deadline"] <= value["commit_deadline"]
    ):
        raise ValueError("invalid_specification")
    if not isinstance(value["contract_address"], str) or not re.fullmatch(
        r"0x[0-9a-fA-F]{40}", value["contract_address"]
    ):
        raise ValueError("invalid_contract")
    if eligible and time.time() >= value["commit_deadline"]:
        raise ValueError("expired_assignment")
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def verify_content(content: bytes, specification: str) -> None:
    spec = json.loads(specification)
    validate_specification(spec)
    if (
        len(content) > MAX_BYTES
        or sha256(content).hexdigest() != spec["benchmark_sha256"]
    ):
        raise ValueError("benchmark_integrity")
    benchmark = parse_benchmark(content)
    if (
        len(benchmark.items) != spec["item_count"]
        or benchmark.version != spec["benchmark_version"]
    ):
        raise ValueError("benchmark_identity")
