"""Exercise assignment execution without a backend or model downloads."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import MagicMock, Mock
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from jmac_worker.jobs import (
    Assignment,
    JobConfig,
    execute_jobs,
    has_saved_result,
    parse_assignments,
    result_path,
)
from jmac_worker.provider_api import (
    MAX_BENCHMARK_BYTES,
    ProviderAPIError,
    ProviderClient,
    ProviderConfig,
)

RECORD = {
    "jobId": "job",
    "providerId": "provider",
    "modelId": "model",
    "finished": False,
}
ASSIGNMENT = Assignment("job", "provider", "model")
BENCHMARK = (
    Path(__file__).resolve().parents[1] / "examples/benchmark.json"
).read_bytes()


class FakeSubscription:
    def __init__(self):
        self.updates = asyncio.Queue()

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.updates.get()


class ValidationTests(unittest.TestCase):
    def test_rejects_malformed_finished_and_other_provider_assignments(self):
        for value in (
            None,
            {},
            [None],
            [{**RECORD, "finished": True}],
            [{**RECORD, "providerId": "other"}],
            [{**RECORD, "modelId": None}],
        ):
            with self.subTest(value=value), self.assertRaises(ProviderAPIError):
                parse_assignments(value, "provider")
        self.assertEqual(parse_assignments([RECORD, RECORD], "provider"), (ASSIGNMENT,))

    def test_paths_cannot_escape_output_directory(self):
        config = JobConfig("https://example.convex.site", "model", Path("output"))
        self.assertEqual(
            result_path(config, Assignment("../../escape", "p", "m")).parent,
            config.output_directory,
        )


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.client = ProviderClient(
            ProviderConfig("https://example.convex.cloud", "provider", "secret")
        )
        self.response = MagicMock()
        self.response.__enter__.return_value = self.response
        self.response.read.return_value = BENCHMARK
        self.client._opener = Mock()
        self.client._opener.open.return_value = self.response

    def test_download_preserves_bytes_and_authenticates(self):
        self.assertEqual(
            self.client.download_benchmark("https://example.convex.site", "a/b"),
            BENCHMARK,
        )
        request = self.client._opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        url = urlsplit(request.full_url)
        self.assertEqual(url.path, "/benchmark")
        self.assertEqual(
            parse_qs(url.query),
            {"jobId": ["a/b"], "providerId": ["provider"], "secret": ["secret"]},
        )

    def test_limit_and_errors_are_safe(self):
        self.response.read.return_value = b"x" * (MAX_BENCHMARK_BYTES + 1)
        with self.assertRaises(ProviderAPIError):
            self.client.download_benchmark("https://example.convex.site", "job")
        self.client._opener.open.side_effect = HTTPError(
            "https://example?secret=secret", 403, "secret", {}, None
        )
        with self.assertRaises(ProviderAPIError) as error:
            self.client.download_benchmark("https://example.convex.site", "job")
        self.assertNotIn("secret", str(error.exception))
        self.assertFalse(error.exception.retryable)


class ExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = JobConfig(
            "https://example.convex.site", "model", Path(self.directory.name)
        )
        self.client = Mock(spec=ProviderClient)
        self.client.config = ProviderConfig(
            "https://example.convex.cloud", "provider", "secret", heartbeat_interval=0.1
        )
        self.client.download_benchmark.return_value = BENCHMARK
        self.runner = Mock()
        self.runner.predict.return_value = [1, 0, 1]
        self.runner.metadata.return_value = {"revision": "pinned"}
        self.stop = Event()
        self.subscription = FakeSubscription()
        self.task = asyncio.create_task(
            execute_jobs(
                self.config, self.client, self.runner, self.stop, self.subscription
            )
        )

    async def asyncTearDown(self):
        self.stop.set()
        await asyncio.wait_for(self.task, 3)

    async def wait_for(self, predicate):
        async with asyncio.timeout(3):
            while not predicate():
                await asyncio.sleep(0.01)

    async def test_download_evaluate_and_restart_deduplication(self):
        await self.subscription.updates.put([RECORD, RECORD])
        path = result_path(self.config, ASSIGNMENT)
        await self.wait_for(path.exists)
        document = json.loads(path.read_bytes())
        self.assertEqual(document["assignment"], ASSIGNMENT.identity())
        self.assertEqual(document["scores"], [True, False, True])
        self.assertTrue(has_saved_result(self.config, ASSIGNMENT))
        self.assertTrue(
            all(
                not hasattr(q, "correct_choice")
                for q in self.runner.predict.call_args.args[0]
            )
        )
        await self.subscription.updates.put([RECORD])
        await asyncio.sleep(0.05)
        self.runner.predict.assert_called_once()
        self.stop.set()
        await self.task
        self.stop.clear()
        self.task = asyncio.create_task(
            execute_jobs(
                self.config, self.client, self.runner, self.stop, self.subscription
            )
        )
        await self.subscription.updates.put([RECORD])
        await asyncio.sleep(0.15)
        self.runner.predict.assert_called_once()
        self.client.download_benchmark.assert_called_once()

    async def test_heartbeats_continue_and_removed_assignment_is_not_saved(self):
        entered, release = Event(), Event()
        self.addCleanup(release.set)

        def predict(_questions):
            entered.set()
            release.wait(2)
            return [1, 0, 1]

        self.runner.predict.side_effect = predict
        await self.subscription.updates.put([RECORD])
        await self.wait_for(entered.is_set)
        await self.wait_for(lambda: self.client.heartbeat.call_count >= 2)
        await self.subscription.updates.put([])
        await asyncio.sleep(0.05)
        release.set()
        await asyncio.sleep(0.1)
        self.assertFalse(result_path(self.config, ASSIGNMENT).exists())

    async def test_unsupported_model_rejected_before_download(self):
        await self.subscription.updates.put([{**RECORD, "modelId": "unsupported"}])
        await asyncio.sleep(0.15)
        self.client.download_benchmark.assert_not_called()
        self.runner.predict.assert_not_called()

    async def test_invalid_benchmark_does_not_publish_or_leak_contents(self):
        self.client.download_benchmark.return_value = b"private invalid JSON"
        with self.assertLogs("jmac_worker.jobs", level="ERROR") as logs:
            await self.subscription.updates.put([RECORD])
            await self.wait_for(lambda: self.client.download_benchmark.call_count == 1)
            await asyncio.sleep(0.05)
        self.assertNotIn("private invalid JSON", "\n".join(logs.output))
        self.assertFalse(result_path(self.config, ASSIGNMENT).exists())
        self.runner.predict.assert_not_called()

    async def test_shutdown_drains_inference_without_publishing(self):
        entered, release = Event(), Event()
        self.addCleanup(release.set)

        def predict(_questions):
            entered.set()
            release.wait(2)
            return [1, 0, 1]

        self.runner.predict.side_effect = predict
        await self.subscription.updates.put([RECORD])
        await self.wait_for(entered.is_set)
        self.stop.set()
        await asyncio.sleep(0.25)
        self.assertFalse(self.task.done())
        self.assertGreaterEqual(self.client.heartbeat.call_count, 1)
        release.set()
        await asyncio.wait_for(self.task, 3)
        self.assertFalse(result_path(self.config, ASSIGNMENT).exists())

    async def test_saved_results_are_committed_after_restart_without_inference(self):
        from unittest.mock import patch

        await self.subscription.updates.put([RECORD])
        path = result_path(self.config, ASSIGNMENT)
        await self.wait_for(path.exists)
        self.stop.set()
        await self.task
        self.stop.clear()
        submit = Mock(return_value=True)
        with patch("jmac_worker.jobs.COMMIT_POLL_SECONDS", 0.02):
            self.task = asyncio.create_task(
                execute_jobs(
                    self.config,
                    self.client,
                    self.runner,
                    self.stop,
                    self.subscription,
                    submit,
                )
            )
            await self.subscription.updates.put([RECORD])
            await self.wait_for(lambda: submit.call_count == 1)
            await asyncio.sleep(0.05)
            submit.assert_called_once_with(path)
            self.runner.predict.assert_called_once()
            self.stop.set()
            await self.task

    async def test_shutdown_finishes_when_draining_inference_raises(self):
        entered, release = Event(), Event()
        self.addCleanup(release.set)

        def predict(_questions):
            entered.set()
            release.wait(2)
            raise ValueError("synthetic inference failure")

        self.runner.predict.side_effect = predict
        await self.subscription.updates.put([RECORD])
        await self.wait_for(entered.is_set)
        self.stop.set()
        await asyncio.sleep(0.15)
        release.set()
        done, _ = await asyncio.wait([self.task], timeout=0.5)
        if not done:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        self.assertTrue(done, "Inference error swallowed shutdown cancellation")
        self.assertFalse(result_path(self.config, ASSIGNMENT).exists())


class SavedResultTests(unittest.TestCase):
    def test_inconsistent_saved_results_are_rejected(self):
        from jmac_worker.jobs import evaluate

        runner = Mock()
        runner.predict.return_value = [1, 0, 1]
        runner.metadata.return_value = {"revision": "pinned"}
        document = evaluate(BENCHMARK, runner)
        document["assignment"] = ASSIGNMENT.identity()
        corruptions = {
            "scores": [True],
            "predictions": [0],
            "item_ids": ["one"],
            "total": 1,
            "correct": 0,
            "accuracy": 1.0,
            "benchmark": {},
            "inference": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            config = JobConfig("https://example.convex.site", "model", Path(directory))
            path = result_path(config, ASSIGNMENT)
            for field, value in corruptions.items():
                with self.subTest(field=field):
                    path.write_text(json.dumps({**document, field: value}))
                    with self.assertRaises(ValueError):
                        has_saved_result(config, ASSIGNMENT)

    def test_cloud_origin_is_rejected_for_benchmark_download(self):
        with self.assertRaises(ValueError):
            JobConfig("https://example.convex.cloud", "model", Path("output"))

    def test_other_deployment_is_rejected_before_secret_is_sent(self):
        client = ProviderClient(
            ProviderConfig("https://example.convex.cloud", "provider", "secret")
        )
        client._opener = Mock()
        with self.assertRaises(ValueError):
            client.download_benchmark("https://other.convex.site", "job")
        client._opener.open.assert_not_called()
