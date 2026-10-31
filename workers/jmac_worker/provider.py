"""Run provider presence and optional assignment execution."""

import argparse
import logging
import os
import signal
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from functools import partial
from pathlib import Path
from threading import Event

from .inference import DEFAULT_CACHE_DIRECTORY, LocalModelRunner, Question
from .provider_api import ProviderAPIError, ProviderClient, ProviderConfig

LOGGER = logging.getLogger(__name__)


def config_from_environment(environment: Mapping[str, str]) -> ProviderConfig:
    required = ("CONVEX_URL", "JMAC_PROVIDER_ID", "JMAC_PROVIDER_SECRET")
    for name in required:
        if not environment.get(name):
            raise ValueError(f"Set {name} before starting the provider worker")

    def number(name: str, default: str) -> float:
        try:
            return float(environment.get(name, default))
        except ValueError:
            # Never include a malformed configuration value in the error message.
            raise ValueError(f"{name} must be a valid number") from None

    try:
        retries = int(environment.get("JMAC_MAX_RETRIES", "3"))
    except ValueError:
        raise ValueError(
            "JMAC_MAX_RETRIES must be an integer between 0 and 5"
        ) from None
    return ProviderConfig(
        deployment_url=environment["CONVEX_URL"],
        provider_id=environment["JMAC_PROVIDER_ID"],
        secret=environment["JMAC_PROVIDER_SECRET"],
        heartbeat_interval=number("JMAC_HEARTBEAT_INTERVAL_SECONDS", "15"),
        request_timeout=number("JMAC_REQUEST_TIMEOUT_SECONDS", "10"),
        max_retries=retries,
    )


class _ShutdownRequested(BaseException):
    # Model libraries must not swallow cancellation in broad exception/retry handlers.
    pass


class ModelStartupError(RuntimeError):
    pass


def _call_with_retries(
    operation: Callable[[], None], config: ProviderConfig, stop: Event
) -> None:
    for attempt in range(config.max_retries + 1):
        if stop.is_set():
            raise _ShutdownRequested
        try:
            operation()
            return
        except ProviderAPIError as error:
            if not error.retryable or attempt == config.max_retries:
                raise
            delay = 2**attempt
            LOGGER.warning(
                "Provider connection unavailable; retrying in %s seconds.", delay
            )
            if stop.wait(delay):
                raise _ShutdownRequested from None


def run_provider(
    config: ProviderConfig,
    client: ProviderClient,
    model_loader: Callable[[], LocalModelRunner],
    stop: Event,
    job_service: Callable[[LocalModelRunner, Event], None] | None = None,
) -> None:
    try:
        _call_with_retries(lambda: client.set_status("offline"), config, stop)
        if stop.is_set():
            return
        LOGGER.info("Provider offline. Loading and warming up the pinned model.")
        try:
            with shutdown_signals(stop, interrupt=True):
                if stop.is_set():
                    return
                runner = model_loader()
                if stop.is_set():
                    return
                runner.predict(
                    [Question("startup-check", "Select the only choice.", ("Ready",))]
                )
        except _ShutdownRequested:
            return
        except Exception as error:
            LOGGER.error("Pinned model startup failed (%s).", type(error).__name__)
            raise ModelStartupError(
                "Pinned model could not be loaded or warmed up."
            ) from None
        if stop.is_set():
            return
        _call_with_retries(client.heartbeat, config, stop)
        _call_with_retries(lambda: client.set_status("ready"), config, stop)
        if job_service is not None:
            LOGGER.info("Provider ready. Subscribing to assigned jobs.")
            job_service(runner, stop)
            return
        LOGGER.info(
            "Provider ready. Sending heartbeats; assignment execution is not enabled."
        )
        while not stop.wait(config.heartbeat_interval):
            _call_with_retries(client.heartbeat, config, stop)
    except _ShutdownRequested:
        return
    finally:
        try:
            # Always attempt cleanup: a stop or lost response may precede startup auth.
            client.set_status("offline")
            LOGGER.info("Provider offline.")
        except ProviderAPIError:
            LOGGER.error(
                "Could not confirm offline status; check the provider in the backend."
            )


@contextmanager
def shutdown_signals(stop: Event, *, interrupt: bool = False) -> Iterator[None]:
    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()
        if interrupt:
            raise _ShutdownRequested

    previous = {
        kind: signal.signal(kind, request_stop)
        for kind in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        yield
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Connect the pinned worker to the provider API."
    )
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIRECTORY)
    parser.add_argument(
        "--commit-results",
        action="store_true",
        help="Submit saved assignment scores to the contract (requires --execute-jobs and chain extra)",
    )
    parser.add_argument(
        "--execute-jobs",
        action="store_true",
        help="Subscribe to assigned jobs and save local results (requires provider extra)",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use cached model files only; backend requests still use networking",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        if args.commit_results and not args.execute_jobs:
            raise ValueError("--commit-results requires --execute-jobs")
        config = config_from_environment(os.environ)
        client = ProviderClient(config)
        job_service = None
        if args.execute_jobs:
            from .jobs import job_config_from_environment, run_jobs

            jobs = job_config_from_environment(os.environ)
            jobs.output_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            commit_result = None
            if args.commit_results:
                from .commitments import CommitmentClient, chain_config_from_environment

                chain = CommitmentClient(chain_config_from_environment(os.environ))
                commit_result = chain.submit
            job_service = partial(run_jobs, jobs, client, commit_result=commit_result)
        stop = Event()
        loader = partial(LocalModelRunner, args.cache_dir, offline=args.offline)
        with shutdown_signals(stop):
            run_provider(config, client, loader, stop, job_service)
    except (ValueError, ProviderAPIError, ModelStartupError) as error:
        parser.exit(1, f"error: {error}\n")
    except Exception:
        # Third-party exceptions can include URLs, request payloads, or environment values.
        parser.exit(1, "error: Provider worker failed during startup or execution.\n")


if __name__ == "__main__":
    main()
