# M4 settlement protocol and result policy

Owner: Anthony (contracts and result policy). Status of each decision is in the table at the end; items marked **needs sign-off** are implemented as described, but the team must confirm them before the report is final.

This document is the single source for what an accepted result proves. The contract (`contracts/src/Evaluation.sol`), worker (`workers/jmac_worker/commitments.py`), scheduler (`packages/scheduler`), UI receipt (`apps/web/src/components/dashboard/settlement-receipt.tsx`), report, and slides must all use the wording below.

## 1. What an accepted result proves

A job is **accepted** (`JobStatus.Complete`, `JobComplete` event) only when both providers assigned to it:

1. committed before the commit deadline, each with its own commitment bound to that job (section 3);
2. revealed before the reveal deadline, and each reveal opened that provider's commitment;
3. revealed the **same output digest** and the **same correct count**.

The output digest is a keyed hash of the **ordered predicted choice indices** for every benchmark item (section 2). Equal digests therefore mean the two providers reported identical predictions, in benchmark order, for the same benchmark bytes and model. The correct count is the score.

An accepted result proves:

- two distinct provider wallets, chosen by the platform backend, reported identical ordered predictions and the same score;
- those reports were bound to this chain, contract, job, provider wallet, benchmark bytes, model ID, and item count;
- neither provider could use the other's on-chain reveal: reveals open only after both commitments are recorded, and a commitment cannot be opened by another wallet. Results exchanged off-chain before committing are outside the protocol (see collusion, section 6).

An accepted result does **not** prove:

- that either provider actually ran the model, or ran it correctly. Two providers that collude, or share a bug, can agree on a wrong answer (section 6);
- that the correct count is the true number of correct predictions. The contract never sees the answer key; it checks only that both providers claimed the same count and that the count is at most the item count;
- anything about model quality beyond this benchmark file.

### Decision: compare ordered predictions, not only correctness

M1/M2 promised ordered outputs and an output digest. The M3 contract compared the ordered boolean correctness vector, so two providers with different wrong predictions on the same item (for example choices 0 and 3 when the answer is 1) produced the same vector and were accepted. M4 restores the M1/M2 promise: agreement is on the digest of predicted choice indices.

Tests: `test_SameCorrectnessWithDifferentWrongPredictionsFails`, `test_SameAccuracyInADifferentOrderFails`, `test_SameDigestWithDifferentScoresFails` (contract); `test_digest_compares_ordered_predictions_not_accuracy` (worker). **Needs sign-off: Jadon.**

## 2. What reaches the chain

| Data | On-chain | Where else |
| --- | --- | --- |
| Questions, choices, answer key | Never | Convex file storage; assigned providers only |
| Predicted choice indices | Never | Each provider's private result file |
| Per-item correctness | Never (M3 published it; removed in M4) | Each provider's private result file |
| Output digest (keyed, per job) | Yes, at reveal and in `JobComplete` | Result file |
| Correct count and item count | Yes | Convex `jobs.score` (as a percentage) |
| Spec hash `keccak256(abi.encode(contentHash, modelId))` | Yes, at assignment | Recomputable from the public benchmark SHA-256 and model ID |
| Commitments | Yes | Transaction journals |
| Salts | Yes, only at reveal | `<result>.salt.json` until then |

**Output digest.** `outputDigest = keccak256(abi.encode(bytes32 outputKey, string jobId, uint256[] predictions))`, where `outputKey = sha256("jmac-output-key-v1:" || benchmark bytes)`. The key is derived from the benchmark bytes, so only parties who hold the benchmark (the creator and the assigned providers) can recompute it, and without the key nobody can test candidate prediction vectors against the published digest, even for short benchmarks. This holds only while the benchmark file itself is unpredictable: if an attacker can guess or obtain the exact bytes (a public dataset, a small template with few variants), they can derive the key and test predictions. Benchmarks that must stay private therefore need unguessable content; an independently generated secret key would remove this assumption and is a possible follow-up. Including `jobId` makes digests from repeated runs of the same model and benchmark unlinkable. The key is different from the public content hash, which is `sha256(benchmark bytes)` without the domain prefix.

**Privacy statement for the report.** Questions, answer keys, predictions and per-item correctness stay off-chain. The chain holds commitments, salts after reveal, one keyed output digest per provider, the correct count, the item count, the spec hash, and the provider wallets and IDs. The aggregate score is public by design. Do not describe the score or the provider identities as private.

Test: `test_SettlementPublishesNoPerItemData`, `test_commit_and_journal_never_contain_predictions_or_key`.

## 3. Commitment binding and replay protection

```
commit = keccak256(abi.encode(
    block.chainid, address(this), jobId, providerAddress,
    specHash, itemCount, outputDigest, correctCount, salt))
```

`Evaluation.resultCommitment` computes it on-chain; `result_commitment` computes it in the worker. Both are pinned to the same test vector (`0x94ad…0e48`), cross-checked with `cast`.

| Binding | Prevents | Test |
| --- | --- | --- |
| `chainid`, contract | Replaying a commitment on another chain or deployment | `test_CommitCannotBeReplayedOnAnotherChain`, `...AnotherContract` |
| `jobId` | Reusing a commitment from another job | `test_CommitCannotBeReplayedOnAnotherJob` |
| `providerAddress` | The second provider copying the first's commitment to free-ride | `test_CopiedCommitCannotBeRevealed`, `test_commitment_binds_this_provider` |
| `specHash` | Committing to a different benchmark file or model | `test_CommitCannotBeReplayedForAnotherSpec`, `test_wrong_spec_cannot_be_committed` |
| `itemCount` | Results for a shorter or longer benchmark | `test_RevertWhen_CommitIsForAShorterBenchmark`, `...ALongerBenchmark`, `test_wrong_item_count_cannot_be_committed` |
| 32-byte random `salt` | Enumerating the committed result before the reveal | `test_RevertWhen_RevealWithTheWrongSalt`, `test_salt_is_secret_random_and_reused_after_restart` |

The spec hash and item count are written by the backend in `assignProviders` and cannot change afterwards (`Providers already assigned`). The worker refuses to commit if the on-chain spec hash or item count differs from the benchmark it actually downloaded and evaluated.

The salt is generated per result, saved before the commitment is signed (so a crash cannot leave an unopenable commitment), reused across restarts, and never written into transaction journals.

**Residual assumption.** Commitment hiding relies on the salt staying secret until reveal and on keccak256 preimage resistance. Once revealed, the salt is public; privacy of the predictions after reveal rests on the output key (section 2), not the salt.

## 4. Signatures and receipts

**Result authentication is the Ethereum transaction signature.** Each `commitResult` and `revealResult` is a transaction signed by the provider's wallet, and the contract accepts it only if `msg.sender` is the wallet assigned to that job (`assignedProvider`). The commitment also includes the provider address. There is **no separate signed result receipt** (no EIP-712 message, no `ecrecover`), and the report must not claim one. We consider transaction signatures sufficient: they are verified by every node, they are tied to the assigned wallet, and they are permanently recorded with the call data.

**Accepted-result evidence a reader can verify without trusting Convex:**

| Claim | How to verify |
| --- | --- |
| Immutable specification | `jobs(jobId).specHash` equals `keccak256(abi.encode(contentHash, modelId))`, from the benchmark SHA-256 and model ID shown in the UI. Anyone with the benchmark file can check its SHA-256. |
| Provider identities | `jobs(jobId).providerA/B.addr` and `.id`, and the `ProvidersAssigned` event, sent by the backend wallet |
| Accepted output and score | `JobComplete(jobId, specHash, outputDigest, correctCount, itemCount)` and the providers' stored digests and counts |
| Chain transaction | The completion transaction receipt contains that `JobComplete` log, emitted by the contract address |
| Payment and refund | `claimed` flags and the `claimPayment`/`refund` transactions |

The UI receipt performs these checks itself: it reads the job from the contract, recomputes the spec hash, decodes the recorded completion transaction and confirms it emitted this job's `JobComplete`, and compares the dashboard score with the on-chain count. Convex fields (`jobComplete_tx`, `score`) are treated as hints that the receipt checks, not as evidence.

Opening the output digest (showing the predictions behind it) requires a provider's private result file and the benchmark. That disclosure happens off-chain to an authorized party and is not part of the public receipt.

## 5. Recovery scope

**Decision: two-provider agreement or refund. Third-provider fallback is deferred.** M2 proposed assigning a third provider after disagreement or timeout. M4 does not implement it. The contract has exactly two outcomes after assignment:

| Situation | Outcome |
| --- | --- |
| Both reveal the same digest and count | `Complete`; each provider claims half (B takes the odd wei) |
| Both reveal, results differ | `Failed`; no provider is paid; the creator refunds the full price |
| No assignment, or a commit missing at the commit deadline | Creator refunds after the commit deadline; `JobFailed` is emitted at refund |
| Both committed, a reveal missing at the reveal deadline | Creator refunds after the reveal deadline; the provider that revealed is not paid |

If the team later adds fallback, these must be specified before coding: when the third provider is assigned and its deadline; which matching pair is accepted; whether late results from the original pair are still accepted; whether the disagreeing provider is paid; and when the creator becomes eligible for a refund. **Needs sign-off: team.**

Duplicate events, restarts and replays are safe because every state change is guarded on-chain: commit, reveal, claim and refund each revert on repetition, and the worker journals each signed transaction before broadcasting and rebroadcasts only identical bytes (recovery scenario S4 in [acceptance.md](acceptance.md#32-scenarios); worker journals in [workers/README.md](../workers/README.md)). The scheduler does not replay historical events after a restart; that is a known gap (R11).

## 6. Provider independence

- **Approval** means a platform administrator set `providers.approved = true` in the Convex dashboard. No application mutation sets it, so a provider cannot approve itself.
- **Self-evaluation.** The scheduler mutation `job.assignProviders` never selects a provider registered by the job creator's account, or one whose wallet is the funding wallet the scheduler reads from the contract. On-chain, `assignProviders` reverts with `Creator cannot provide` if either provider wallet is the creator's funding wallet.
- **One operator, several identities.** The same mutation never pairs two providers registered by the same user, or two providers using the same wallet address. The contract additionally requires distinct wallets.
- **What this does not stop.** One person can register two accounts with two wallets and get both approved, or two operators can collude off-chain. Administrator approval is the only check against this. Matching submissions therefore prove agreement between two approved identities, not honest or independent execution. This is the residual collusion assumption and must be stated in the report.

Enforcement and tests for the Convex selection rules are coordinated with Chris (backend). The contract-side checks are tested by `test_RevertWhen_CreatorIsAssignedAsProvider` and `test_RevertWhen_ProvidersAreTheSameAddress`.

## 7. Decisions

| # | Decision | Status |
| --- | --- | --- |
| 1 | Agreement compares a keyed digest of ordered predictions plus the correct count | Implemented; **needs sign-off: Jadon** |
| 2 | Per-item correctness removed from the chain; only digest and counts published | Implemented; needs team sign-off |
| 3 | Commitments bound to chain, contract, job, provider, spec, item count; salted | Implemented |
| 4 | Transaction signatures are the result authentication; no separate receipt signature | Documented; needs team sign-off |
| 5 | Two-provider path only; third-provider fallback deferred | Documented; **needs sign-off: team** |
| 6 | Creator, same-user and same-wallet providers excluded; residual collusion stated | Implemented; selection tests with Chris |

## 8. Interface changes (M3 → M4)

| Item | M3 | M4 |
| --- | --- | --- |
| `assignProviders` | `(jobId, addrA, idA, addrB, idB)` | adds `bytes32 specHash, uint256 itemCount` |
| `revealResult` | `(jobId, bool[] scores)` | `(jobId, bytes32 outputDigest, uint256 correctCount, bytes32 salt)` |
| `resultCommitment` | none (`keccak256(abi.encode(bool[]))`) | new view function, see section 3 |
| `JobComplete` | `(jobId, bool[] scores)` | `(jobId, bytes32 specHash, bytes32 outputDigest, uint256 correctCount, uint256 itemCount)` |
| `Provider` tuple | `(addr, id, commit, bool[] result, flag, revealed, claimed)` | `(addr, id, commit, bytes32 outputDigest, flag, revealed, claimed, uint256 correctCount)` |
| `Job` tuple | 8 fields | appends `bytes32 specHash, uint256 itemCount` |
| Worker result schema | `2.0.0` | `3.0.0`, adds private `benchmark.output_key` |
| Worker encoding ID | `keccak256-abi-bool-array-v1` | `keccak256-abi-bound-salted-output-digest-v3` |

The ABIs in `apps/web/public/abi.json`, `packages/scheduler/abi.json` and `workers/jmac_worker/evaluation_abi.json` are generated from the Foundry build by `bun contracts/script/sync-abi.ts`, and CI fails if they drift (`--check`). The contract must be redeployed; M3 jobs and saved results are not compatible.
