# Worker integration handoff

The `0.4.0` worker runs the pinned model, scores benchmarks, produces repeatable local results, and manages provider presence. Completing a job from the backend is the next MVP milestone. This handoff distinguishes the available interfaces from the remaining integration requirements.

## Current boundary

Current source capabilities (deployment verification remains outstanding):

- `provider:setStatus` and `provider:heartbeat` accept a registered provider ID and secret. The worker implements these calls, loads and warms the model before becoming ready, and attempts offline cleanup on shutdown.
- The scheduler observes `JobFunded`, calls `job:assignProviders`, and submits the selected providers to the contract. The backend stores `job_assignments` and exposes `job:getJobsForProvider` using the provider ID and secret.
- The backend exposes an assignment-authorized `GET /benchmark?jobId=&providerId=&secret=` download. The opt-in `--execute-jobs` worker now subscribes to assignments, downloads benchmarks, and saves local evaluation results while continuing heartbeats. See the [backend guide](../packages/backend/README.md).
- `contracts/src/Evaluation.sol` implements funding, provider assignment, and `commitResult(jobId, bytes32)`. It stores one nonzero commitment per assigned provider and emits `CommitComplete` once both are stored. It now implements `revealResult`, score comparison, `JobComplete`/`JobFailed`, provider `claimPayment`, creator `refund`, and commit/reveal deadlines.
- The worker now supports opt-in `--commit-results` with a dedicated registered-wallet signer. It uses the M4 bound, salted output-digest commitment ([protocol](../docs/m4/protocol.md)), validates the on-chain assignment, and persists signed transactions before broadcasting so restarts reconcile instead of signing duplicates. The worker now reveals only after the matching `CommitComplete` event and claims only after `JobComplete`. Durable phase journals and event replay support restart and assignment removal. Live deployment verification remains outstanding.

Local unit tests and real-model lifecycle checks against a Convex-compatible HTTP stub pass. Authentication against an actual deployment still needs a registered provider's credentials; no live deployment verification has been performed.

## Backend handoff

Provider-authorized work delivery and benchmark access now exist. The worker adapter can target those interfaces; the remaining information and behavior to coordinate with the backend owner are:

- An assignment identifier, job identifier, assigned provider, benchmark identifier and original-file SHA-256 hash, and model identifier with an immutable revision. A model display name alone cannot select a reproducible runner.
- Job/benchmark/model metadata for each assignment: `job:getJobsForProvider` returns job and model IDs, without the benchmark hash or immutable model revision. The worker uses `JMAC_MODEL_ID` as an explicit mapping to its pinned local runner. Define how the worker obtains those values, deadlines, and conditions for losing an assignment. Start with one concurrent job per provider.
- Preserve the original benchmark bytes returned by the download and verify their expected content hash before evaluation; parsing and reserializing the JSON changes the bytes. Keep the existing download's query-string secret out of logs and error messages.
- Defined behavior for retries, duplicate delivery, restarts, cancellation, and expiry so a repeated request cannot create a second logical execution or complete an expired assignment.
- A way to report execution failure and retrieve the authoritative job/assignment state. Decide how result artifacts are stored and authorized separately from on-chain settlement.
- Missing-heartbeat handling so a killed or unreachable worker eventually stops receiving work.

For the first model, map the backend model record to `HuggingFaceTB/SmolLM2-135M-Instruct` at revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`. The worker currently supports only that model. Configure model support and capacity while the registered provider is offline.

## Contract handoff

The registry/escrow owner has supplied the initial contract and ABIs. The contract now defines the settlement flow and 5-minute commit / 2.5-minute reveal windows (`COMMIT_WINDOW` / `REVEAL_WINDOW` in `contracts/src/Evaluation.sol`). Current integration boundaries:

- M4 result policy: providers agree on a keyed digest of the ordered predicted choice indices plus the correct count; per-item correctness stays in the private result file (schema `3.0.0`). Worker metadata varies across machines and is not part of result agreement.
- The worker commitment binds chain, contract, job, provider wallet, spec hash and item count, and is salted; the contract `resultCommitment` view and the worker share one test vector. See [docs/m4/protocol.md](../docs/m4/protocol.md). The local JSON file itself is not hashed.
- A reveal function that hashes the supplied boolean array, validates it against that provider's commitment, and compares both revealed arrays. Matching arrays should enable completion and separate payout claims; disagreement should enable failure and a separate refund. These functions and events are now implemented.
- How workers observe commit completion, reveal results, handle failed transactions or expired jobs, and request payment. Confirm which responsibilities belong in the worker and which belong in the backend.

## Remaining worker work

1. Implemented: secret-authenticated assignment subscription and benchmark download (`--execute-jobs`).
2. Check assignment ownership, deadlines, model revision, and benchmark hash; reject unsupported or changed inputs before inference.
3. Implemented: one active evaluation while heartbeats continue; answer keys stay outside model inputs and private benchmark contents stay out of logs.
4. Local successful results now persist by provider/job/model identity and are skipped after restart. Opt-in commitment submission now persists signed bytes before broadcast and reconciles existing on-chain state or pending transactions. Event-gated reveal and payment claims are implemented. Artifact submission remains separate work.
5. Run the shared acceptance checks below against the actual backend and contract.

## MVP acceptance checks

- A real registered provider loads its model before `ready`, updates `lastHeartbeat`, and returns to `offline` after a normal stop.
- A funded job reaches the intended providers, which can download the benchmark; an unrelated provider cannot obtain it.
- A changed benchmark hash or unsupported model revision fails before inference and does not produce a success result.
- Two providers using the agreed pinned runtime evaluate the same benchmark and successfully commit/reveal results under the contract's comparison policy. Test agreement across the actual provider machines; local repeatability alone does not establish this.
- Redelivery and a worker restart do not double-complete or double-pay the job.
- A provider failure or missed deadline follows the agreed job-failure/refund path rather than leaving the job pending indefinitely.

## Message for the team

> The worker and Docker package are ready for local evaluation, and provider readiness/heartbeats are implemented. Main now has assignments, authorized benchmark downloads, and contract commitments. The opt-in worker now subscribes, downloads, evaluates, and saves results with restart deduplication. It still needs the expected benchmark hash from the backend and backend event synchronization; model mapping currently uses an explicit deployment configuration. The worker now supports opt-in M4 output-digest commitments with durable transaction journals. Reveal/comparison, refunds, payouts, and deadlines now exist in the contract. Worker settlement handles reveal and payment events; creator refunds are available from the dashboard settlement receipt. Live provider authentication is still unverified.

## M4 handoff update

The worker now requires the immutable `specification` object described in [README](README.md#m4-assignment-integrity-interface-proposal-pending-backend-adoption). This is a proposed interface, not an agreement already obtained from teammates.

- Chris: freeze and authorize every field, publish it on subscriptions, mirror byte, item and text limits, confirm backend state for assignment/removal/settlement. Match Unix-second deadlines to the contract, and reject unknown settings.
- Anthony: resolved. Acceptance now compares a keyed digest of the ordered predictions plus the correct count, under a salted commitment bound to chain, contract, job, provider, spec hash and item count ([docs/m4/protocol.md](../docs/m4/protocol.md)). Funded two-wallet commits/reveals/claims and deadline/refund paths are exercised by `contracts/script/e2e-settlement.sh`.
- Miguel: confirm receipt display using the same job, wallets and transaction hashes.

Live evidence must record public chain ID/contract, job/provider IDs, assigned wallet addresses, block numbers, tx hashes and receipt status for both commits, both reveals and both claims, plus acceptance and backend/UI state. Never export private journals, signed payloads, keys, secrets, benchmark questions or answer keys. Capture restart checkpoints after persistence, broadcast-before-confirmation, before reveal and before claim; compare logical events and balances to prove no duplicate effects. Also exercise removed assignments, inference failure, unsupported settings, disappearance and refund eligibility. No live evidence is supplied yet.
