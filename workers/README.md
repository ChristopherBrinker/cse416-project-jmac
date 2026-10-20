# Evaluation worker

The worker validates a benchmark, runs a pinned local model or scores supplied predictions, and writes a result JSON file. Inference runs on CPU without a model API key, paid service, or GPU. A separate provider mode connects to Convex for readiness and heartbeats using a registered provider's secret.

## Setup

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run from the repository root:

```sh
cd workers
UV_CACHE_DIR=.cache/uv uv sync --extra inference --locked
```

`.python-version` selects Python 3.12.13. `pyproject.toml` pins PyTorch 2.14.1 and Transformers 5.20.1; `uv.lock` records transitive dependencies and their hashes. The environment, package cache, model cache, and generated results are ignored by Git. The default model cache is `workers/.cache/huggingface` regardless of the current working directory. `--cache-dir` can override it.

On Linux, the lockfile selects the official CPU-only PyTorch index (`2.14.1+cpu`). macOS continues using its existing PyPI wheel. No CUDA packages are needed.

## Connect as a provider

Register the provider through the account/frontend flow described in the [backend API guide](../packages/backend/README.md#provider). Configure its supported model and capacity while it is offline; this worker supports the pinned SmolLM2 model and should initially have capacity 1. Approval is managed in the backend. These account operations are separate from the worker's secret-based authentication.

From the repository root:

```sh
cp workers/.env.example workers/.env.provider
```

Fill in `CONVEX_URL`, `JMAC_PROVIDER_ID`, and `JMAC_PROVIDER_SECRET` in that file. Use the deployment URL ending in `.convex.cloud`, not the `.convex.site` HTTP actions URL. The environment file is ignored by Git and excluded from the Docker build context. Use one running worker per provider ID. No deploy/admin key or Better Auth session is needed by the worker.

From `workers/`, after setup:

```sh
UV_CACHE_DIR=.cache/uv uv run --env-file .env.provider --extra inference --locked \
  python -m jmac_worker.provider --offline
```

`--offline` restricts model loading to cached files; provider mutations still require network access. Omit it on a first local run if model files have not been downloaded. Configuration is validated before any model loading or requests. The worker then:

1. Authenticates by setting its provider status to `offline`.
2. Loads the pinned model and runs a small inference warmup, retaining the model in memory.
3. Sends a fresh heartbeat, then marks the provider `ready`.
4. Sends a heartbeat every 15 seconds by default.
5. Attempts to mark the provider `offline` on SIGINT, SIGTERM, startup failure, or an exhausted connection retry.

The optional `JMAC_HEARTBEAT_INTERVAL_SECONDS`, `JMAC_REQUEST_TIMEOUT_SECONDS`, and `JMAC_MAX_RETRIES` settings default to 15, 10, and 3 respectively. Retryable connection errors, HTTP 429, and temporary server errors use bounded exponential delays (1, 2, 4 seconds at the defaults). Authentication, validation, and function errors stop immediately. Retry waits are interrupted by shutdown signals. Shutdown makes one offline request bounded by the configured request timeout. Allow at least 30 seconds for container shutdown with the default settings.

Secrets are sent only in the mutation body over HTTPS (HTTP is allowed only for loopback development), omitted from configuration representations, and never included in worker logs. Remote error text and Convex `logLines` are discarded, and HTTP redirects are rejected. The transport follows the [Convex HTTP mutation protocol](https://docs.convex.dev/http-api/).

If the backend is unreachable or the process is forcibly killed, offline status cannot be guaranteed. The current backend does not yet schedule missing-heartbeat disconnection checks. Failed cleanup logs an explicit offline-status error so an operator can check the provider record.

This mode manages presence only. The backend now exposes `job:getJobsForProvider` and an authorized `GET /benchmark` download, but the worker does not yet call either interface or execute assigned jobs. The Evaluation contract accepts result-hash commitments; the worker makes no contract calls, and reveal, result comparison, refunds, and payouts are not yet implemented.

The [integration handoff](INTEGRATION.md) lists the backend and contract interfaces needed next, the remaining worker tasks, and the acceptance checks for a complete MVP job.

## Docker package

From the repository root, with Docker running:

```sh
docker build -t jmac-worker:0.4.0 workers
sh workers/scripts/verify-container.sh
```

The multi-stage build pins Python 3.12.13 and uv 0.12.3 images by digest, installs locked inference dependencies without development tools, downloads the pinned public model, and runs all unit tests with networking disabled. The runtime image includes the weights, tokenizer, upstream model card, and license notices. It defaults to user `10001:10001`, offline model loading, and `/output` as its working directory. No ports or services are exposed. The allowlist in `.dockerignore` excludes local environments, caches, credentials, private benchmarks, and results from the build context.

For provider presence, override the evaluation entrypoint and supply the environment file at runtime:

```sh
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev \
  --stop-timeout 30 \
  --env-file workers/.env.provider \
  --entrypoint /opt/worker/.venv/bin/python \
  jmac-worker:0.4.0 \
  -m jmac_worker.provider --cache-dir /opt/model-cache --offline
```

This mode needs outbound access to Convex; do not use `--network none` for a live provider. The model is already bundled and no model-hosting connection is needed. Ctrl+C or `docker stop` initiates offline cleanup. The image's default entrypoint continues to perform one-shot evaluations as below.

The verification script resolves the image ID once, starts two fresh containers with networking disabled and a read-only root filesystem, and compares the complete result files. A temporary `/tmp` mount permits transient library files; only the output directory persists. It writes `result-first.json`, `result-second.json`, and the exact `image-id.txt` to `workers/output/`. An image name and output directory can also be supplied:

```sh
sh workers/scripts/verify-container.sh jmac-worker:0.4.0 workers/output/custom
```

To evaluate a mounted benchmark, replace the example source file below with your own file:

```sh
mkdir -p workers/output
docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD/workers/examples/benchmark.json,target=/input/benchmark.json,readonly" \
  --mount "type=bind,source=$PWD/workers/output,target=/output" \
  jmac-worker:0.4.0 \
  --benchmark /input/benchmark.json \
  --model smollm2-135m \
  --output /output/result.json
```

The user override lets the container write bind-mounted output as your host user. Input files and the bundled model remain read-only. Supplied-prediction mode also works: mount a predictions JSON and use `--predictions /input/predictions.json` instead of `--model`.

Build for your deployment's architecture explicitly when it differs from your host:

```sh
docker build --platform linux/amd64 -t jmac-worker:0.4.0-amd64 workers
docker build --platform linux/arm64 -t jmac-worker:0.4.0-arm64 workers
```

Cross-architecture builds need Docker emulation or a matching native builder. Compare repeated runs of the same image and architecture; matching results across architectures or between macOS and Linux are not guaranteed. The runtime reports its actual Python/package versions and OS/architecture. The image supports one-shot CPU evaluation and the separate provider presence lifecycle. Assignment polling and contract calls remain separate work.

Rebuild the image from the current source before verification. Version `0.4.0` writes boolean score arrays using result schema `2.0.0`; earlier `0.3.0` images and exported archives write integer scores and do not include this change. Verification reports and exported images are local artifacts excluded from Git.

To share the exact built image without a registry, from the repository root:

```sh
mkdir -p workers/output
docker image save --output workers/output/jmac-worker-0.4.0.tar jmac-worker:0.4.0
```

A teammate can load it with `docker image load --input jmac-worker-0.4.0.tar`. Share the appropriate architecture and record the image ID alongside evaluation results. Rebuilding from pinned inputs does not promise an identical image ID; exporting the built image preserves the exact artifact.

## Run a real model

From `workers/`:

```sh
.venv/bin/python -m jmac_worker \
  --benchmark examples/benchmark.json \
  --model smollm2-135m \
  --output result-model-first.json
```

The first run downloads the public, ungated [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) model. Its safetensors weights are approximately 269 MB. Both model and tokenizer are pinned to revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`; loading disables remote model code and uses no authentication token. After downloading, evaluation can run offline. Benchmark contents are processed locally.

The inference layer receives only each item's ID, prompt, and choices. It never receives `correct_choice`. For each question it:

1. Numbers the choices from zero and asks for only the choice index, using the pinned tokenizer's chat template.
2. Computes the summed conditional log probability of each candidate index's token sequence. Prompt tokens are excluded from this sum. Labels containing multiple tokens are supported; no length normalization is applied.
3. Selects the highest likelihood, resolving exact ties with the lowest index. There is no sampling or free-form answer parsing.

The policy is `choice-index-log-likelihood-v1`, with prompt version `multiple-choice-index-v1`. It is a specific evaluation method, not a claim to match another benchmark harness's scoring protocol. Questions exceeding the 2048-token context budget, including the candidate index, fail with an error rather than being truncated.

## Check repeatability

Run a second evaluation in a fresh process using only cached model files:

```sh
.venv/bin/python -m jmac_worker \
  --benchmark examples/benchmark.json \
  --model smollm2-135m \
  --offline \
  --output result-model-second.json
cmp result-model-first.json result-model-second.json
```

`cmp` exits successfully without output when files are byte-for-byte identical. The runner uses CPU float32, eager attention, evaluation/inference mode, seed 0, one intra-op thread, one inter-op thread, and deterministic PyTorch algorithms. Results record these settings, worker/model/tokenizer revisions, Python/package versions, OS release, and architecture. They omit timestamps and timing data so these do not interfere with comparisons.

These settings support repeatability on the same hardware and software stack. [PyTorch does not guarantee identical results across platforms or releases](https://docs.pytorch.org/docs/stable/notes/randomness.html). The Docker package pins the user-space runtime; testing across provider machines remains future work.

## Score supplied predictions

This mode uses only the Python standard library and can run with Python 3.11+ without installing inference dependencies:

```sh
python3 -m jmac_worker \
  --benchmark examples/benchmark.json \
  --predictions examples/predictions.json \
  --output result.json
```

Use an interpreter of Python 3.11 or newer if your system's `python3` is older. The supplied predictions produce scores `[true, false, true]`, `correct: 2`, `total: 3`, and `accuracy: 0.6666666666666666`. These are fixed example predictions, not recorded model outputs. Choose exactly one of `--predictions` and `--model`.

## Benchmark format and results

Benchmarks follow the [backend format](../packages/backend/README.md#benchmark-file-format): schema version `1.0.0`, name, description, version, and a nonempty items array. Each item requires an item ID, prompt, nonempty choices, and a valid zero-based `correct_choice`. Description and version may be empty strings. Additional fields are ignored, matching the backend's validation behavior.

Predictions are a JSON array of zero-based integer choice indices, one per item in benchmark order. Missing or extra predictions, booleans, non-integer values, and out-of-range indices are errors. Each score is `true` for a correct prediction and `false` otherwise, preserving benchmark item order. Accuracy is correct answers divided by the total, on a scale of 0 to 1.

Result schema `2.0.0` replaces the integer score arrays from schema `1.0.0` with boolean arrays matching Solidity `bool[]`. Benchmark input schema remains `1.0.0`. Results include the result schema version, benchmark name/version and SHA-256 content hash, ordered item IDs, predictions, scores, correct count, total, and accuracy. Model runs additionally include an `inference` metadata object. The benchmark hash covers the original file bytes, matching the backend upload hash; whitespace changes the hash.

Results omit prompts, choices, and the answer key, but per-item predictions and scores should still be treated as private evaluation data. This JSON format is local to the worker and is not yet a contract submission or commitment format. Local scores match the contract's `bool[]` result field (`[true, false, ...]`). A future adapter must use the agreed contract encoding and hash algorithm for that ordered score vector, rather than hashing the local JSON or its benchmark SHA-256. Malformed inputs, missing files/model dependencies, inference failures, and context-limit violations return a nonzero exit code. Validation and inference finish before writing the output file. The output cannot be either input file.

## Development checks

From `workers/`, after setup:

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

Tests use synthetic model logits, mocked model loading, and mocked HTTP transport; they do not download model weights or access the network. They cover provider startup ordering, heartbeat cadence, bounded retries, signal handling, error handling, and secret redaction. Without inference dependencies, the original validation/scoring tests can still run independently:

```sh
python3 -m unittest discover -s tests -p test_worker.py -v
```

For a real-model lifecycle check without production credentials, from `workers/`:

```sh
mkdir -p output
PYTHONPATH=. .venv/bin/python scripts/verify-provider.py \
  --output output/provider-lifecycle.json
```

This uses cached model files and a local Convex-compatible HTTP stub. It starts real provider subprocesses, injects a temporary HTTP 503 failure, checks successful heartbeats, sends SIGTERM and SIGINT, and verifies offline cleanup and secret-safe logs. It needs permission to open a loopback port. This verifies transport and lifecycle against the current API contract, not authentication against a deployed Convex project. Live verification needs an actual registered provider ID and secret in `.env.provider`.

Benchmark validation lives in `jmac_worker/benchmark.py`, model inference in `jmac_worker/inference.py`, and scoring in `jmac_worker/scoring.py`. Provider transport is in `jmac_worker/provider_api.py`; the lifecycle is in `jmac_worker/provider.py`. Connecting the worker to the existing assignment/download APIs and implementing contract commit/reveal integration are subsequent milestones.
