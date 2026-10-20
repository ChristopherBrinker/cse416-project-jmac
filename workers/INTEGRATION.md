# Worker integration handoff

The `0.4.0` worker runs the pinned model, scores benchmarks, produces repeatable local results, and manages provider presence. Completing a job from the backend is the next MVP milestone. This handoff distinguishes the available interfaces from the remaining integration requirements.

## Current boundary

Checked against main commit `9bd8c8d`:

- `provider:setStatus` and `provider:heartbeat` accept a registered provider ID and secret. The worker implements these calls, loads and warms the model before becoming ready, and attempts offline cleanup on shutdown.
- The scheduler observes `JobFunded`, calls `job:assignProviders`, and submits the selected providers to the contract. The backend stores `job_assignments` and exposes `job:getJobsForProvider` using the provider ID and secret.
- The backend exposes an assignment-authorized `GET /benchmark?jobId=&providerId=&secret=` download. The worker does not yet query assignments or download their benchmarks. See the [backend guide](../packages/backend/README.md).
- `contracts/src/Evaluation.sol` implements funding, provider assignment, and `commitResult(jobId, bytes32)`. It stores one nonzero commitment per assigned provider and emits `CommitComplete` once both are stored. It has a `bool[]` result field, but no reveal/comparison, `JobComplete`/`JobFailed`, refund, or payout functions.
- ABIs and local deployment instructions exist. The worker has no wallet configuration or contract calls, so merging these files does not connect the worker to a blockchain.

Local unit tests and real-model lifecycle checks against a Convex-compatible HTTP stub pass. Authentication against an actual deployment still needs a registered provider's credentials; no live deployment verification has been performed.

## Backend handoff

Provider-authorized work delivery and benchmark access now exist. The worker adapter can target those interfaces; the remaining information and behavior to coordinate with the backend owner are:

- An assignment identifier, job identifier, assigned provider, benchmark identifier and original-file SHA-256 hash, and model identifier with an immutable revision. A model display name alone cannot select a reproducible runner.
- Job/benchmark/model metadata for each assignment: `job:getJobsForProvider` currently returns assignment records containing the job ID, without the benchmark hash or model metadata. Define how the worker obtains those values, deadlines, and conditions for losing an assignment. Start with one concurrent job per provider.
- Preserve the original benchmark bytes returned by the download and verify their expected content hash before evaluation; parsing and reserializing the JSON changes the bytes. Keep the existing download's query-string secret out of logs and error messages.
- Defined behavior for retries, duplicate delivery, restarts, cancellation, and expiry so a repeated request cannot create a second logical execution or complete an expired assignment.
- A way to report execution failure and retrieve the authoritative job/assignment state. Decide how result artifacts are stored and authorized separately from on-chain settlement.
- Missing-heartbeat handling so a killed or unreachable worker eventually stops receiving work.

For the first model, map the backend model record to `HuggingFaceTB/SmolLM2-135M-Instruct` at revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`. The worker currently supports only that model. Configure model support and capacity while the registered provider is offline.

## Contract handoff

The registry/escrow owner has supplied the initial contract and ABIs. Deployment configuration, commit/reveal deadlines, and the rest of the result lifecycle still need agreement before adding worker transaction code:

- The requested contract result is the ordered boolean score vector (`[true, false, ...]`). The worker writes this boolean array directly in result schema `2.0.0`, with one correctness value per benchmark item; predictions remain integer choice indices. Worker metadata varies across machines and should not accidentally become part of result agreement.
- Canonical encoding, hash algorithm, and any salt or job/provider binding used for commitments. The current local JSON file is not a commitment format.
- A reveal function that hashes the supplied boolean array, validates it against that provider's commitment, and compares both revealed arrays. Matching arrays should enable completion and separate payout claims; disagreement should enable failure and a separate refund. These functions and events are not yet implemented.
- How workers observe commit completion, reveal results, handle failed transactions or expired jobs, and request payment. Confirm which responsibilities belong in the worker and which belong in the backend.

## Remaining worker work

1. Add an adapter for the agreed assignment and download APIs, authenticated with the provider's secret.
2. Check assignment ownership, deadlines, model revision, and benchmark hash; reject unsupported or changed inputs before inference.
3. Run the existing model/scorer with one active assignment while continuing heartbeats. Keep answer keys outside model inputs and private benchmark contents out of logs.
4. Persist enough assignment/result state to resume safely after a restart, then implement the agreed commit/reveal and artifact submission flow.
5. Run the shared acceptance checks below against the actual backend and contract.

## MVP acceptance checks

- A real registered provider loads its model before `ready`, updates `lastHeartbeat`, and returns to `offline` after a normal stop.
- A funded job reaches the intended providers, which can download the benchmark; an unrelated provider cannot obtain it.
- A changed benchmark hash or unsupported model revision fails before inference and does not produce a success result.
- Two providers using the agreed pinned runtime evaluate the same benchmark and successfully commit/reveal results under the contract's comparison policy. Test agreement across the actual provider machines; local repeatability alone does not establish this.
- Redelivery and a worker restart do not double-complete or double-pay the job.
- A provider failure or missed deadline follows the agreed job-failure/refund path rather than leaving the job pending indefinitely.

## Message for the team

> The worker and Docker package are ready for local evaluation, and provider readiness/heartbeats are implemented. Main now has assignments, authorized benchmark downloads, and contract commitments. The worker still needs adapters for those APIs, job metadata with the expected benchmark hash and pinned model mapping, and contract transaction integration. The score output already uses boolean arrays matching `bool[]`. Reveal/comparison, refunds, payouts, and the exact commitment encoding/deadlines remain contract work. Live provider authentication is still unverified.
