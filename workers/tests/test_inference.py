"""Check model scoring and integration without downloading model weights."""

import io
import json
import math
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import torch

from jmac_worker.__main__ import main
from jmac_worker.inference import (
    MODEL_ID,
    MODEL_REVISION,
    LocalModelRunner,
    Question,
    build_messages,
    continuation_log_likelihood,
    select_choice,
)

BENCHMARK_PATH = Path(__file__).resolve().parents[1] / "examples" / "benchmark.json"


class InferenceTests(unittest.TestCase):
    def make_runner(self, *, offline: bool = True) -> LocalModelRunner:
        self.tokenizer = Mock()
        self.model = Mock()
        self.model.to.return_value = self.model
        self.model.config.max_position_embeddings = 8192
        with (
            patch(
                "transformers.AutoTokenizer.from_pretrained",
                return_value=self.tokenizer,
            ) as self.load_tokenizer,
            patch(
                "transformers.AutoModelForCausalLM.from_pretrained",
                return_value=self.model,
            ) as self.load_model,
        ):
            return LocalModelRunner(Path("unused-test-cache"), offline=offline)

    def test_model_input_has_no_answer_key(self) -> None:
        question = Question("example", "What is 2 + 2?", ("3", "4"))
        self.assertEqual(set(asdict(question)), {"item_id", "prompt", "choices"})
        self.assertEqual(
            build_messages(question),
            [
                {
                    "role": "user",
                    "content": (
                        "Choose the correct answer to this multiple-choice question.\n"
                        "Respond with only the zero-based choice index.\n\n"
                        "Question: What is 2 + 2?\n\nChoices:\n0. 3\n1. 4"
                    ),
                }
            ],
        )

    def test_selects_largest_likelihood_and_first_exact_tie(self) -> None:
        self.assertEqual(select_choice([-5.0, -1.0, -3.0]), 1)
        self.assertEqual(select_choice([-1.0, -1.0, -2.0]), 0)
        self.assertEqual(select_choice([-4.0]), 0)

    def test_rejects_invalid_likelihoods(self) -> None:
        for scores in ([], [float("nan")], [0.0, float("inf")], [float("-inf")]):
            with self.subTest(scores=scores):
                with self.assertRaisesRegex(ValueError, "finite likelihoods"):
                    select_choice(scores)

    def test_likelihood_uses_only_completion_with_causal_alignment(self) -> None:
        logits = torch.log(
            torch.tensor(
                [
                    [
                        [0.9, 0.1],
                        [0.25, 0.75],
                        [0.6, 0.4],
                        [0.99, 0.01],
                    ]
                ]
            )
        )
        input_ids = torch.tensor([[1, 0, 1, 0]])
        actual = continuation_log_likelihood(logits, input_ids, prompt_length=2)
        self.assertAlmostEqual(actual, math.log(0.75) + math.log(0.6), places=6)
        single = continuation_log_likelihood(logits[:, :3], input_ids[:, :3], 2)
        self.assertAlmostEqual(single, math.log(0.75), places=6)

    def test_loads_exact_model_and_tokenizer_on_cpu(self) -> None:
        runner = self.make_runner()
        for loader in (self.load_model, self.load_tokenizer):
            self.assertEqual(loader.call_args.args, (MODEL_ID,))
            self.assertEqual(loader.call_args.kwargs["revision"], MODEL_REVISION)
            self.assertTrue(loader.call_args.kwargs["local_files_only"])
            self.assertFalse(loader.call_args.kwargs["token"])
            self.assertFalse(loader.call_args.kwargs["trust_remote_code"])
        self.assertTrue(self.load_model.call_args.kwargs["use_safetensors"])
        self.assertEqual(self.load_model.call_args.kwargs["dtype"], torch.float32)
        self.assertEqual(
            self.load_model.call_args.kwargs["attn_implementation"], "eager"
        )
        self.model.to.assert_called_once_with("cpu")
        self.model.eval.assert_called_once()
        metadata = runner.metadata()
        self.assertEqual(metadata["model_revision"], MODEL_REVISION)
        self.assertEqual(metadata["threads"], 1)
        self.assertEqual(metadata["interop_threads"], 1)
        self.assertTrue(metadata["deterministic_algorithms"])

    def test_predicts_from_model_logits_including_multitoken_labels(self) -> None:
        runner = self.make_runner()
        self.tokenizer.apply_chat_template.return_value = "chat prompt"
        self.tokenizer.encode.side_effect = lambda text, **_: {
            "chat prompt": [0, 1],
            "0": [2],
            "1": [3],
            "2": [4, 5],
        }[text]
        inference_modes = []

        def forward(*, input_ids: torch.Tensor, **_: object) -> SimpleNamespace:
            inference_modes.append(torch.is_inference_mode_enabled())
            logits = torch.zeros((1, input_ids.shape[1], 6))
            logits[0, 1, 3] = 5.0
            return SimpleNamespace(logits=logits)

        self.model.side_effect = forward
        question = Question("test", "Pick one", ("first", "second", "third"))
        self.assertEqual(runner.predict([question]), [1])
        self.assertEqual(inference_modes, [True, True, True])
        for call in self.model.call_args_list:
            self.assertFalse(call.kwargs["use_cache"])
            self.assertEqual(call.kwargs["input_ids"].device.type, "cpu")

    def test_rejects_long_context_without_truncation(self) -> None:
        runner = self.make_runner()
        self.tokenizer.apply_chat_template.return_value = "long prompt"
        self.tokenizer.encode.side_effect = lambda text, **_: (
            [0] * 2048 if text == "long prompt" else [1]
        )
        with self.assertRaisesRegex(ValueError, "context limit"):
            runner.predict([Question("too-long", "question", ("only choice",))])
        self.model.assert_not_called()


class InferenceCommandTests(unittest.TestCase):
    def test_cli_scores_model_predictions_and_records_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            args = [
                "jmac_worker",
                "--benchmark",
                str(BENCHMARK_PATH),
                "--model",
                "smollm2-135m",
                "--offline",
                "--output",
                str(output),
            ]
            with (
                patch("sys.argv", args),
                patch("jmac_worker.__main__.LocalModelRunner") as factory,
            ):
                factory.return_value.predict.return_value = [0, 2, 0]
                factory.return_value.metadata.return_value = {"model_id": MODEL_ID}
                main()
                self.assertTrue(factory.call_args.kwargs["offline"])
                questions = factory.return_value.predict.call_args.args[0]
                self.assertEqual(
                    [q.item_id for q in questions],
                    [
                        "arithmetic",
                        "capital",
                        "comparison",
                    ],
                )
                self.assertTrue(
                    all(not hasattr(q, "correct_choice") for q in questions)
                )
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result["predictions"], [0, 2, 0])
            self.assertEqual(result["scores"], [0, 1, 0])
            self.assertEqual(result["inference"]["model_id"], MODEL_ID)

    def test_inference_failure_preserves_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            output.write_text("existing result", encoding="utf-8")
            args = [
                "jmac_worker",
                "--benchmark",
                str(BENCHMARK_PATH),
                "--model",
                "smollm2-135m",
                "--output",
                str(output),
            ]
            with (
                patch("sys.argv", args),
                patch("sys.stderr", new_callable=io.StringIO),
                patch("jmac_worker.__main__.LocalModelRunner") as factory,
            ):
                factory.return_value.predict.side_effect = RuntimeError(
                    "inference failed"
                )
                with self.assertRaises(SystemExit) as error:
                    main()
                self.assertEqual(error.exception.code, 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "existing result")


if __name__ == "__main__":
    unittest.main()
