"""Check provider protocol, lifecycle ordering, retries, and secret-safe failures."""

import io
import json
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import MagicMock, Mock, call, patch
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler

from jmac_worker.provider import (
    ModelStartupError,
    config_from_environment,
    main,
    run_provider,
    shutdown_signals,
)
from jmac_worker.provider_api import (
    MAX_RESPONSE_BYTES,
    ProviderAPIError,
    ProviderClient,
    ProviderConfig,
    _NoRedirects,
)

SECRET = "test-only-secret-must-not-appear-in-logs"
ENVIRONMENT = {
    "CONVEX_URL": "https://example.convex.cloud/",
    "JMAC_PROVIDER_ID": "test-provider",
    "JMAC_PROVIDER_SECRET": SECRET,
}


class ProviderConfigurationTests(unittest.TestCase):
    def test_configuration_defaults_and_secret_repr(self) -> None:
        config = config_from_environment(ENVIRONMENT)
        self.assertEqual(config.deployment_url, "https://example.convex.cloud")
        self.assertEqual(config.heartbeat_interval, 15)
        self.assertEqual(config.request_timeout, 10)
        self.assertEqual(config.max_retries, 3)
        self.assertNotIn(SECRET, repr(config))

    def test_required_configuration(self) -> None:
        for field in ENVIRONMENT:
            with self.subTest(field=field):
                environment = dict(ENVIRONMENT)
                del environment[field]
                with self.assertRaisesRegex(ValueError, field):
                    config_from_environment(environment)

    def test_accepts_https_and_loopback_http(self) -> None:
        for url in (
            "https://self-hosted.example:8080",
            "http://localhost:3210",
            "http://127.0.0.1:8080",
            "http://[::1]:3210",
        ):
            with self.subTest(url=url):
                self.assertEqual(ProviderConfig(url, "id", SECRET).deployment_url, url)

    def test_rejects_unsafe_or_incorrect_urls(self) -> None:
        for url in (
            "http://example.convex.cloud",
            "https://example.convex.site",
            "https://example.convex.site.",
            "https://EXAMPLE.CONVEX.SITE.:443/",
            "https://example.convex.site..",
            "https://example.convex.site\u3002",
            "https://example.convex.site\uff0e",
            "https://example.convex.site\uff61",
            "https://convex.site.",
            "https://user:password@example.convex.cloud",
            "https://example.convex.cloud/path",
            f"https://example.convex.cloud?secret={SECRET}",
            "https://example.convex.cloud#fragment",
            "http://127.0.0.1.example.com",
            "https://example.convex.cloud:bad",
            "https://example.convex.cloud:0",
            "https://bad host.example",
            "not-a-url",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as error:
                    ProviderConfig(url, "id", SECRET)
                self.assertNotIn(SECRET, str(error.exception))

    def test_normalizes_dns_trailing_dots_before_host_checks(self) -> None:
        for url, expected in (
            ("https://EXAMPLE.convex.cloud.:443/", "https://example.convex.cloud:443"),
            ("http://localhost.:3210", "http://localhost:3210"),
        ):
            with self.subTest(url=url):
                self.assertEqual(
                    ProviderConfig(url, "id", SECRET).deployment_url, expected
                )

    def test_rejects_invalid_numbers_without_echoing_values(self) -> None:
        cases = {
            "JMAC_HEARTBEAT_INTERVAL_SECONDS": ("0", "nan", "inf", "301", SECRET),
            "JMAC_REQUEST_TIMEOUT_SECONDS": ("-1", "nan", "61", SECRET),
            "JMAC_MAX_RETRIES": ("-1", "6", "1.5", SECRET),
        }
        for name, values in cases.items():
            for value in values:
                with self.subTest(name=name, value=value):
                    with self.assertRaisesRegex(ValueError, name) as error:
                        config_from_environment({**ENVIRONMENT, name: value})
                    self.assertNotIn(SECRET, str(error.exception))

    def test_rejects_whitespace_credentials(self) -> None:
        for field in ("JMAC_PROVIDER_ID", "JMAC_PROVIDER_SECRET"):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, field):
                    config_from_environment({**ENVIRONMENT, field: " value "})


class ProviderClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = ProviderClient(config_from_environment(ENVIRONMENT))
        self.opener = Mock()
        self.response = MagicMock()
        self.response.__enter__.return_value = self.response
        self.response.read.return_value = json.dumps(
            {
                "status": "success",
                "value": {"success": True},
                "logLines": [SECRET],
            }
        ).encode()
        self.opener.open.return_value = self.response
        self.client._opener = self.opener

    def test_heartbeat_wire_contract_and_timeout(self) -> None:
        self.client.heartbeat()
        request = self.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.convex.cloud/api/mutation")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(
            json.loads(request.data),
            {
                "path": "provider:heartbeat",
                "args": {"providerId": "test-provider", "secret": SECRET},
                "format": "json",
            },
        )
        self.assertEqual(self.opener.open.call_args.kwargs["timeout"], 10)

    def test_status_wire_contract(self) -> None:
        for status in ("ready", "offline"):
            with self.subTest(status=status):
                self.client.set_status(status)
                payload = json.loads(self.opener.open.call_args.args[0].data)
                self.assertEqual(payload["path"], "provider:setStatus")
                self.assertEqual(payload["args"]["newStatus"], status)
                self.assertEqual(payload["args"]["secret"], SECRET)

    def test_backend_errors_and_log_lines_are_not_exposed(self) -> None:
        for document in (
            {"status": "error", "errorMessage": SECRET, "logLines": [SECRET]},
            {"status": "success", "value": {"success": False, "error": SECRET}},
            {
                "status": "success",
                "value": {"success": False, "error": "Invalid authentication"},
            },
            {
                "status": "success",
                "value": {"success": False, "error": "Provider not found"},
            },
            {"status": "success", "value": None},
        ):
            with self.subTest(document=document):
                self.response.read.return_value = json.dumps(document).encode()
                with self.assertRaises(ProviderAPIError) as error:
                    self.client.heartbeat()
                self.assertFalse(error.exception.retryable)
                self.assertNotIn(SECRET, str(error.exception))

    def test_invalid_and_oversized_responses_fail_safely(self) -> None:
        for body in (SECRET.encode(), b"[]", b"\xff", b"x" * (MAX_RESPONSE_BYTES + 1)):
            with self.subTest(length=len(body)):
                self.response.read.return_value = body
                with self.assertRaises(ProviderAPIError) as error:
                    self.client.heartbeat()
                self.assertNotIn(SECRET, str(error.exception))

    def test_http_errors_are_classified_and_sanitized(self) -> None:
        for status, retryable in (
            (429, True),
            (503, True),
            (500, True),
            (400, False),
            (401, False),
            (403, False),
            (302, False),
            (560, False),
        ):
            with self.subTest(status=status):
                self.opener.open.side_effect = HTTPError(
                    "https://example", status, SECRET, {}, None
                )
                with self.assertRaises(ProviderAPIError) as error:
                    self.client.heartbeat()
                self.assertEqual(error.exception.retryable, retryable)
                self.assertNotIn(SECRET, str(error.exception))

    def test_transport_errors_are_retryable_without_echoing_exception(self) -> None:
        self.opener.open.side_effect = URLError(SECRET)
        with self.assertRaises(ProviderAPIError) as error:
            self.client.heartbeat()
        self.assertTrue(error.exception.retryable)
        self.assertNotIn(SECRET, str(error.exception))

    def test_redirects_are_not_followed(self) -> None:
        client = ProviderClient(config_from_environment(ENVIRONMENT))
        handlers = [
            handler
            for handler in client._opener.handlers
            if isinstance(handler, HTTPRedirectHandler)
        ]
        self.assertEqual(len(handlers), 1)
        self.assertIsInstance(handlers[0], _NoRedirects)
        self.assertIsNone(
            handlers[0].redirect_request(
                None, None, 302, "redirect", {}, "https://other.example"
            )
        )


class ProviderLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = config_from_environment(ENVIRONMENT)
        self.events = []
        self.stop = Mock(spec=Event)
        self.stop.is_set.return_value = False
        self.stop.wait.side_effect = [False, True]
        self.client = Mock(spec=ProviderClient)
        self.client.set_status.side_effect = lambda status: self.events.append(status)
        self.client.heartbeat.side_effect = lambda: self.events.append("heartbeat")
        self.runner = Mock()
        self.runner.predict.side_effect = lambda _questions: self.events.append(
            "warmup"
        )
        self.loader = Mock(side_effect=self.load_model)

    def load_model(self) -> Mock:
        self.events.append("load")
        return self.runner

    def test_lifecycle_orders_model_warmup_before_ready(self) -> None:
        run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(
            self.events,
            ["offline", "load", "warmup", "heartbeat", "ready", "heartbeat", "offline"],
        )
        self.stop.wait.assert_has_calls([call(15.0), call(15.0)])

    def test_job_service_starts_after_ready_and_receives_loaded_runner(self) -> None:
        service = Mock(side_effect=lambda *_: self.events.append("jobs"))
        run_provider(self.config, self.client, self.loader, self.stop, service)
        self.assertEqual(
            self.events,
            ["offline", "load", "warmup", "heartbeat", "ready", "jobs", "offline"],
        )
        service.assert_called_once_with(self.runner, self.stop)

    def test_model_failure_never_marks_ready_and_attempts_offline(self) -> None:
        self.loader.side_effect = RuntimeError(SECRET)
        with self.assertLogs("jmac_worker.provider", level="ERROR") as logs:
            with self.assertRaises(ModelStartupError) as error:
                run_provider(self.config, self.client, self.loader, self.stop)
        self.assertNotIn(SECRET, str(error.exception))
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn(SECRET, "\n".join(logs.output))
        self.assertEqual(self.events, ["offline", "offline"])

    def test_shutdown_before_startup_still_attempts_offline(self) -> None:
        self.stop.is_set.return_value = True
        run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.events, ["offline"])
        self.loader.assert_not_called()

    def test_shutdown_after_load_skips_warmup_and_ready(self) -> None:
        def load() -> Mock:
            self.stop.is_set.return_value = True
            return self.runner

        self.loader.side_effect = load
        run_provider(self.config, self.client, self.loader, self.stop)
        self.runner.predict.assert_not_called()
        self.assertEqual(self.events, ["offline", "offline"])

    def test_shutdown_after_lost_startup_response_still_attempts_offline(self) -> None:
        self.client.set_status.side_effect = [
            ProviderAPIError("Unavailable.", retryable=True),
            None,
        ]
        self.stop.wait.side_effect = [True]
        with self.assertLogs("jmac_worker.provider", level="WARNING"):
            run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(
            self.client.set_status.call_args_list, [call("offline"), call("offline")]
        )
        self.loader.assert_not_called()

    def test_shutdown_during_model_loading_skips_ready(self) -> None:
        self.runner.predict.side_effect = lambda _: setattr(
            self.stop.is_set, "return_value", True
        )
        run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.events, ["offline", "load", "offline"])

    def test_invalid_startup_credentials_fail_before_loading(self) -> None:
        self.client.set_status.side_effect = ProviderAPIError(
            "Invalid provider credentials."
        )
        with self.assertLogs("jmac_worker.provider", level="ERROR"):
            with self.assertRaises(ProviderAPIError):
                run_provider(self.config, self.client, self.loader, self.stop)
        self.loader.assert_not_called()
        self.stop.wait.assert_not_called()

    def test_transient_failure_retries_before_readiness(self) -> None:
        self.client.heartbeat.side_effect = [
            ProviderAPIError("Unavailable.", retryable=True),
            None,
        ]
        self.stop.wait.side_effect = [False, True]
        with self.assertLogs("jmac_worker.provider", level="INFO") as logs:
            run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.client.heartbeat.call_count, 2)
        self.assertEqual(
            self.client.set_status.call_args_list,
            [call("offline"), call("ready"), call("offline")],
        )
        self.assertEqual(self.stop.wait.call_args_list, [call(1), call(15.0)])
        self.assertNotIn(SECRET, "\n".join(logs.output))

    def test_permanent_heartbeat_error_is_not_retried(self) -> None:
        self.client.heartbeat.side_effect = ProviderAPIError(
            "Provider authentication failed."
        )
        with self.assertRaises(ProviderAPIError):
            run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.client.heartbeat.call_count, 1)
        self.assertEqual(
            self.client.set_status.call_args_list, [call("offline"), call("offline")]
        )
        self.stop.wait.assert_not_called()

    def test_retry_exhaustion_stops_and_attempts_offline(self) -> None:
        self.client.heartbeat.side_effect = [None] + [
            ProviderAPIError("Unavailable.", retryable=True)
        ] * 4
        self.stop.wait.side_effect = [False] * 4
        with self.assertLogs("jmac_worker.provider", level="WARNING"):
            with self.assertRaises(ProviderAPIError):
                run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.client.heartbeat.call_count, 5)
        self.assertEqual(
            self.stop.wait.call_args_list, [call(15.0), call(1), call(2), call(4)]
        )
        self.assertEqual(
            self.client.set_status.call_args_list,
            [call("offline"), call("ready"), call("offline")],
        )

    def test_shutdown_interrupts_retry_delay(self) -> None:
        self.client.heartbeat.side_effect = ProviderAPIError(
            "Unavailable.", retryable=True
        )
        self.stop.wait.side_effect = [True]
        with self.assertLogs("jmac_worker.provider", level="WARNING"):
            run_provider(self.config, self.client, self.loader, self.stop)
        self.assertEqual(self.client.heartbeat.call_count, 1)
        self.assertEqual(
            self.client.set_status.call_args_list, [call("offline"), call("offline")]
        )

    def test_offline_failure_is_reported_without_secret(self) -> None:
        self.stop.wait.side_effect = [True]
        self.client.set_status.side_effect = [None, None, ProviderAPIError(SECRET)]
        with self.assertLogs("jmac_worker.provider", level="ERROR") as logs:
            run_provider(self.config, self.client, self.loader, self.stop)
        self.assertIn("Could not confirm offline status", "\n".join(logs.output))
        self.assertNotIn(SECRET, "\n".join(logs.output))

    def test_signal_handlers_stop_and_restore(self) -> None:
        previous = {
            kind: signal.getsignal(kind) for kind in (signal.SIGINT, signal.SIGTERM)
        }
        stop = Event()
        with shutdown_signals(stop):
            handler = signal.getsignal(signal.SIGTERM)
            handler(signal.SIGTERM, None)
            self.assertTrue(stop.is_set())
        for kind, handler in previous.items():
            self.assertEqual(signal.getsignal(kind), handler)


class StartupSignalTests(unittest.TestCase):
    def test_real_signals_interrupt_blocked_load_and_warmup_and_run_cleanup(
        self,
    ) -> None:
        child = """
import sys
import time
from pathlib import Path
from threading import Event
from jmac_worker.provider import run_provider, shutdown_signals
from jmac_worker.provider_api import ProviderConfig

phase, directory = sys.argv[1:]
root = Path(directory)
def block():
    (root / "startup").write_text(phase)
    while True:
        try:
            time.sleep(600)
        except Exception:
            continue
class Client:
    def set_status(self, status):
        with (root / "statuses").open("a") as output:
            output.write(status + "\\n")
    def heartbeat(self):
        pass
class Runner:
    def predict(self, questions):
        if phase == "warmup":
            block()
def load():
    if phase == "load":
        block()
    return Runner()
stop = Event()
with shutdown_signals(stop):
    run_provider(ProviderConfig("http://localhost:3210", "test-provider", "test-secret"), Client(), load, stop)
"""
        for phase in ("load", "warmup"):
            for stop_signal in (signal.SIGINT, signal.SIGTERM):
                with self.subTest(phase=phase, stop_signal=stop_signal.name):
                    with tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        process = subprocess.Popen(
                            [sys.executable, "-c", child, phase, directory],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            text=True,
                        )
                        try:
                            deadline = time.monotonic() + 5
                            while (
                                not (root / "startup").exists()
                                and process.poll() is None
                                and time.monotonic() < deadline
                            ):
                                time.sleep(0.01)
                            self.assertTrue(
                                (root / "startup").exists(),
                                "Child did not enter startup",
                            )
                            process.send_signal(stop_signal)
                            logs, _ = process.communicate(timeout=3)
                            self.assertEqual(process.returncode, 0, logs)
                            self.assertEqual(
                                (root / "statuses").read_text().splitlines(),
                                ["offline", "offline"],
                            )
                        finally:
                            if process.poll() is None:
                                process.kill()
                            process.communicate(timeout=3)


class ProviderCommandTests(unittest.TestCase):
    def test_missing_configuration_exits_before_model_loading(self) -> None:
        with (
            patch("sys.argv", ["jmac_worker.provider"]),
            patch.dict("os.environ", {}, clear=True),
            patch("jmac_worker.provider.LocalModelRunner") as loader,
            patch("sys.stderr", new_callable=io.StringIO) as stderr,
        ):
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 1)
            self.assertIn("Set CONVEX_URL", stderr.getvalue())
            loader.assert_not_called()

    def test_missing_subscription_dependency_fails_before_provider_startup(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch("sys.argv", ["jmac_worker.provider", "--execute-jobs"]),
                patch.dict(
                    "os.environ",
                    {
                        **ENVIRONMENT,
                        "CONVEX_HTTP_URL": "https://example.convex.site",
                        "JMAC_MODEL_ID": "model",
                        "JMAC_RESULTS_DIRECTORY": directory,
                    },
                    clear=True,
                ),
                patch.dict("sys.modules", {"convex": None}),
                patch("jmac_worker.provider.run_provider") as run,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                with self.assertRaises(SystemExit):
                    main()
                self.assertIn("provider extra", stderr.getvalue())
                run.assert_not_called()

    def test_unexpected_exception_is_not_printed(self) -> None:
        with (
            patch("sys.argv", ["jmac_worker.provider"]),
            patch.dict("os.environ", ENVIRONMENT, clear=True),
            patch(
                "jmac_worker.provider.run_provider", side_effect=RuntimeError(SECRET)
            ),
            patch("sys.stderr", new_callable=io.StringIO) as stderr,
        ):
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 1)
            self.assertNotIn(SECRET, stderr.getvalue())
            self.assertNotIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
