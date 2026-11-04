# M4 report: user-facing evaluation flow (Miguel)

Draft for the M4 write-up and slides. Policy statements marked _owner to confirm_ are proposals until the named owner agrees. See the [requirements checklist](requirements.md) for R1–R14 status and the [demo instructions](../demo.md) for how everything below was shown.

## Summary

A user can now connect a browser wallet without entering a key, fund a job, follow it through assignment and commit/reveal, inspect a traceable receipt for an accepted result, and reclaim the escrow through a creator-signed refund when the evaluation fails or expires. Provider wallets are registered only after a signed ownership challenge.

Demonstrated at commit `8b9dc4e` against `Evaluation` at `0x5FbDB2315678afecb367f032d93F642f64180aa3` on local Anvil (chain 31337). Providers were simulated (see the demo's labelled limitations).

## Design changes since M2

M3 stated "No changes since M2". That was not accurate. The design changes actually made:

1. **Wallet flow correction.** M2 specified wallet signing. M3 shipped a dashboard and dev sandbox that asked users to paste a raw private key, which the browser turned into an account. M4 removes that path entirely: all funding, refunds, and provider verification are signed in an injected browser wallet (MetaMask or any EIP-1193/EIP-6963 wallet) through wagmi. The app handles rejected requests, account switches, disconnection, and the wrong network. Test keys live only in the wallet's local development setup.
2. **Provider wallet ownership.** Previously a provider typed any address. Now the backend issues a single-use challenge (account, wallet, chain ID 31337, 128-bit nonce, 5-minute expiry), the wallet signs it (EIP-191), and the backend consumes the challenge before verifying the signature, so it cannot be replayed. A wallet backs one provider, and admin approval refuses unverified wallets. _Chris to confirm the backend design; Anthony to review how this identity maps to assigned provider transactions._
3. **Settlement is implemented on-chain.** The contract now has commit → reveal → settle with deadlines: 5 minutes to commit, then 2.5 minutes to reveal. Matching reveals complete the job and let each provider claim half. Disagreement fails it. A missed deadline makes it refundable. The creator can refund once. (`workers/INTEGRATION.md` still quotes 30/15-minute windows. The contract source is authoritative.)
4. **Result representation.** Results are an ordered `bool[]` of per-item correctness, committed as `keccak256(abi.encode(bool[]))`. The scheduler converts the revealed vector to a percentage for Convex. Workers themselves report accuracy on a 0–1 scale, so the UI labels both.
5. **State tracking.** Convex records `jobFunded_tx`, `jobComplete_tx`, `jobFailed_tx`, `failureReason`, and per-provider `endState`. The frontend treats the contract as authoritative for escrow (funded / complete / failed / refunded) and reads it directly, so a job is never shown as refunded until the refund transaction succeeds.
6. **Job lifecycle in the UI.** The UI now distinguishes funding pending, funding confirmed, providers assigned, commit/reveal progress with deadlines, accepted result, failure or expiry with an explanation, refund available, and refund confirmed. Accepted results show a receipt. Provider payment claims are shown separately from result acceptance.

## Policies

- **Two-provider settlement (current).** Exactly two distinct approved providers per job. Payment requires identical revealed vectors; there is no tolerance. Anything else blocks payment and lets the creator refund. _Anthony to confirm._
- **Third-provider fallback (decision).** Not implemented. Proposed: no fallback this semester. A disagreement is surfaced to the developer with an explanation and ends in a refund. _Anthony and Chris to confirm before this is presented as decided._
- **Supported network.** Local Anvil (chain 31337) only. No public testnet deployment exists, so R4's "testnet" is met only in the local sense. _Anthony to confirm._
- **Privacy boundary.**
  - Benchmark questions and answer keys stay in Convex storage. Only the owner and assigned providers (with a provider secret) can download them.
  - Public queries and the UI expose only metadata (name, version, description, SHA-256).
  - Receipts show no questions, answers, predictions, or per-item results.
  - Not private: per-item correctness is public on-chain in reveals and `JobComplete`. Worker hosts can read test data by design. Provider secrets travel in a URL query string.

## Findings for owners

1. **Commitment copying (R6, security).** Anthony, Jadon. The commitment hashes only the scores, so an assigned provider can copy the other provider's commitment and later its public reveal, and both are paid for one evaluation. Reproduced with a throwaway Foundry test (below). Suggested fix: commit `keccak256(abi.encode(jobId, providerAddress, salt, scores))`, reveal the salt, and compare scores, not commitments.
2. **Missed events on scheduler restart (R11).** Chris. The scheduler watches from the latest block, so `JobFunded`/`JobComplete`/`JobFailed` events emitted while it is down are never processed. Persist the last processed block and backfill on start.
3. **Capacity held after a failed assignment or early refund (R11).** Chris.
   - `job:assignProviders` marks the job funded and reserves provider capacity before the on-chain `assignProviders` call. If that call reverts (observed: "Commit deadline passed"), capacity stays reserved until the wall-clock timeout cleanup.
   - The same happens after an early creator refund: the scheduler skips `JobFailed` events for refunded jobs.
4. **Duplicate item IDs (R2).** Chris, Jadon. Neither the backend nor the worker rejects duplicate `item_id`s.
5. **No model revision or worker version in job data (R3/R8).** Chris, Jadon. Receipts mark these "not recorded". Add an immutable model revision and worker version to models and jobs.
6. **Scheduler transport (minor).** Chris. The scheduler's wallet client uses `http()` without `NET_URL`, so it only works against the default `127.0.0.1:8545`.

Commitment-copy probe (run from `contracts/`, then delete):

```solidity
// test/CopyCommitProbe.t.sol
import {Test} from "forge-std/Test.sol";
import {Evaluation, JobStatus} from "../src/Evaluation.sol";
contract CopyCommitProbe is Test {
    function test_ProviderCanCopyOtherCommitAndReveal() public {
        address backend = address(0xB0); address creator = address(0xC0);
        address a = address(0xA1); address b = address(0xB1);
        Evaluation e = new Evaluation(backend);
        vm.deal(creator, 1 ether);
        vm.prank(creator); e.fundJob{value: 2500}("job");
        vm.prank(backend); e.assignProviders("job", a, "A", b, "B");
        bool[] memory scores = new bool[](3); scores[0] = true; scores[1] = true;
        bytes32 commitA = keccak256(abi.encode(scores));
        vm.prank(a); e.commitResult("job", commitA);
        vm.prank(b); e.commitResult("job", commitA);   // copied
        vm.prank(a); e.revealResult("job", scores);
        vm.prank(b); e.revealResult("job", scores);    // copied
        (,,,,,, JobStatus status,) = e.jobs("job");
        assertEq(uint8(status), uint8(JobStatus.Complete));
        vm.prank(b); e.claimPayment("job");
        assertEq(b.balance, 1250);                     // paid without evaluating
    }
}
```

## Blocked on backend or contract interfaces

- **Model revision and worker version on receipts.** Needs schema fields on `models`/`jobs` and the scheduler/worker to report them (Chris, Jadon).
- **Agreed receipt data.** The receipt uses what exists today. Confirm the receipt fields with Chris and Anthony, in particular whether the receipt should be a stored record or derived from contract plus Convex as it is now.
- **Refund recorded in Convex.** Refunds are read from the contract. Convex has no `refund_tx`, and the job stays `funded`/`failed` there (Chris).
- **Live two-worker run.** The demo used the simulator. A recorded run with two real workers on separate machines is still needed for R5/R10 (Jadon).
- **Admin UI for approvals.** Approvals are CLI-only (Chris, if wanted).

## Verification evidence

The scripted browser runs (`apps/web/e2e/verify-flows.mjs`, Chrome plus a test-only injected wallet over Anvil) passed every phase:

| Flow | Result | Screenshots |
| --- | --- | --- |
| Connect with no key field, account change, wrong network then switch, rejected funding signature, disconnect | Pass | `wallet-01` … `wallet-06` |
| Provider registration: rejected signature creates nothing; signed challenge registers a verified wallet | Pass (interactive browser) | `providers-rejected-signature.png` |
| Fund then accepted result with receipt and both claims | Pass | `success-01`, `success-02` |
| Disagreement: refund available, wrong account blocked, rejected refund stays refundable, refund confirmed (contract status 3) | Pass | `refund-01` … `refund-04` |
| Expiry: no refund before deadline, expired after, refund confirmed | Pass | `expiry-01` … `expiry-03` |
| Failed on-chain assignment: expired "Provider assignment failed", refund confirmed | Pass (incidental) | `expiry-assignment-failed-*` |
| Dev sandbox has no private-key input | Pass | `sandbox-01` |

Screenshots are in [`screenshots/`](screenshots/). Short recordings of the scripted runs are in [`recordings/`](recordings/) (`wallet.webm`, `success.webm`, `refund.webm`). All data shown is disposable demo data: a throwaway account, public Anvil test addresses, and masked worker secrets.

Automated tests: 15 lifecycle tests (web), 11 wallet-challenge tests (backend), and 59 Foundry tests, all passing. CI now runs the Bun tests and Foundry tests. These CI jobs have not yet been observed on GitHub.

## Slide contribution

**Slide: From key paste to wallet signing**

- M3 asked users to paste a private key. M4 removes it: MetaMask or any browser wallet signs every action.
- Provider wallets are proven with a signed, single-use, expiring challenge, and an admin approves only verified wallets.
- Rejections, wrong network, account switches, and disconnects all have clear in-app states.

**Slide: What the developer sees**

- Timeline: funding → providers assigned → commits/reveals with deadlines → accepted, failed, or expired → refund.
- Receipt: 66.7% (accuracy 0.667, 2/3 items), benchmark v1.0.0 SHA-256, model, result commitment, completion tx, both providers, and payment claims shown separately.
- Refunds are creator-signed `refund()` calls, checked against the contract first and labelled refunded only after confirmation.

**Slide: Honest status**

- Working: wallet flow, funding, settlement, receipts, disagreement and expiry refunds (local Anvil).
- Open: commitment copying (R6), scheduler event backfill (R11), model/worker versions on receipts, duplicate item IDs, a live two-worker run, public testnet.
