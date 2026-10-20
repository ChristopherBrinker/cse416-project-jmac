"""Check verification failures without Docker, model weights, or a network."""

import io
import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
PROVIDER_SCRIPT = runpy.run_path(str(SCRIPTS_DIRECTORY / "verify-provider.py"))
WAIT_FOR_READINESS = PROVIDER_SCRIPT["wait_for_readiness"]
TEST_SECRET = PROVIDER_SCRIPT["TEST_SECRET"]


class VerificationTests(unittest.TestCase):
    def test_startup_crash_reports_output_and_exit_code_without_waiting(self) -> None:
        healthy = Mock(spec=Event)
        with tempfile.TemporaryFile(mode="w+t") as output:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    "import sys; print('startup diagnostic'); print(sys.argv[1]); sys.exit(7)",
                    TEST_SECRET,
                ],
                stdout=output,
                stderr=subprocess.STDOUT,
                text=True,
            )
            process.wait(timeout=5)
            with self.assertRaises(RuntimeError) as error:
                WAIT_FOR_READINESS(process, healthy, output)
        message = str(error.exception)
        self.assertIn("exit 7", message)
        self.assertIn("startup diagnostic", message)
        self.assertIn("[redacted]", message)
        self.assertNotIn(TEST_SECRET, message)
        healthy.wait.assert_not_called()

    def test_readiness_timeout_is_bounded(self) -> None:
        process = Mock()
        process.poll.return_value = None
        healthy = Mock(spec=Event)
        with patch.dict(
            WAIT_FOR_READINESS.__globals__, {"monotonic": Mock(side_effect=[0, 2])}
        ):
            with self.assertRaisesRegex(RuntimeError, "did not become ready"):
                WAIT_FOR_READINESS(process, healthy, io.StringIO(), timeout=1)
        healthy.wait.assert_not_called()

    def test_healthy_running_provider_returns(self) -> None:
        process = Mock()
        process.poll.return_value = None
        healthy = Event()
        healthy.set()
        WAIT_FOR_READINESS(process, healthy, io.StringIO())

    def test_container_verification_rejects_comma_paths_before_docker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / "docker"
            marker = root / "docker-called"
            docker.write_text('#!/bin/sh\n: > "$JMAC_TEST_DOCKER_MARKER"\nexit 1\n')
            docker.chmod(0o755)
            result = subprocess.run(
                [
                    "sh",
                    str(SCRIPTS_DIRECTORY / "verify-container.sh"),
                    "test-image",
                    str(root / "has,comma"),
                ],
                env={
                    **os.environ,
                    "PATH": f"{root}{os.pathsep}{os.environ['PATH']}",
                    "JMAC_TEST_DOCKER_MARKER": str(marker),
                },
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("commas", result.stderr)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
