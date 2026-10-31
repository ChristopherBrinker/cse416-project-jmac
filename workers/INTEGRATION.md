# Worker integration handoff

The `0.4.0` worker runs the pinned model, scores benchmarks, produces repeatable local results, and manages provider presence. Completing a job from the backend is the next MVP milestone. This handoff distinguishes the available interfaces from the remaining integration requirements.

## Current boundary

Current source capabilities (deployment verification remains outstanding):

- `provider:setStatus` and `provider:heartbeat` accept a registered provider ID and secret. The worker implements these calls, loads and warms the model before becoming ready, and attempts offline cleanup on shutdown.
- The scheduler observes `JobFunded`, calls `job:assignProviders`, and submits the selected providers to the contract. The backend stores `job_assignments` and exposes `job:getJobsForProvider` using the provider ID and secret.
- The backend exposes an assignment-authorized `GET /benchmark?jobId=&providerId=&secret=` download. The opt-in `--execute-jobs` worker now subscribes to assignments, downloads benchmarks, and saves local evaluation results while continuing heartbeats. See the [backend guide](../packages/backend/README.md).
- `contracts/src/Evaluation.sol` implements funding, provider assignment, and `commitResult(jobId, bytes32)`. It stores one nonzero commitment per assigned provider and emits `CommitComplete` once both are stored. It has a `bool[]` result field, but no reveal/comparison, `JobComplete`/`JobFailed`, refund, or payout functions.
- The worker now supports opt-in `--commit-results` with a dedicated registered-wallet signer. It uses `keccak256(abi.encode(bool[] scores))`, validates the on-chain assignment, and persists signed transactions before broadcasting so restarts reconcile instead of signing duplicates. Live deployment verification remains outstanding.

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

The registry/escrow owner has supplied the initial contract and ABIs. Deployment configuration, commit/reveal deadlines, and the rest of the result lifecycle still need agreement before adding worker transaction code:

- The requested contract result is the ordered boolean score vector (`[true, false, ...]`). The worker writes this boolean array directly in result schema `2.0.0`, with one correctness value per benchmark item; predictions remain integer choice indices. Worker metadata varies across machines and should not accidentally become part of result agreement.
- The implemented worker encoding is `keccak256(abi.encode(bool[] scores))` with no salt or additional binding, matching the requested hash of scores. The current contract stores arbitrary nonzero bytes32 values. Future reveal logic must use exactly this encoding, or the worker protocol must change together with it. The local JSON file itself is not hashed.
- A reveal function that hashes the supplied boolean array, validates it against that provider's commitment, and compares both revealed arrays. Matching arrays should enable completion and separate payout claims; disagreement should enable failure and a separate refund. These functions and events are not yet implemented.
- How workers observe commit completion, reveal results, handle failed transactions or expired jobs, and request payment. Confirm which responsibilities belong in the worker and which belong in the backend.

## Remaining worker work

1. Implemented: secret-authenticated assignment subscription and benchmark download (`--execute-jobs`).
2. Check assignment ownership, deadlines, model revision, and benchmark hash; reject unsupported or changed inputs before inference.
3. Implemented: one active evaluation while heartbeats continue; answer keys stay outside model inputs and private benchmark contents stay out of logs.
4. Local successful results now persist by provider/job/model identity and are skipped after restart. Opt-in commitment submission now persists signed bytes before broadcast and reconciles existing on-chain state or pending transactions. Reveal and artifact submission remain to be implemented.
5. Run the shared acceptance checks below against the actual backend and contract.

## MVP acceptance checks

- A real registered provider loads its model before `ready`, updates `lastHeartbeat`, and returns to `offline` after a normal stop.
- A funded job reaches the intended providers, which can download the benchmark; an unrelated provider cannot obtain it.
- A changed benchmark hash or unsupported model revision fails before inference and does not produce a success result.
- Two providers using the agreed pinned runtime evaluate the same benchmark and successfully commit/reveal results under the contract's comparison policy. Test agreement across the actual provider machines; local repeatability alone does not establish this.
- Redelivery and a worker restart do not double-complete or double-pay the job.
- A provider failure or missed deadline follows the agreed job-failure/refund path rather than leaving the job pending indefinitely.

## Message for the team

> The worker and Docker package are ready for local evaluation, and provider readiness/heartbeats are implemented. Main now has assignments, authorized benchmark downloads, and contract commitments. The opt-in worker now subscribes, downloads, evaluates, and saves results with restart deduplication. It still needs the expected benchmark hash from the backend and reveal/settlement integration; model mapping currently uses an explicit deployment configuration. The score output already uses boolean arrays matching `bool[]`. The worker now supports opt-in commitments using keccak256 of ABI-encoded bool[] scores, with durable transaction journals. Reveal/comparison, refunds, payouts, and deadlines remain contract work; reveal must match the implemented encoding. Live provider authentication is still unverified.
