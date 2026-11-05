# M4 integrated acceptance tests

Owner: Anthony (lead). Policies referenced here are defined in [protocol.md](protocol.md).

## 1. Automated coverage

| Suite | Command (from repo root) | Result on 2026-11-04 |
| --- | --- | --- |
| Contract unit + fuzz | `cd contracts && forge test` | 91 passed (13 commit, 78 settlement incl. 1 fuzz) |
| Chain-level E2E on Anvil | `bash contracts/script/e2e-settlement.sh docs/m4/evidence/anvil-settlement.md` | Passed; evidence in [evidence/anvil-settlement.md](evidence/anvil-settlement.md) |
| ABI drift | `cd contracts && forge build && bun script/sync-abi.ts --check` | Passed |
| Worker | `cd workers && uv sync --extra inference --extra provider --extra chain --locked && uv run --no-sync python -m unittest discover -s tests` | 133 of 138 passed locally; 5 not runnable on the Windows dev machine (PyTorch not installed, POSIX signals). CI runs all on Linux |
| Scheduler spec-hash vector | `bun test packages/scheduler` | 2 passed |
| Lint, format, types | `bun run lint && bun run check-types` | Passed |

CI (`.github/workflows/ci.yml`) now runs every row above on each push and pull request: the existing `checks` job plus new `contracts` and `workers` jobs. The `contracts` job uploads the Anvil evidence file as the `settlement-evidence` artifact. The optional `build` job is unchanged.

## 2. Feedback items → tests

| Feedback item | Covered by |
| --- | --- |
| Unauthorized providers | `test_RevertWhen_CallerNotAssigned`, `test_RevertWhen_RevealCallerNotAssigned`, `test_RevertWhen_ClaimCallerNotAssigned`, `test_RevertWhen_CreatorClaims`, `test_RevertWhen_AssignCallerNotBackend` |
| Duplicate commits / reveals | `test_RevertWhen_ProviderCommitsTwice`, `...AfterCommitComplete`, `test_ReassignmentCannotResetCommits`, `test_RevertWhen_ProviderRevealsTwice`, `test_RevertWhen_RevealAfterSettlement` |
| Altered digests | `test_RevertWhen_RevealDoesNotMatchCommit`, `test_RevertWhen_RevealedScoreDoesNotMatchCommit`, `test_RevertWhen_RevealWithTheWrongSalt`, `test_CopiedCommitCannotBeRevealed`, replay tests (chain, contract, job, spec) |
| Early reveals | `test_RevertWhen_RevealBeforeBothCommits`, `test_both_commits_without_event_do_not_reveal` (worker) |
| Disagreement | `test_DifferentRevealsEmitJobFailed`, `test_SameCorrectnessWithDifferentWrongPredictionsFails`, `test_SameDigestWithDifferentScoresFails`, Anvil scenario 2 |
| Expired submissions | `test_RevertWhen_CommitAfterTheDeadline`, `test_RevertWhen_RevealAfterTheDeadline`, `test_RevertWhen_AssignAfterTheDeadline`, boundary tests at the deadline, `test_expired_reveal_never_broadcasts` (worker), Anvil scenario 3 |
| Claims/refunds cannot run twice | `test_RevertWhen_ProviderClaimsTwice`, `test_RevertWhen_RefundTwice`, `test_RevertWhen_TimeoutRefundTwice`, Anvil "again" rows |
| Successful jobs cannot refund | `test_RevertWhen_RefundOnCompleteJob`, `test_CompleteJobCannotBeRefundedAfterTheDeadline`, `test_RevertWhen_RefundAfterProvidersClaimed` |
| Failed/refunded jobs cannot pay providers | `test_RevertWhen_ClaimOnFailedJob`, `test_RevertWhen_ClaimAfterRefund`, `test_RevertWhen_ClaimAfterTimeoutRefund`, `test_NeitherProviderPaidWhenOneNeverReveals`, `test_failed_and_refunded_jobs_never_claim` (worker) |
| Transfers and odd wei | `test_ProvidersEachClaimHalf`, `test_OddPriceLeavesNoFundsLocked`, `test_OneWeiJobPaysTheOddWeiToProviderB`, `testFuzz_ClaimsPayExactlyThePrice`, Anvil scenario 1 (500000 / 500001 wei) |
| Failed transfers | `test_FailedPaymentCanStillBeClaimedByTheOtherProvider` (claim rolls back, share stays claimable), `test_FailedRefundTransferKeepsTheJobRefundable` |
| Reentrancy | `test_ReentrantClaimOnlyPaysOnce`, `test_ReentrantRefundOnlyPaysOnce` (state is updated before every transfer) |
| Same aggregate accuracy, different order | `test_SameAccuracyInADifferentOrderFails`, `test_digest_compares_ordered_predictions_not_accuracy`, Anvil scenario 2 |
| Result length vs expected item count | `test_AssignmentRecordsSpecAndItemCount`, `test_RevertWhen_AssignWithoutItemCount`, `test_RevertWhen_CommitIsForAShorterBenchmark`, `...ALongerBenchmark`, `test_RevertWhen_ScoreExceedsItemCount`, `test_wrong_item_count_cannot_be_committed` (worker) |
| Commitment binding and encoding agreement | `test_CommitmentMatchesWorkerEncoding`, `test_OutputDigestMatchesWorkerEncoding`, `test_SpecHashMatchesSchedulerAndWorkerEncoding` and the same vectors in the worker and scheduler tests |
| Nothing per-item on-chain | `test_SettlementPublishesNoPerItemData`, `test_commit_and_journal_never_contain_predictions_or_key` |
| Creator cannot evaluate own job | `test_RevertWhen_CreatorIsAssignedAsProvider` (contract); Convex selection rule (to be tested with Chris) |

## 3. Integrated acceptance run (manual, full stack)

The Anvil script proves the contract rules. This run proves the whole system: browser wallet, scheduler, two real workers with real inference, and the UI receipt. Record every transaction hash and balance in a copy of the evidence template (section 5).

### 3.1 Setup

1. `anvil` (keep running). Use account 0 as the scheduler/backend wallet, account 1 as the creator, accounts 2 and 3 as providers A and B.
2. From `contracts/`: `forge build`, then deploy with `BACKEND_ADDRESS=<account 0> forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8545 --private-key <account 0 key>`.
3. From the repo root: `bun contracts/script/sync-abi.ts` (copies the ABI to web, scheduler and worker).
4. Set `CONTRACT_ADDRESS`/`NEXT_PUBLIC_CONTRACT_ADDRESS` and start `bun run dev` and the scheduler (`cd packages/scheduler && bun run dev`) as in the root README.
5. Sign in as three users: a creator, provider-operator A, provider-operator B. Each operator registers one provider with its own wallet (accounts 2 and 3) and the SmolLM2 model. A platform administrator sets `approved = true` for both in the Convex dashboard.
6. Start two workers from `workers/`, each with its own `.env.provider`, results directory and wallet: `cd workers && uv run --env-file .env.provider --extra inference --extra provider --extra chain --locked python -m jmac_worker.provider --execute-jobs --commit-results`.
7. As the creator, upload a benchmark (re-upload any M3 benchmark so `itemCount` is recorded).

Record starting balances: `cast balance <addr>` for the creator, A, B and the contract.

### 3.2 Scenarios

| # | Scenario | Steps | Pass criteria |
| --- | --- | --- | --- |
| S1 | Success | Creator connects the wallet in the dashboard, creates a job, clicks **Fund job**. Wait for both workers. | `JobFunded`, `ProvidersAssigned` (spec hash and item count), two commits, `CommitComplete`, two reveals, `JobComplete`, two claims. Contract balance returns to its start. A + B receive exactly the price (B takes the odd wei). UI receipt shows: spec hash matches, completion transaction verified, dashboard score matches the on-chain count, both providers paid. |
| S2 | Disagreement | Repeat S1 with worker B pointed at a different model revision or edited predictions (e.g. a test build that flips one prediction). | `JobFailed` after the second reveal; no `JobComplete`; both claims revert `Job not complete`. Creator clicks **Refund** in the receipt; creator balance rises by the price minus gas; second refund reverts. |
| S3 | Missing provider | Repeat S1 but stop worker B before it commits. | On-chain, right after the 5-minute commit window: worker B cannot commit; after reloading the job, the Refund button appears; the refund succeeds and provider A is not paid. In Convex, later: the scheduler's cleanup marks the job failed with reason "Timed out" once commit + reveal windows + 30 s (8 minutes from funding) have passed, on its next 2-minute pass, so allow up to about 10 minutes. |
| S4 | Recovery | During S1, kill worker A after its commit journal is written (`<result>.commit.json` exists) and restart it. Restart worker B between `CommitComplete` and its reveal. | Exactly one commit, reveal and claim transaction per provider (count `cast logs` / journals). On restart each worker resumes its event scan from `<result>.events.json` (the event checkpoint) and, for a pending phase, rebroadcasts only the identical signed bytes saved in that phase's transaction journal (`<result>.commit.json`, `.reveal.json`, `.claim.json`). No duplicate transfer: A + B total equals the price. Not covered: the scheduler watches only new blocks, so events emitted while it is down are not replayed (known gap R11); do not restart it mid-run. |
| S5 | Privacy | See section 4. | All checks pass. |

## 4. Privacy checks

| Check | How | Expected |
| --- | --- | --- |
| Unassigned provider cannot download | `GET /benchmark?jobId=<job>&providerId=<other provider>&secret=<its secret>` | 400 "Provider not assigned to this job" |
| Wrong secret cannot download | Same request with an assigned provider ID and a wrong secret | 400 "Invalid provider id or secret" |
| Download after the job finished | Assigned provider repeats the request after settlement | 400 (assignment is `finished`) |
| No questions or answers in public queries | Inspect `benchmark:getBenchmarks` and `job:getUserJobs` responses in the browser network tab | `getBenchmarks`: benchmark metadata only (ID, name, description, version, owner name, SHA-256). `getUserJobs`: job metadata, IDs, status, score and transaction hashes. Neither contains questions, choices, answers or stored benchmark contents |
| No questions, answers, predictions or per-item correctness on-chain | `cast logs --address <contract>` and `cast tx <hash>` for every reveal; compare with `protocol.md` §2 | Only commitments, salts, digests, counts, spec hash |
| No secrets or predictions in logs | Search worker and scheduler output for an item prompt, the output key, and the provider secret | No matches |

Known gap to track: benchmark download URLs carry the provider secret as a query parameter (see `workers/README.md`); proxies and access logs must not record query strings.

## 5. Evidence template

Copy for each integrated run into `docs/m4/evidence/<date>-integrated.md`:

```
Run date / commit:
Chain ID / contract / backend wallet:
Creator / provider A / provider B wallets and Convex provider IDs:
Benchmark SHA-256 / model ID / item count / spec hash:

| Scenario | Step | Tx hash | Notes |
| S1 | fundJob | | |
...
Balances (wei) before → after: creator, A, B, contract
UI receipt screenshot: spec ✓, completion tx ✓, score ✓
```
