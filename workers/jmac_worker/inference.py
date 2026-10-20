"""Pinned CPU inference using only public question data, never answer keys."""

from __future__ import annotations

import math
import os
import platform
from collections.abc import Sequence
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING

from . import __version__

if TYPE_CHECKING:
    from torch import Tensor


MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
MODEL_REVISION = "12fd25f77366fa6b3b4b768ec3050bf629380bac"
MODEL_ALIAS = "smollm2-135m"
SEED = 0
MAX_CONTEXT_TOKENS = 2048
PROMPT_VERSION = "multiple-choice-index-v1"
METHOD = "choice-index-log-likelihood-v1"
DEFAULT_CACHE_DIRECTORY = Path(__file__).resolve().parents[1] / ".cache" / "huggingface"


@dataclass(frozen=True, slots=True)
class Question:
    """The model's entire input contract; answer keys are deliberately absent."""

    item_id: str
    prompt: str
    choices: tuple[str, ...]


def build_messages(question: Question) -> list[dict[str, str]]:
    choices = "\n".join(
        f"{index}. {choice}" for index, choice in enumerate(question.choices)
    )
    return [
        {
            "role": "user",
            "content": (
                "Choose the correct answer to this multiple-choice question.\n"
                "Respond with only the zero-based choice index.\n\n"
                f"Question: {question.prompt}\n\nChoices:\n{choices}"
            ),
        }
    ]


def select_choice(log_likelihoods: Sequence[float]) -> int:
    """Break exact ties using the lowest index; reject invalid model scores."""
    if not log_likelihoods or not all(
        math.isfinite(score) for score in log_likelihoods
    ):
        raise ValueError("Model must return finite likelihoods for all choices")
    return max(range(len(log_likelihoods)), key=log_likelihoods.__getitem__)


def continuation_log_likelihood(
    logits: Tensor, input_ids: Tensor, prompt_length: int
) -> float:
    """Sum log probabilities of completion tokens with causal next-token alignment."""
    import torch

    completion = input_ids[0, prompt_length:]
    next_token_logits = logits[0, prompt_length - 1 : -1, :]
    log_probabilities = torch.log_softmax(next_token_logits, dim=-1)
    selected = log_probabilities.gather(1, completion.unsqueeze(1))
    return float(selected.sum().item())


class LocalModelRunner:
    def __init__(
        self, cache_directory: Path = DEFAULT_CACHE_DIRECTORY, *, offline: bool = False
    ) -> None:
        cache_directory = cache_directory.resolve()
        os.environ.setdefault("HF_XET_CACHE", str(cache_directory / "xet"))
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as error:
            raise RuntimeError(
                "Model inference requires its dependencies. From workers/, run "
                "UV_CACHE_DIR=.cache/uv uv sync --extra inference --locked."
            ) from error

        torch.manual_seed(SEED)
        torch.set_num_threads(1)
        if torch.get_num_interop_threads() != 1:
            torch.set_num_interop_threads(1)
        torch.use_deterministic_algorithms(True)

        loading_options = {
            "revision": MODEL_REVISION,
            "cache_dir": str(cache_directory),
            "local_files_only": offline,
            "trust_remote_code": False,
            "token": False,
        }
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, **loading_options)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            **loading_options,
            dtype=torch.float32,
            attn_implementation="eager",
            use_safetensors=True,
        ).to("cpu")
        self.model.eval()
        self.max_context_tokens = min(
            MAX_CONTEXT_TOKENS, self.model.config.max_position_embeddings
        )

    def predict(self, questions: Sequence[Question]) -> list[int]:
        import torch

        predictions: list[int] = []
        with torch.inference_mode():
            for question in questions:
                prompt = self.tokenizer.apply_chat_template(
                    build_messages(question), tokenize=False, add_generation_prompt=True
                )
                prompt_ids = self.tokenizer.encode(prompt, add_special_tokens=False)
                candidates = [
                    self.tokenizer.encode(str(index), add_special_tokens=False)
                    for index in range(len(question.choices))
                ]
                if any(
                    len(prompt_ids) + len(candidate) > self.max_context_tokens
                    for candidate in candidates
                ):
                    raise ValueError(
                        f"Item {question.item_id!r} exceeds the "
                        f"{self.max_context_tokens}-token context limit; "
                        "questions are never silently truncated"
                    )

                likelihoods: list[float] = []
                for candidate in candidates:
                    input_ids = torch.tensor([prompt_ids + candidate], dtype=torch.long)
                    logits = self.model(
                        input_ids=input_ids,
                        attention_mask=torch.ones_like(input_ids),
                        use_cache=False,
                        return_dict=True,
                    ).logits
                    likelihoods.append(
                        continuation_log_likelihood(logits, input_ids, len(prompt_ids))
                    )
                predictions.append(select_choice(likelihoods))
        return predictions

    def metadata(self) -> dict[str, object]:
        import torch

        return {
            "worker_version": __version__,
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "tokenizer_revision": MODEL_REVISION,
            "method": METHOD,
            "prompt_version": PROMPT_VERSION,
            "device": "cpu",
            "dtype": "float32",
            "attention_implementation": "eager",
            "seed": SEED,
            "threads": torch.get_num_threads(),
            "interop_threads": torch.get_num_interop_threads(),
            "deterministic_algorithms": torch.are_deterministic_algorithms_enabled(),
            "max_context_tokens": self.max_context_tokens,
            "runtime": {
                "python": platform.python_version(),
                "system": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
                "packages": {
                    name: version(name)
                    for name in (
                        "torch",
                        "transformers",
                        "tokenizers",
                        "safetensors",
                        "huggingface-hub",
                        "numpy",
                    )
                },
            },
        }
