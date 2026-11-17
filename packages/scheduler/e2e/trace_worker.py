"""Run the real provider, retaining suppressed settlement errors in private test logs."""

import os
import traceback
from pathlib import Path

from jmac_worker.commitments import CommitmentClient
from jmac_worker.provider import main

settle = CommitmentClient._settle


def traced_settle(self, result_path: Path, *, allow_commit: bool) -> bool:
    try:
        return settle(self, result_path, allow_commit=allow_commit)
    except Exception:
        descriptor = os.open(
            os.environ["E2E_WORKER_TRACE"],
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
            0o600,
        )
        with os.fdopen(descriptor, "w") as output:
            traceback.print_exc(file=output)
        raise


CommitmentClient._settle = traced_settle
main()
