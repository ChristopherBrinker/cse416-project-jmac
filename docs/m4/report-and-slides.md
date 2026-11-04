# M4 report and slide contribution — settlement and result policy (Anthony)

## Report section

### Settlement correctness

We audited the M3 Evaluation contract against the M3 feedback before changing it. Reveal comparison, provider claims, creator refunds and commit/reveal deadlines already existed and were tested. The audit found four gaps, which M4 closes:

1. **Agreement compared correctness, not outputs.** Two providers with different wrong answers on the same item were accepted. M4 compares a digest of the ordered predicted choice indices, as M1/M2 promised.
2. **Commitments were unbound and unsalted.** `keccak256(abi.encode(bool[]))` could be copied by the second provider, replayed on another job, and, for short benchmarks, enumerated before the reveal. M4 commitments bind the chain, contract, job, provider wallet, benchmark/model specification and item count, and include a 32-byte secret salt.
3. **Per-item correctness was published on-chain**, contrary to M2. M4 publishes only a keyed output digest and the correct count.
4. **Result length was unchecked** against the benchmark. The item count is now recorded at assignment and bound into every commitment.

The contract suite grew from 76 to 91 tests (including a payout fuzz test), and a scripted Anvil run exercises success, disagreement and missing-provider jobs end to end with transaction hashes and exact balance checks. CI now runs the contract, worker and scheduler suites on every push; previously it ran only static checks.

### What an accepted result proves

An accepted result proves that two distinct, administrator-approved provider wallets chosen by the backend reported identical ordered predictions and the same score for a fixed benchmark file and model, and that neither could see the other's result before committing. It does not prove that either provider ran the model honestly: colluding providers, or providers sharing a bug, can agree on a wrong result. The score is the providers' agreed claim; the contract never sees the answer key.

### Privacy

Questions, answer keys, predictions and per-item correctness never reach the chain. The chain holds commitments, salts (after reveal), keyed output digests, the correct count, the item count, a hash identifying the benchmark and model, and provider wallets and IDs. The output digest is keyed by a secret derived from the benchmark bytes, so it cannot be brute-forced without the benchmark. The aggregate score is public by design.

### Authentication and receipts

Provider results are authenticated by their Ethereum transaction signatures: the contract accepts a commit or reveal only from the wallet assigned to that job. There is no separate signed result message. The dashboard shows a settlement receipt that reads the job from the contract, recomputes the specification hash, verifies that the recorded completion transaction emitted this job's `JobComplete` event, and checks that the displayed score matches the on-chain count, so a reader need not trust our database.

### Scope

M4 implements the two-provider path: agreement pays both providers; disagreement or a missing commit/reveal lets the creator refund in full. The third-provider fallback proposed in M2 is deferred. Provider selection excludes the job creator, and never pairs two providers from the same account or wallet; one person controlling two approved accounts remains a residual collusion risk.

## Slides

**Slide 1 — What the chain proves**

- Two independent, approved providers committed, then revealed the same digest of ordered predictions and the same score
- Bound to this chain, contract, job, provider, benchmark file, model and item count
- Not proven: honest execution — two colluding providers can agree on a wrong result

**Slide 2 — M3 feedback → M4 fixes**

- Correctness vector → digest of ordered predictions (different wrong answers now disagree)
- Unbound hash → salted commitment bound to chain/contract/job/provider/spec/length
- Per-item results on-chain → only keyed digest + score
- 76 → 91 contract tests; Anvil E2E with tx + balance evidence; contract and worker suites in CI

**Slide 3 — Settlement outcomes (demo)**

- Match → `JobComplete` → each provider claims half (odd wei to B) → receipt verified in UI
- Disagree → `JobFailed` → no payment → creator refund
- Missing provider → deadline → creator refund
- Replays and restarts → duplicate calls revert; worker rebroadcasts only identical signed transactions

**Slide 4 — Open decisions and limits**

- Third-provider fallback deferred
- Collusion between approved identities is out of scope; admin approval is the control
- Provider secret travels in the download URL query string
