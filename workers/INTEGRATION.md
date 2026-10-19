# Worker integration handoff

The `0.3.0` worker runs the pinned model, scores benchmarks, produces repeatable local results, and manages provider presence. Completing a job from the backend is the next MVP milestone. The requirements below are a handoff for that integration, not implemented API endpoints.

## Current boundary

Checked against backend commit `69ab12d`:

- `provider:setStatus` and `provider:heartbeat` accept a registered provider ID and secret. The worker implements these calls, loads and warms the model before becoming ready, and attempts offline cleanup on shutdown.
- `job:createJob` creates the user's job record. It does not deliver work to a provider.
- There is no assignment table/API, authorized benchmark download, or result submission API. The [backend guide](../packages/backend/README.md) explicitly describes the assignment and download gaps.
- The contracts workspace is planned; commit/reveal calls cannot yet be wired to a deployed contract.

Local unit tests and real-model lifecycle checks against a Convex-compatible HTTP stub pass. Authentication against an actual deployment still needs a registered provider's credentials; no live deployment verification has been performed.

## Backend handoff

The backend owner needs to expose provider-authorized work delivery and benchmark access. Agree on the function names and wire format before implementing the worker adapter. The minimum information and behavior needed are:

- An assignment identifier, job identifier, assigned provider, benchmark identifier and original-file SHA-256 hash, and model identifier with an immutable revision. A model display name alone cannot select a reproducible runner.
- A way for the authenticated provider to obtain only its active assignments, with deadlines and the conditions for accepting or losing an assignment. Start with one concurrent job per provider.
- Assignment-scoped access to the private benchmark's original bytes, preserving the uploaded content hash. The worker must verify that hash before evaluation; parsing and reserializing the JSON changes the bytes.
- Defined behavior for retries, duplicate delivery, restarts, cancellation, and expiry so a repeated request cannot create a second logical execution or complete an expired assignment.
- A way to report execution failure and retrieve the authoritative job/assignment state. Decide how result artifacts are stored and authorized separately from on-chain settlement.
- Missing-heartbeat handling so a killed or unreachable worker eventually stops receiving work.

For the first model, map the backend model record to `HuggingFaceTB/SmolLM2-135M-Instruct` at revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`. The worker currently supports only that model. Configure model support and capacity while the registered provider is offline.

## Contract handoff

The registry/escrow owner needs to provide the deployed chain/address, ABI, assigned-provider rules, and commit/reveal deadlines. Agree on these result-policy details before adding transaction code:

- The exact result fields compared between providers, including whether the ordered integer score vector is authoritative. Worker metadata varies across machines and should not accidentally become part of result agreement.
- Canonical encoding, hash algorithm, and any salt or job/provider binding used for commitments. The current local JSON file is not a commitment format.
- The representation of the total score. The worker already supplies integer `correct` and `total` values plus a floating-point `accuracy`; the contract policy must choose its representation explicitly.
- How workers observe commit completion, reveal results, handle failed transactions or expired jobs, and request payment. Confirm which responsibilities belong in the worker and which belong in the backend.

## Worker work after those interfaces exist

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

> The worker and Docker package are ready for local evaluation, and provider readiness/heartbeats are implemented. To connect real jobs, I need provider-authorized assignments, an assignment-scoped download of the original benchmark bytes with its SHA-256 hash, and an immutable model mapping. For on-chain results, I also need the ABI/deployment and agreed commitment encoding, score comparison, and deadlines. Once those interfaces exist I can wire the worker into the full job flow. Live provider authentication is still unverified.
