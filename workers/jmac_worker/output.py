"""Preflight result destinations and replace files only after a complete write."""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import TextIO


@contextmanager
def atomic_output(path: Path) -> Iterator[TextIO]:
    """Create a private sibling file before evaluation; preserve old results on failure."""
    if not path.parent.is_dir():
        raise ValueError("Output directory must exist and be a directory")
    if path.exists() and not path.is_file():
        raise ValueError("Output destination must be a regular file")
    if not os.access(path.parent, os.W_OK | os.X_OK) or (
        path.exists() and not os.access(path, os.W_OK)
    ):
        raise ValueError("Output destination is not writable")

    temporary_path = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".jmac-result-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            yield temporary
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
