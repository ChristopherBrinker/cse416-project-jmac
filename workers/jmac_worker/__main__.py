"""Run local scoring with ``python3 -m jmac_worker``."""

import argparse
import json
from pathlib import Path

from .benchmark import load_benchmark
from .inference import DEFAULT_CACHE_DIRECTORY, MODEL_ALIAS, LocalModelRunner, Question
from .output import atomic_output
from .scoring import score_benchmark


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate a local JMAC benchmark using predictions or a pinned model."
    )
    parser.add_argument(
        "--benchmark", type=Path, required=True, help="Benchmark JSON file"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--predictions", type=Path, help="JSON array of choice indices")
    source.add_argument(
        "--model", choices=[MODEL_ALIAS], help="Run the pinned local model on CPU"
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIRECTORY,
        help="Model cache directory (default: workers/.cache/huggingface)",
    )
    parser.add_argument(
        "--offline", action="store_true", help="Load model files from cache only"
    )
    parser.add_argument(
        "--output", type=Path, default=Path("result.json"), help="Result JSON file"
    )
    args = parser.parse_args()

    try:
        input_paths = [args.benchmark.resolve()]
        if args.predictions is not None:
            input_paths.append(args.predictions.resolve())
        if args.output.resolve() in input_paths:
            raise ValueError(
                "Output must be different from the benchmark and predictions files"
            )
        with atomic_output(args.output.resolve()) as output:
            benchmark = load_benchmark(args.benchmark)
            inference_metadata = None
            if args.predictions is not None:
                predictions = json.loads(args.predictions.read_text(encoding="utf-8"))
            else:
                questions = [
                    Question(item.item_id, item.prompt, item.choices)
                    for item in benchmark.items
                ]
                runner = LocalModelRunner(args.cache_dir, offline=args.offline)
                predictions = runner.predict(questions)
                inference_metadata = runner.metadata()
            result = score_benchmark(benchmark, predictions)
            document = result.to_dict()
            if inference_metadata is not None:
                document["inference"] = inference_metadata
            output.write(json.dumps(document, indent=2, allow_nan=False) + "\n")
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
