"""Verify the real provider process against a local Convex-compatible HTTP stub."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread

from jmac_worker.inference import DEFAULT_CACHE_DIRECTORY, MODEL_ID, MODEL_REVISION

TEST_SECRET = "local-smoke-test-secret-not-a-real-provider-credential"


@dataclass
class State:
    retry_once: bool
    ready: bool = False
    events: list[str] = field(default_factory=list)
    healthy: Event = field(default_factory=Event)


class StubServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, state: State) -> None:
        self.state = state
        super().__init__(("127.0.0.1", 0), StubHandler)


class StubHandler(BaseHTTPRequestHandler):
    server: StubServer

    def log_message(self, _format: str, *_arguments: object) -> None:
        pass

    def do_POST(self) -> None:
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        arguments = payload.get("args", {})
        valid = (
            self.path == "/api/mutation"
            and payload.get("format") == "json"
            and arguments.get("secret") == TEST_SECRET
            and arguments.get("providerId") == "smoke-test-provider"
        )
        status = 200
        if not valid:
            status = 400
        elif payload.get("path") == "provider:setStatus":
            new_status = arguments.get("newStatus")
            if new_status not in ("ready", "offline"):
                status = 400
            else:
                self.server.state.events.append(new_status)
                self.server.state.ready = new_status == "ready"
        elif payload.get("path") == "provider:heartbeat":
            if self.server.state.retry_once:
                self.server.state.retry_once = False
                self.server.state.events.append("transient-503")
                status = 503
            else:
                self.server.state.events.append("heartbeat")
                if self.server.state.ready:
                    self.server.state.healthy.set()
        else:
            status = 400
        # Include an echoed credential to prove that remote logs are discarded.
        body = json.dumps(
            {
                "status": "success",
                "value": {"success": status == 200},
                "logLines": [TEST_SECRET],
            }
        ).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def verify_run(
    cache: Path, stop_signal: signal.Signals, *, retry: bool
) -> dict[str, object]:
    state = State(retry_once=retry)
    server = StubServer(state)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    process = None
    try:
        environment = {
            **os.environ,
            "CONVEX_URL": f"http://127.0.0.1:{server.server_address[1]}",
            "JMAC_PROVIDER_ID": "smoke-test-provider",
            "JMAC_PROVIDER_SECRET": TEST_SECRET,
            "JMAC_HEARTBEAT_INTERVAL_SECONDS": "0.1",
            "JMAC_REQUEST_TIMEOUT_SECONDS": "2",
            "JMAC_MAX_RETRIES": "1",
        }
        with tempfile.TemporaryFile(mode="w+t") as output:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "jmac_worker.provider",
                    "--cache-dir",
                    str(cache),
                    "--offline",
                ],
                env=environment,
                stdout=output,
                stderr=subprocess.STDOUT,
            )
            if not state.healthy.wait(60):
                raise RuntimeError(
                    "Provider did not become ready and send a periodic heartbeat"
                )
            process.send_signal(stop_signal)
            code = process.wait(timeout=15)
            output.seek(0)
            logs = output.read()
        if (
            code != 0
            or TEST_SECRET in logs
            or "Traceback" in logs
            or "Provider ready." not in logs
        ):
            raise RuntimeError(
                "Provider failed shutdown or secret-redaction verification"
            )
        if state.events[0] != "offline" or state.events[-1] != "offline":
            raise RuntimeError("Provider did not complete offline startup and shutdown")
        ready_index = state.events.index("ready")
        if "heartbeat" not in state.events[:ready_index]:
            raise RuntimeError(
                "Provider advertised readiness before its initial heartbeat"
            )
        if retry and "retrying in 1 seconds" not in logs:
            raise RuntimeError(
                "Transient server failure did not trigger a bounded retry"
            )
        return {
            "signal": stop_signal.name,
            "exit_code": code,
            "events": state.events,
            "secret_redaction": "passed",
            "model_loaded_and_warmed_up": "Provider ready." in logs,
        }
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIRECTORY)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = {
        "transport": "local Convex-compatible HTTP stub; not a live deployment",
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "runs": [
            verify_run(args.cache_dir, signal.SIGTERM, retry=True),
            verify_run(args.cache_dir, signal.SIGINT, retry=False),
        ],
    }
    document = json.dumps(report, indent=2) + "\n"
    if args.output is not None:
        args.output.write_text(document, encoding="utf-8")
    sys.stdout.write(document)


if __name__ == "__main__":
    main()
