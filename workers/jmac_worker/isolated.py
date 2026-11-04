"""Offline inference subprocess; diagnostics never leave its private pipes."""

import json
import sys
from pathlib import Path

from .inference import LocalModelRunner, Question


def main() -> None:
    try:
        request = json.load(sys.stdin)
        runner = LocalModelRunner(Path(request["cache_directory"]), offline=True)
        questions = [
            Question(q["item_id"], q["prompt"], tuple(q["choices"]))
            for q in request["questions"]
        ]
        json.dump(runner.predict(questions), sys.stdout)
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
