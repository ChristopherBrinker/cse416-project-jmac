# Evaluation pipeline E2E tests

Run from the repository root:

```sh
bun install --frozen-lockfile
bash packages/scheduler/e2e/setup.sh
(cd workers && uv sync --extra inference --extra provider --extra chain --locked)

mkdir -p workers/output

# Once per machine: populate the pinned model cache (about 269 MB of weights).
(cd workers && .venv/bin/python -m jmac_worker \
  --benchmark examples/benchmark.json --model smollm2-135m \
  --output output/e2e-warmup.json)

bun run test:e2e
```

Prerequisites are Bun, Foundry (`forge` and `anvil`), uv, Python 3.12, curl, unzip, and `shasum`. No Convex account, team deployment, browser wallet, or application environment files are needed. Setup downloads a pinned official Convex local-backend release for macOS or Linux. Test runs load cached model weights offline and need loopback networking; the Convex CLI may need internet access for deployment dependencies.

The harness starts its own Convex backend and Anvil node on dynamically allocated loopback ports, deploys the actual contract and backend functions, creates disposable users through Better Auth, signs provider wallet challenges, approves two independent providers, uploads the example benchmark over HTTP, and starts the actual scheduler. It observes installation of the scheduler's RPC event filter before funding a job. A transparent RPC proxy holds the first worker commit until both workers have signed against the pre-commit state, exercising the gas-estimation race on every success run. The worker reserves 50% gas headroom before signing, so the second transaction can emit its additional event without running out of gas. The test-only worker launcher retains otherwise-suppressed settlement tracebacks in the private logs and calls the real provider entrypoint. Backend deployment/code generation happens in a temporary project copy, leaving developer deployment settings untouched. The scheduler now sends signed transactions to the same configured `NET_URL` it uses for chain reads.

| Scenario | Execution | Assertions |
| --- | --- | --- |
| Success | Two real pinned SmolLM2 workers | Both evaluate the uploaded bytes; predictions agree; independent scoring and digest match the contract; both commit, reveal, and claim; backend records score and transaction hashes; assignments finish and capacity is released; duplicate payment is rejected. |
| Disagreement | Scripted providers commit different output digests with equal correct counts | The contract rejects agreement even when scores match; scheduler records failure and releases capacity; creator receives the exact escrow amount, accounting for gas. |
| Commit timeout | One provider commits; the other remains silent | Refund is rejected before the commit deadline and succeeds after it. |
| Reveal timeout | Both scripted providers commit but do not reveal | Refund is still rejected after the commit deadline and succeeds after the reveal deadline. |

Every refund scenario also rejects a different wallet, a second refund, and a provider payment claim. The fault scenarios deliberately use scripted contract transactions; they do not alter real worker results or pretend that model inference produced a disagreement.

This is a service E2E suite. It exercises real authentication, HTTP benchmark upload/download, storage, assignment subscriptions, inference, chain transactions, and scheduler event synchronization. It does not launch Next.js or assert dashboard rendering. Existing browser verification remains in `apps/web/e2e/verify-flows.mjs`; see `docs/demo.md` for those UI flows.

## Timeouts and isolation

The suite stops at the first failed scenario, because later cases share the stack. All service waits and subprocess commands are bounded. Services are terminated after success or failure and on SIGINT/SIGTERM. Each run writes private, git-ignored state under `.cache/e2e/run-*`, including service logs, worker results and transaction journals, a disposable backend database, and `evidence.json`. The runner prints the path before setup; inspect the named log on failure. These artifacts contain test credentials and private benchmark/result data; delete the run directory after debugging. Do not publish the entire directory as a CI artifact.

The four tests run serially in one isolated stack. Keep their order: real workers first, scripted disagreement second, then time travel. The tests do not reuse or reset an existing chain or database. Ports are allocated dynamically; a binding conflict fails setup rather than reusing another process's state.

Anvil time travel does not advance the Convex wall clock. The scheduler currently skips `JobFailed` when a timeout refund has already changed chain status to `Refunded`; backend timeout status/capacity cleanup waits for its normal wall-clock sweep. These timeout tests verify on-chain eligibility and refunds, not immediate backend cleanup. The final scenario raises provider capacity to accommodate that existing behavior. Success and disagreement require actual backend synchronization and capacity release; the harness never calls `job:setStatus` itself.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_CONVEX_BINARY` | `.cache/e2e/bin/convex-local-backend` | Compatible local backend executable; the setup script installs the pinned version here. |
| `E2E_PYTHON` | `workers/.venv/bin/python` | Interpreter with locked inference, provider, and chain extras installed. |
| `E2E_MODEL_CACHE` | `workers/.cache/huggingface` | Existing pinned model cache; model loading is offline. |

`bun run test` remains the fast unit-test suite. `bun run test:e2e` is separate because it starts real services and model processes. The evaluation E2E GitHub Actions workflow runs on relevant pull requests and can also be triggered manually. It caches the pinned model and uploads only the small evidence summary; raw service logs and credentials stay out of uploaded artifacts.
