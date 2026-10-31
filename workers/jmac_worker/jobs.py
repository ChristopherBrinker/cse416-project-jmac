"""Subscribe to assignments and save one local evaluation per provider/job/model."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from pathlib import Path
from threading import Event
from typing import Protocol

from .benchmark import parse_benchmark
from .inference import LocalModelRunner, Question
from .output import atomic_output
from .provider_api import ProviderAPIError, ProviderClient, validate_deployment_url
from .scoring import RESULT_SCHEMA_VERSION, score_benchmark

LOGGER = logging.getLogger(__name__)
SHUTDOWN_POLL_SECONDS = 0.1
COMMIT_POLL_SECONDS = 2


@dataclass(frozen=True)
class JobConfig:
    http_url: str
    model_id: str
    output_directory: Path

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "http_url", validate_deployment_url(self.http_url, http_actions=True)
        )
        if not self.model_id or any(character.isspace() for character in self.model_id):
            raise ValueError("JMAC_MODEL_ID must identify the pinned model in Convex")


def job_config_from_environment(environment: Mapping[str, str]) -> JobConfig:
    for name in ("CONVEX_HTTP_URL", "JMAC_MODEL_ID", "JMAC_RESULTS_DIRECTORY"):
        if not environment.get(name):
            raise ValueError(f"Set {name} before enabling assignment execution")
    return JobConfig(
        environment["CONVEX_HTTP_URL"],
        environment["JMAC_MODEL_ID"],
        Path(environment["JMAC_RESULTS_DIRECTORY"]).resolve(),
    )


@dataclass(frozen=True)
class Assignment:
    job_id: str
    provider_id: str
    model_id: str

    def identity(self) -> dict[str, str]:
        return {
            "job_id": self.job_id,
            "provider_id": self.provider_id,
            "model_id": self.model_id,
        }


def parse_assignments(value: object, provider_id: str) -> tuple[Assignment, ...]:
    if not isinstance(value, list):
        raise ProviderAPIError("Assignment subscription returned an invalid result.")
    assignments = []
    for record in value:
        if not isinstance(record, dict) or any(
            not isinstance(record.get(field), str) or not record[field]
            for field in ("jobId", "providerId", "modelId")
        ):
            raise ProviderAPIError(
                "Assignment subscription returned an invalid record."
            )
        if record["providerId"] != provider_id or record.get("finished") is not False:
            raise ProviderAPIError(
                "Assignment subscription returned unauthorized work."
            )
        assignments.append(
            Assignment(record["jobId"], record["providerId"], record["modelId"])
        )
    return tuple(dict.fromkeys(assignments))


class Subscription(Protocol):
    def __aiter__(self) -> AsyncIterator[object]: ...

    def unsubscribe(self) -> None: ...


def subscribe(client: ProviderClient) -> Subscription:
    try:
        from convex import ConvexClient
    except ImportError:
        raise ValueError(
            "Install the worker provider extra to execute assignments"
        ) from None
    sdk = ConvexClient(client.config.deployment_url)
    return sdk.subscribe(
        "job:getJobsForProvider",
        {"providerId": client.config.provider_id, "secret": client.config.secret},
    )


def result_path(config: JobConfig, assignment: Assignment) -> Path:
    # Opaque backend identifiers must never become filesystem paths.
    key = json.dumps(assignment.identity(), sort_keys=True).encode()
    return config.output_directory / f"{sha256(key).hexdigest()}.json"


def has_saved_result(config: JobConfig, assignment: Assignment) -> bool:
    path = result_path(config, assignment)
    if not path.exists():
        return False
    try:
        document = json.loads(path.read_bytes())
        valid = (
            isinstance(document, dict)
            and document.get("assignment") == assignment.identity()
            and document.get("schema_version") == RESULT_SCHEMA_VERSION
            and isinstance(document.get("scores"), list)
            and bool(document["scores"])
            and all(type(score) is bool for score in document["scores"])
        )
    except (ValueError, OSError):
        valid = False
    if not valid:
        raise ValueError(
            "Saved assignment result is invalid; inspect the results directory"
        )
    return True


def evaluate(content: bytes, runner: LocalModelRunner) -> dict[str, object]:
    benchmark = parse_benchmark(content)
    questions = [
        Question(item.item_id, item.prompt, item.choices) for item in benchmark.items
    ]
    document = score_benchmark(benchmark, runner.predict(questions)).to_dict()
    document["inference"] = runner.metadata()
    return document


async def retry(operation: Callable[[], object], client: ProviderClient) -> object:
    for attempt in range(client.config.max_retries + 1):
        try:
            return await asyncio.to_thread(operation)
        except ProviderAPIError as error:
            if not error.retryable or attempt == client.config.max_retries:
                raise
            await asyncio.sleep(2**attempt)
    raise AssertionError("Retry loop exhausted")


async def execute_jobs(
    config: JobConfig,
    client: ProviderClient,
    runner: LocalModelRunner,
    stop: Event,
    subscription: Subscription,
    commit_result: Callable[[Path], bool] | None = None,
) -> None:
    latest: tuple[Assignment, ...] = ()
    changed = asyncio.Event()
    attempted: set[Assignment] = set()

    async def receive() -> None:
        nonlocal latest
        try:
            async for value in subscription:
                latest = parse_assignments(value, client.config.provider_id)
                changed.set()
            raise ProviderAPIError("Assignment subscription ended unexpectedly.")
        except Exception:
            # SDK errors may contain the function arguments, including the secret.
            raise ProviderAPIError("Assignment subscription failed.") from None

    async def work() -> None:
        while True:
            await changed.wait()
            changed.clear()
            for assignment in latest:
                if stop.is_set():
                    return
                if assignment in attempted:
                    continue
                attempted.add(assignment)
                if assignment.model_id != config.model_id:
                    LOGGER.warning("Assignment rejected: unsupported model ID.")
                    continue
                if has_saved_result(config, assignment):
                    continue
                try:
                    content = await retry(
                        partial(
                            client.download_benchmark,
                            config.http_url,
                            assignment.job_id,
                        ),
                        client,
                    )
                    if stop.is_set() or assignment not in latest:
                        continue
                    inference = asyncio.create_task(
                        asyncio.to_thread(evaluate, content, runner)
                    )
                    try:
                        document = await asyncio.shield(inference)
                    except asyncio.CancelledError:
                        # Native inference cannot be cancelled safely. Drain it before
                        # releasing the runner; heartbeats remain active during this wait.
                        await inference
                        raise
                    if stop.is_set() or assignment not in latest:
                        continue
                    document["assignment"] = assignment.identity()
                    with atomic_output(result_path(config, assignment)) as output:
                        output.write(
                            json.dumps(document, indent=2, allow_nan=False) + "\n"
                        )
                    LOGGER.info(
                        "Assigned evaluation saved locally; contract submission is pending."
                    )
                except Exception as error:
                    LOGGER.error(
                        "Assigned evaluation failed (%s); no result saved.",
                        type(error).__name__,
                    )

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(client.config.heartbeat_interval)
            await retry(client.heartbeat, client)

    async def stopped() -> None:
        while not stop.is_set():
            await asyncio.sleep(SHUTDOWN_POLL_SECONDS)

    async def commit_saved_results() -> None:
        confirmed: set[Assignment] = set()
        while not stop.is_set():
            for assignment in latest:
                if stop.is_set():
                    return
                if assignment.model_id != config.model_id or assignment in confirmed:
                    continue
                if not has_saved_result(config, assignment):
                    continue
                operation = asyncio.create_task(
                    asyncio.to_thread(commit_result, result_path(config, assignment))
                )
                try:
                    success = await asyncio.shield(operation)
                except asyncio.CancelledError:
                    await operation
                    raise
                except Exception:
                    raise ProviderAPIError(
                        "Contract commitment failed; inspect chain configuration and transaction journals."
                    ) from None
                if not success:
                    # Resolve one pending transaction before signing for another job.
                    break
                confirmed.add(assignment)
                LOGGER.info("Saved scores confirmed in the contract commitment.")
            await asyncio.sleep(COMMIT_POLL_SECONDS)

    receiver = asyncio.create_task(receive())
    worker = asyncio.create_task(work())
    pulse = asyncio.create_task(heartbeat())
    shutdown = asyncio.create_task(stopped())
    committer = asyncio.create_task(commit_saved_results()) if commit_result else None
    tasks = [receiver, worker, pulse, shutdown]
    if committer is not None:
        tasks.append(committer)
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        receiver.cancel()
        shutdown.cancel()
        worker.cancel()
        await asyncio.gather(receiver, shutdown, worker, return_exceptions=True)
        if committer is not None:
            committer.cancel()
            await asyncio.gather(committer, return_exceptions=True)
        pulse.cancel()
        await asyncio.gather(pulse, return_exceptions=True)


def run_jobs(
    config: JobConfig,
    client: ProviderClient,
    runner: LocalModelRunner,
    stop: Event,
    *,
    commit_result: Callable[[Path], bool] | None = None,
) -> None:
    config.output_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    subscription = subscribe(client)
    try:
        asyncio.run(
            execute_jobs(config, client, runner, stop, subscription, commit_result)
        )
    finally:
        try:
            subscription.unsubscribe()
        except Exception:
            LOGGER.error("Could not confirm assignment subscription cleanup.")
