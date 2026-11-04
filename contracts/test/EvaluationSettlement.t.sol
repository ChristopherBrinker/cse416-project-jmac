// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, Vm} from "forge-std/Test.sol";
import {Evaluation, JobStatus, Provider} from "../src/Evaluation.sol";

// Claims again from inside its payment, keeping the outer claim alive if the inner one reverts.
contract ReentrantProvider {
    Evaluation evaluation;
    string jobId;
    bool public reentrySucceeded;

    constructor(Evaluation evaluation_, string memory jobId_) {
        evaluation = evaluation_;
        jobId = jobId_;
    }

    function commit(bytes32 hash) external {
        evaluation.commitResult(jobId, hash);
    }

    function reveal(bytes32 digest, uint256 correctCount, bytes32 salt) external {
        evaluation.revealResult(jobId, digest, correctCount, salt);
    }

    function claim() external {
        evaluation.claimPayment(jobId);
    }

    receive() external payable {
        try evaluation.claimPayment(jobId) {
            reentrySucceeded = true;
        } catch {}
    }
}

// Refunds again from inside its refund, keeping the outer refund alive if the inner one reverts.
contract ReentrantCreator {
    Evaluation evaluation;
    string jobId;
    bool public reentrySucceeded;

    constructor(Evaluation evaluation_, string memory jobId_) {
        evaluation = evaluation_;
        jobId = jobId_;
    }

    function fund() external payable {
        evaluation.fundJob{value: msg.value}(jobId);
    }

    function refund() external {
        evaluation.refund(jobId);
    }

    receive() external payable {
        try evaluation.refund(jobId) {
            reentrySucceeded = true;
        } catch {}
    }
}

// Has no receive function, so every payment to it fails.
contract RejectingProvider {
    Evaluation evaluation;
    string jobId;

    constructor(Evaluation evaluation_, string memory jobId_) {
        evaluation = evaluation_;
        jobId = jobId_;
    }

    function commit(bytes32 hash) external {
        evaluation.commitResult(jobId, hash);
    }

    function reveal(bytes32 digest, uint256 correctCount, bytes32 salt) external {
        evaluation.revealResult(jobId, digest, correctCount, salt);
    }

    function claim() external {
        evaluation.claimPayment(jobId);
    }
}

// Refuses its own refund, so the creator's refund transfer fails.
contract RejectingCreator {
    Evaluation evaluation;
    string jobId;

    constructor(Evaluation evaluation_, string memory jobId_) {
        evaluation = evaluation_;
        jobId = jobId_;
    }

    function fund() external payable {
        evaluation.fundJob{value: msg.value}(jobId);
    }

    function refund() external {
        evaluation.refund(jobId);
    }
}

contract EvaluationSettlementTest is Test {
    Evaluation evaluation;

    address backend = makeAddr("backend");
    address creator = makeAddr("creator");
    address providerA = makeAddr("providerA");
    address providerB = makeAddr("providerB");
    address outsider = makeAddr("outsider");

    string constant JOB_ID = "job1";
    uint256 constant PRICE = 2500;
    bytes32 constant SPEC = keccak256("spec");
    uint256 constant ITEM_COUNT = 3;
    bytes32 constant SALT = keccak256("salt");
    // Stands in for the benchmark-derived key; outsiders without the benchmark cannot compute it.
    bytes32 constant OUTPUT_KEY = keccak256("output key");

    // Answer key for the examples below is [0, 1, 2].
    bytes32 digest; // predictions [0, 1, 0] -> correctness [T, T, F], 2 correct
    uint256 constant COUNT = 2;
    bytes32 otherDigest; // predictions [0, 1, 2] -> 3 correct
    uint256 constant OTHER_COUNT = 3;

    event JobComplete(string jobId, bytes32 specHash, bytes32 outputDigest, uint256 correctCount, uint256 itemCount);
    event JobFailed(string jobId);

    function setUp() public {
        evaluation = new Evaluation(backend);
        vm.deal(creator, 1 ether);
        digest = digestOf(JOB_ID, predictions(0, 1, 0));
        otherDigest = digestOf(JOB_ID, predictions(0, 1, 2));
    }

    function predictions(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory p) {
        p = new uint256[](3);
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    // Same encoding as output_digest in workers/jmac_worker/commitments.py.
    function digestOf(string memory jobId, uint256[] memory predicted) internal pure returns (bytes32) {
        return keccak256(abi.encode(OUTPUT_KEY, jobId, predicted));
    }

    // Written out independently of Evaluation.resultCommitment so the tests pin the encoding.
    function commitOf(string memory jobId, address provider, bytes32 d, uint256 count) internal view returns (bytes32) {
        return commitOf(jobId, provider, d, count, ITEM_COUNT);
    }

    function commitOf(string memory jobId, address provider, bytes32 d, uint256 count, uint256 itemCount)
        internal
        view
        returns (bytes32)
    {
        return
            keccak256(abi.encode(block.chainid, address(evaluation), jobId, provider, SPEC, itemCount, d, count, SALT));
    }

    function status(string memory jobId) internal view returns (JobStatus) {
        (,,,,,, JobStatus jobStatus,,,) = evaluation.jobs(jobId);
        return jobStatus;
    }

    function fundAndAssign(string memory jobId, uint256 price, address a, address b) internal {
        vm.prank(creator);
        evaluation.fundJob{value: price}(jobId);
        vm.prank(backend);
        evaluation.assignProviders(jobId, a, "pA", b, "pB", SPEC, ITEM_COUNT);
    }

    function commitBoth(bytes32 digestA, uint256 countA, bytes32 digestB, uint256 countB) internal {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digestA, countA));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digestB, countB));
    }

    function commitAgreeing() internal {
        commitBoth(digest, COUNT, digest, COUNT);
    }

    function reachComplete() internal {
        commitAgreeing();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function reachFailed() internal {
        commitBoth(digest, COUNT, otherDigest, OTHER_COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherDigest, OTHER_COUNT, SALT);
    }

    // Same vectors as the encoding tests in workers/tests/test_commitments.py, cross-checked with
    // `cast abi-encode ... | cast keccak`.
    function test_CommitmentMatchesWorkerEncoding() public pure {
        bytes32 commitment = keccak256(
            abi.encode(
                uint256(31337),
                address(0x5FbDB2315678afecb367f032d93F642f64180aa3),
                "job1",
                address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8),
                bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
                uint256(3),
                bytes32(0x4444444444444444444444444444444444444444444444444444444444444444),
                uint256(2),
                bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
            )
        );
        assertEq(commitment, 0x94ad75828f321d8d12966fe4a06da72ede443a49c008ef121b0d78d394230e48);
    }

    function test_OutputDigestMatchesWorkerEncoding() public pure {
        uint256[] memory predicted = new uint256[](3);
        predicted[0] = 1;
        predicted[2] = 1;
        bytes32 d = keccak256(
            abi.encode(bytes32(0x3333333333333333333333333333333333333333333333333333333333333333), "job1", predicted)
        );
        assertEq(d, 0xbe98b0fae94f54c5eb150fd42db717921e510f3a7b5f869cbc3ed808c1035898);
    }

    function test_SpecHashMatchesSchedulerAndWorkerEncoding() public pure {
        bytes32 spec =
            keccak256(abi.encode("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "model1"));
        assertEq(spec, 0x051bd1fbac43750c77bbe2acd55022b45b4bf7a726ca55289f5021298470a342);
    }

    function test_FirstRevealDoesNotSettle() public {
        commitAgreeing();

        vm.recordLogs();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Open));
    }

    function test_MatchingRevealsEmitJobComplete() public {
        commitAgreeing();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectEmit(address(evaluation));
        emit JobComplete(JOB_ID, SPEC, digest, COUNT, ITEM_COUNT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Complete));
    }

    function test_RevealOrderDoesNotMatter() public {
        commitAgreeing();
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectEmit(address(evaluation));
        emit JobComplete(JOB_ID, SPEC, digest, COUNT, ITEM_COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_DifferentRevealsEmitJobFailed() public {
        commitBoth(digest, COUNT, otherDigest, OTHER_COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectEmit(address(evaluation));
        emit JobFailed(JOB_ID);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherDigest, OTHER_COUNT, SALT);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Failed));
    }

    // Equal accuracy (2 of 3) is not agreement: the ordered predictions must match.
    function test_SameAccuracyInADifferentOrderFails() public {
        // predictions [0, 1, 0] vs [1, 1, 2]: correctness [T,T,F] vs [F,T,T], both 2 of 3
        bytes32 reordered = digestOf(JOB_ID, predictions(1, 1, 2));
        commitBoth(digest, COUNT, reordered, COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectEmit(address(evaluation));
        emit JobFailed(JOB_ID);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, reordered, COUNT, SALT);

        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);
        vm.prank(creator);
        evaluation.refund(JOB_ID);
        assertEq(address(evaluation).balance, 0);
    }

    // The M3 correctness vector could not tell these apart; the prediction digest can.
    function test_SameCorrectnessWithDifferentWrongPredictionsFails() public {
        // predictions [0, 1, 0] vs [0, 1, 1]: both correctness [T, T, F]
        bytes32 otherWrongAnswer = digestOf(JOB_ID, predictions(0, 1, 1));
        commitBoth(digest, COUNT, otherWrongAnswer, COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherWrongAnswer, COUNT, SALT);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Failed));
    }

    function test_SameDigestWithDifferentScoresFails() public {
        commitBoth(digest, COUNT, digest, OTHER_COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, OTHER_COUNT, SALT);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Failed));
    }

    function test_RevealsAreStoredInTheJobsGetter() public {
        reachComplete();

        (,,, Provider memory a, Provider memory b, bool flag,,, bytes32 spec, uint256 itemCount) =
            evaluation.jobs(JOB_ID);

        assertTrue(flag);
        assertEq(spec, SPEC);
        assertEq(itemCount, ITEM_COUNT);
        assertEq(a.addr, providerA);
        assertEq(b.addr, providerB);
        assertEq(a.commit, commitOf(JOB_ID, providerA, digest, COUNT));
        assertEq(a.outputDigest, digest);
        assertEq(b.outputDigest, digest);
        assertEq(a.correctCount, COUNT);
        assertEq(b.correctCount, COUNT);
        assertTrue(a.revealed && b.revealed);
    }

    // Only digests and counts reach the chain; nothing per item is stored or emitted.
    function test_SettlementPublishesNoPerItemData() public {
        commitAgreeing();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.recordLogs();
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1);
        (string memory jobId, bytes32 spec, bytes32 d, uint256 count, uint256 items) =
            abi.decode(logs[0].data, (string, bytes32, bytes32, uint256, uint256));
        assertEq(jobId, JOB_ID);
        assertEq(spec, SPEC);
        assertEq(d, digest);
        assertEq(count, COUNT);
        assertEq(items, ITEM_COUNT);
    }

    function test_RevertWhen_RevealBeforeBothCommits() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.startPrank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.expectRevert("Commits incomplete");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealDoesNotMatchCommit() public {
        commitAgreeing();

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, otherDigest, COUNT, SALT);
    }

    function test_RevertWhen_RevealedScoreDoesNotMatchCommit() public {
        commitAgreeing();

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT - 1, SALT);
    }

    function test_FailedRevealCanBeRetriedWithTheCommittedResult() public {
        commitAgreeing();

        vm.startPrank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, otherDigest, COUNT, SALT);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealIsEmpty() public {
        commitAgreeing();

        vm.prank(providerA);
        vm.expectRevert("Invalid result");
        evaluation.revealResult(JOB_ID, bytes32(0), COUNT, SALT);
    }

    function test_RevertWhen_ScoreExceedsItemCount() public {
        commitBoth(digest, ITEM_COUNT + 1, digest, ITEM_COUNT + 1);

        vm.prank(providerA);
        vm.expectRevert("Score exceeds item count");
        evaluation.revealResult(JOB_ID, digest, ITEM_COUNT + 1, SALT);
    }

    function test_PerfectScoreIsAccepted() public {
        commitBoth(otherDigest, ITEM_COUNT, otherDigest, ITEM_COUNT);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, otherDigest, ITEM_COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherDigest, ITEM_COUNT, SALT);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Complete));
    }

    // A result computed for a benchmark of another length cannot be opened on this job.
    function test_RevertWhen_CommitIsForAShorterBenchmark() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT, ITEM_COUNT - 1));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_CommitIsForALongerBenchmark() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT, ITEM_COUNT + 1));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_ProviderRevealsTwice() public {
        commitAgreeing();

        vm.startPrank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.expectRevert("Already revealed");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealAfterSettlement() public {
        reachComplete();

        vm.prank(providerB);
        vm.expectRevert("Already revealed");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_RevealCallerNotAssigned() public {
        commitAgreeing();

        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_RevealJobNotFound() public {
        vm.prank(providerA);
        vm.expectRevert("Job not found");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_RevealProvidersNotAssigned() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.prank(providerA);
        vm.expectRevert("Providers not assigned");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_CreatorIsAssignedAsProvider() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.startPrank(backend);
        vm.expectRevert("Creator cannot provide");
        evaluation.assignProviders(JOB_ID, creator, "pA", providerB, "pB", SPEC, ITEM_COUNT);
        vm.expectRevert("Creator cannot provide");
        evaluation.assignProviders(JOB_ID, providerA, "pA", creator, "pB", SPEC, ITEM_COUNT);
        vm.stopPrank();
    }

    function test_RevertWhen_AssignCallerNotBackend() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
    }

    function test_ProvidersEachClaimHalf() public {
        reachComplete();

        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);

        assertEq(providerA.balance, PRICE / 2);
        assertEq(providerB.balance, PRICE / 2);
        assertEq(address(evaluation).balance, 0);
    }

    function test_OddPriceLeavesNoFundsLocked() public {
        uint256 oddPrice = 2501;
        fundAndAssign(JOB_ID, oddPrice, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);

        assertEq(providerA.balance, 1250);
        assertEq(providerB.balance, 1251);
        assertEq(address(evaluation).balance, 0);
    }

    function test_OneWeiJobPaysTheOddWeiToProviderB() public {
        fundAndAssign(JOB_ID, 1, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);

        assertEq(providerA.balance, 0);
        assertEq(providerB.balance, 1);
        assertEq(address(evaluation).balance, 0);
    }

    function testFuzz_ClaimsPayExactlyThePrice(uint96 price) public {
        vm.assume(price > 0);
        vm.deal(creator, price);
        fundAndAssign(JOB_ID, price, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);

        assertEq(providerA.balance + providerB.balance, price);
        assertEq(providerB.balance - providerA.balance, price % 2);
        assertEq(address(evaluation).balance, 0);
    }

    function test_ClaimsOnlyPayOutTheirOwnJob() public {
        reachComplete();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}("job2");

        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);

        assertEq(address(evaluation).balance, PRICE + PRICE / 2);

        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment("job2");
    }

    function test_RevertWhen_ProviderClaimsTwice() public {
        reachComplete();

        vm.startPrank(providerA);
        evaluation.claimPayment(JOB_ID);
        vm.expectRevert("Already claimed");
        evaluation.claimPayment(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_ClaimCallerNotAssigned() public {
        reachComplete();

        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_CreatorClaims() public {
        reachComplete();

        vm.prank(creator);
        vm.expectRevert("Unauthorized");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_ClaimJobNotFound() public {
        vm.prank(providerA);
        vm.expectRevert("Job not found");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_ClaimBeforeBothReveals() public {
        commitAgreeing();
        vm.startPrank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_ClaimOnFailedJob() public {
        reachFailed();

        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);
    }

    function test_ReentrantClaimOnlyPaysOnce() public {
        ReentrantProvider attacker = new ReentrantProvider(evaluation, JOB_ID);
        fundAndAssign(JOB_ID, PRICE, address(attacker), providerB);
        attacker.commit(commitOf(JOB_ID, address(attacker), digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));
        attacker.reveal(digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        attacker.claim();

        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, PRICE / 2);
        assertEq(address(evaluation).balance, PRICE - PRICE / 2);
    }

    function test_FailedPaymentCanStillBeClaimedByTheOtherProvider() public {
        RejectingProvider rejecting = new RejectingProvider(evaluation, JOB_ID);
        fundAndAssign(JOB_ID, PRICE, address(rejecting), providerB);
        rejecting.commit(commitOf(JOB_ID, address(rejecting), digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));
        rejecting.reveal(digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);

        vm.expectRevert("Transfer failed");
        rejecting.claim();

        // the failed claim rolled back, so its share is still held and still claimable
        (,,, Provider memory a,,,,,,) = evaluation.jobs(JOB_ID);
        assertFalse(a.claimed);
        assertEq(address(evaluation).balance, PRICE);

        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);
        assertEq(providerB.balance, PRICE / 2);
    }

    function test_FailedRefundTransferKeepsTheJobRefundable() public {
        RejectingCreator rejecting = new RejectingCreator(evaluation, JOB_ID);
        vm.deal(address(this), PRICE);
        rejecting.fund{value: PRICE}();
        uint256 deadline = block.timestamp + evaluation.COMMIT_WINDOW();

        vm.warp(deadline + 1);
        vm.expectRevert("Transfer failed");
        rejecting.refund();

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Open));
        assertEq(address(evaluation).balance, PRICE);
    }

    function test_CreatorRefundedOnFailure() public {
        reachFailed();
        uint256 balanceBefore = creator.balance;

        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(creator.balance, balanceBefore + PRICE);
        assertEq(address(evaluation).balance, 0);
        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Refunded));
    }

    function test_RevertWhen_RefundTwice() public {
        reachFailed();

        vm.startPrank(creator);
        evaluation.refund(JOB_ID);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_RefundCallerNotCreator() public {
        reachFailed();

        vm.prank(providerA);
        vm.expectRevert("Unauthorized");
        evaluation.refund(JOB_ID);
    }

    function test_RevertWhen_RefundJobNotFound() public {
        vm.prank(creator);
        vm.expectRevert("Job not found");
        evaluation.refund(JOB_ID);
    }

    function test_RevertWhen_RefundOnOpenJob() public {
        commitAgreeing();

        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
    }

    function test_RevertWhen_RefundOnCompleteJob() public {
        reachComplete();

        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
    }

    function test_ReentrantRefundOnlyPaysOnce() public {
        ReentrantCreator attacker = new ReentrantCreator(evaluation, JOB_ID);
        vm.deal(address(this), PRICE);
        attacker.fund{value: PRICE}();
        vm.prank(backend);
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, otherDigest, OTHER_COUNT));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherDigest, OTHER_COUNT, SALT);

        // funds from a second job that a double refund would drain
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}("job2");

        attacker.refund();

        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, PRICE);
        assertEq(address(evaluation).balance, PRICE);
    }

    function commitDeadline() internal view returns (uint256) {
        return block.timestamp + evaluation.COMMIT_WINDOW();
    }

    function revealDeadline() internal view returns (uint256) {
        return commitDeadline() + evaluation.REVEAL_WINDOW();
    }

    function test_WindowsMatchTheAgreedTiming() public view {
        assertEq(evaluation.COMMIT_WINDOW(), 5 minutes);
        assertEq(evaluation.REVEAL_WINDOW(), 2.5 minutes);
    }

    function test_CommitAllowedAtTheDeadline() public {
        uint256 deadline = commitDeadline();
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.warp(deadline);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
    }

    function test_RevertWhen_CommitAfterTheDeadline() public {
        uint256 deadline = commitDeadline();
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.warp(deadline + 1);
        vm.prank(providerA);
        vm.expectRevert("Commit deadline passed");
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
    }

    function test_RevertWhen_AssignAfterTheDeadline() public {
        uint256 deadline = commitDeadline();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.warp(deadline + 1);
        vm.prank(backend);
        vm.expectRevert("Commit deadline passed");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
    }

    function test_RevealAllowedAtTheDeadline() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();

        vm.warp(deadline);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_RevealAfterTheDeadline() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();

        vm.warp(deadline + 1);
        vm.prank(providerA);
        vm.expectRevert("Reveal deadline passed");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RefundWhenProvidersNeverAssigned() public {
        uint256 deadline = commitDeadline();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);
        uint256 balanceBefore = creator.balance;

        vm.warp(deadline);
        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);

        vm.warp(deadline + 1);
        vm.expectEmit(address(evaluation));
        emit JobFailed(JOB_ID);
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(creator.balance, balanceBefore + PRICE);
        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Refunded));
    }

    function test_RefundAtCommitDeadlineWhenOneProviderNeverCommits() public {
        uint256 deadline = commitDeadline();
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        uint256 balanceBefore = creator.balance;

        vm.warp(deadline + 1);
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(creator.balance, balanceBefore + PRICE);
        assertEq(providerA.balance, 0);
    }

    function test_RevertWhen_RefundBeforeRevealDeadlineWithBothCommits() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();

        vm.warp(deadline);
        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
    }

    function test_NeitherProviderPaidWhenOneNeverReveals() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        uint256 balanceBefore = creator.balance;

        vm.warp(deadline + 1);
        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);

        vm.expectEmit(address(evaluation));
        emit JobFailed(JOB_ID);
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(creator.balance, balanceBefore + PRICE);
        assertEq(providerA.balance, 0);
        assertEq(address(evaluation).balance, 0);
    }

    function test_RevertWhen_TimeoutRefundTwice() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();

        vm.warp(deadline + 1);
        vm.startPrank(creator);
        evaluation.refund(JOB_ID);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_TimeoutRefundCallerNotCreator() public {
        uint256 deadline = revealDeadline();
        commitAgreeing();

        vm.warp(deadline + 1);
        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.refund(JOB_ID);
    }

    function test_CompleteJobCannotBeRefundedAfterTheDeadline() public {
        uint256 deadline = revealDeadline();
        reachComplete();

        vm.warp(deadline + 1);
        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);

        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);
        assertEq(providerA.balance, PRICE / 2);
    }

    function test_FailedJobRefundEmitsNoSecondJobFailed() public {
        reachFailed();

        vm.recordLogs();
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_ResultCommitmentMatchesTheIndependentEncoding() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        assertEq(
            evaluation.resultCommitment(JOB_ID, providerA, digest, COUNT, SALT),
            commitOf(JOB_ID, providerA, digest, COUNT)
        );
    }

    function test_AssignmentRecordsSpecAndItemCount() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        (,,,,,,,, bytes32 spec, uint256 itemCount) = evaluation.jobs(JOB_ID);
        assertEq(spec, SPEC);
        assertEq(itemCount, ITEM_COUNT);
    }

    function test_RevertWhen_AssignWithoutSpec() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.prank(backend);
        vm.expectRevert("Invalid spec");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", bytes32(0), ITEM_COUNT);
    }

    function test_RevertWhen_AssignWithoutItemCount() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.prank(backend);
        vm.expectRevert("Invalid item count");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", SPEC, 0);
    }

    // A provider that copies the other's commitment cannot open it, so it cannot free-ride.
    function test_CopiedCommitCannotBeRevealed() public {
        uint256 deadline = block.timestamp + evaluation.COMMIT_WINDOW() + evaluation.REVEAL_WINDOW();
        commitAgreeing();
        bytes32 copied = commitOf(JOB_ID, providerA, digest, COUNT);
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}("job2");
        vm.prank(backend);
        evaluation.assignProviders("job2", providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
        vm.prank(providerA);
        evaluation.commitResult("job2", commitOf("job2", providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult("job2", copied);

        vm.prank(providerA);
        evaluation.revealResult("job2", digest, COUNT, SALT);
        vm.prank(providerB);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult("job2", digest, COUNT, SALT);

        vm.warp(deadline + 1);
        vm.prank(creator);
        evaluation.refund("job2");
        assertEq(providerA.balance + providerB.balance, 0);
    }

    function test_CommitCannotBeReplayedOnAnotherJob() public {
        commitAgreeing();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}("job2");
        vm.prank(backend);
        evaluation.assignProviders("job2", providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
        vm.prank(providerA);
        evaluation.commitResult("job2", commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult("job2", commitOf("job2", providerB, digest, COUNT));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult("job2", digest, COUNT, SALT);
    }

    function test_CommitCannotBeReplayedOnAnotherChain() public {
        commitAgreeing();

        vm.chainId(block.chainid + 1);
        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_CommitCannotBeReplayedOnAnotherContract() public {
        Evaluation other = new Evaluation(backend);
        vm.prank(creator);
        other.fundJob{value: PRICE}(JOB_ID);
        vm.prank(backend);
        other.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", SPEC, ITEM_COUNT);
        // commitOf binds to the first deployment, not `other`
        vm.prank(providerA);
        other.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        other.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        other.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_CommitCannotBeReplayedForAnotherSpec() public {
        bytes32 otherSpec = keccak256("other spec");
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);
        vm.prank(backend);
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB", otherSpec, ITEM_COUNT);
        // commitOf hashes SPEC, but this job was assigned otherSpec
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerA, digest, COUNT));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitOf(JOB_ID, providerB, digest, COUNT));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
    }

    function test_RevertWhen_RevealWithTheWrongSalt() public {
        commitAgreeing();

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, digest, COUNT, keccak256("wrong salt"));
    }

    function test_RevertWhen_ClaimAfterRefund() public {
        reachFailed();
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_ClaimAfterTimeoutRefund() public {
        uint256 deadline = block.timestamp + evaluation.COMMIT_WINDOW() + evaluation.REVEAL_WINDOW();
        commitAgreeing();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, digest, COUNT, SALT);
        vm.warp(deadline + 1);
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        vm.prank(providerA);
        vm.expectRevert("Job not complete");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_RefundAfterProvidersClaimed() public {
        reachComplete();
        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);

        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
    }

    function test_RevertWhen_FundingAnExistingJobId() public {
        vm.startPrank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);
        vm.expectRevert("Job already exists with this id");
        evaluation.fundJob{value: PRICE}(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_FundingWithoutValue() public {
        vm.prank(creator);
        vm.expectRevert("Funding required");
        evaluation.fundJob(JOB_ID);
    }
}
