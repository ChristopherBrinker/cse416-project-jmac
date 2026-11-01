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

    function reveal(bool[] calldata scores) external {
        evaluation.revealResult(jobId, scores);
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

    function reveal(bool[] calldata scores) external {
        evaluation.revealResult(jobId, scores);
    }

    function claim() external {
        evaluation.claimPayment(jobId);
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

    bool[] scores;
    bool[] otherScores;

    event JobComplete(string jobId, bool[] scores);
    event JobFailed(string jobId);

    function setUp() public {
        evaluation = new Evaluation(backend);
        vm.deal(creator, 1 ether);
        scores = [true, false, true];
        otherScores = [true, true, true];
    }

    function hashOf(bool[] memory result) internal pure returns (bytes32) {
        return keccak256(abi.encode(result));
    }

    function status(string memory jobId) internal view returns (JobStatus) {
        (,,,,,, JobStatus jobStatus,) = evaluation.jobs(jobId);
        return jobStatus;
    }

    function fundAndAssign(string memory jobId, uint256 price, address a, address b) internal {
        vm.prank(creator);
        evaluation.fundJob{value: price}(jobId);
        vm.prank(backend);
        evaluation.assignProviders(jobId, a, "pA", b, "pB");
    }

    function commitBoth(bytes32 commitA, bytes32 commitB) internal {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, commitA);
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, commitB);
    }

    function reachComplete() internal {
        commitBoth(hashOf(scores), hashOf(scores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);
    }

    function reachFailed() internal {
        commitBoth(hashOf(scores), hashOf(otherScores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherScores);
    }

    // Same vector as test_matches_independent_viem_abi_encoding_vector in workers/tests/test_commitments.py
    function test_CommitHashMatchesWorkerEncoding() public view {
        assertEq(hashOf(scores), 0x82adde6ab39febe48ad5f5f17de582c728211b545b1e17ad56bf2bb040e7dc7e);
    }

    function test_FirstRevealDoesNotSettle() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.recordLogs();
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);

        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Open));
    }

    function test_MatchingRevealsEmitJobComplete() public {
        commitBoth(hashOf(scores), hashOf(scores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);

        vm.expectEmit(address(evaluation));
        emit JobComplete(JOB_ID, scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Complete));
    }

    function test_RevealOrderDoesNotMatter() public {
        commitBoth(hashOf(scores), hashOf(scores));
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);

        vm.expectEmit(address(evaluation));
        emit JobComplete(JOB_ID, scores);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
    }

    function test_DifferentRevealsEmitJobFailed() public {
        commitBoth(hashOf(scores), hashOf(otherScores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);

        vm.expectEmit(address(evaluation));
        emit JobFailed(JOB_ID);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherScores);

        assertEq(uint8(status(JOB_ID)), uint8(JobStatus.Failed));
    }

    function test_RevealsAreStoredInTheJobsGetter() public {
        reachComplete();

        (,,, Provider memory a, Provider memory b, bool flag,,) = evaluation.jobs(JOB_ID);

        assertTrue(flag);
        assertEq(a.addr, providerA);
        assertEq(b.addr, providerB);
        assertEq(a.commit, hashOf(scores));
        assertEq(hashOf(a.result), hashOf(scores));
        assertEq(hashOf(b.result), hashOf(scores));
        assertTrue(a.revealed && b.revealed);
    }

    function test_RevertWhen_RevealBeforeBothCommits() public {
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.startPrank(providerA);
        evaluation.commitResult(JOB_ID, hashOf(scores));
        vm.expectRevert("Commits incomplete");
        evaluation.revealResult(JOB_ID, scores);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealDoesNotMatchCommit() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.prank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, otherScores);
    }

    function test_FailedRevealCanBeRetriedWithTheCommittedScores() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.startPrank(providerA);
        vm.expectRevert("Result does not match commit");
        evaluation.revealResult(JOB_ID, otherScores);
        evaluation.revealResult(JOB_ID, scores);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealIsEmpty() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.prank(providerA);
        vm.expectRevert("Invalid result");
        evaluation.revealResult(JOB_ID, new bool[](0));
    }

    function test_RevertWhen_ProviderRevealsTwice() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.startPrank(providerA);
        evaluation.revealResult(JOB_ID, scores);
        vm.expectRevert("Already revealed");
        evaluation.revealResult(JOB_ID, scores);
        vm.stopPrank();
    }

    function test_RevertWhen_RevealAfterSettlement() public {
        reachComplete();

        vm.prank(providerB);
        vm.expectRevert("Already revealed");
        evaluation.revealResult(JOB_ID, scores);
    }

    function test_RevertWhen_RevealCallerNotAssigned() public {
        commitBoth(hashOf(scores), hashOf(scores));

        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.revealResult(JOB_ID, scores);
    }

    function test_RevertWhen_RevealJobNotFound() public {
        vm.prank(providerA);
        vm.expectRevert("Job not found");
        evaluation.revealResult(JOB_ID, scores);
    }

    function test_RevertWhen_RevealProvidersNotAssigned() public {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.prank(providerA);
        vm.expectRevert("Providers not assigned");
        evaluation.revealResult(JOB_ID, scores);
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
        evaluation.commitResult(JOB_ID, hashOf(scores));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, hashOf(scores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);

        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);
        vm.prank(providerA);
        evaluation.claimPayment(JOB_ID);

        assertEq(providerA.balance, 1250);
        assertEq(providerB.balance, 1251);
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

    function test_RevertWhen_ClaimJobNotFound() public {
        vm.prank(providerA);
        vm.expectRevert("Job not found");
        evaluation.claimPayment(JOB_ID);
    }

    function test_RevertWhen_ClaimBeforeBothReveals() public {
        commitBoth(hashOf(scores), hashOf(scores));
        vm.startPrank(providerA);
        evaluation.revealResult(JOB_ID, scores);

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
        attacker.commit(hashOf(scores));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, hashOf(scores));
        attacker.reveal(scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);

        attacker.claim();

        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, PRICE / 2);
        assertEq(address(evaluation).balance, PRICE - PRICE / 2);
    }

    function test_FailedPaymentCanStillBeClaimedByTheOtherProvider() public {
        RejectingProvider rejecting = new RejectingProvider(evaluation, JOB_ID);
        fundAndAssign(JOB_ID, PRICE, address(rejecting), providerB);
        rejecting.commit(hashOf(scores));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, hashOf(scores));
        rejecting.reveal(scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, scores);

        vm.expectRevert("Transfer failed");
        rejecting.claim();

        vm.prank(providerB);
        evaluation.claimPayment(JOB_ID);
        assertEq(providerB.balance, PRICE / 2);
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
        commitBoth(hashOf(scores), hashOf(scores));

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
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB");
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, hashOf(scores));
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, hashOf(otherScores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
        vm.prank(providerB);
        evaluation.revealResult(JOB_ID, otherScores);

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
        assertEq(evaluation.COMMIT_WINDOW(), 30 minutes);
        assertEq(evaluation.REVEAL_WINDOW(), 15 minutes);
    }

    function test_CommitAllowedAtTheDeadline() public {
        uint256 deadline = commitDeadline();
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.warp(deadline);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, hashOf(scores));
    }

    function test_RevertWhen_CommitAfterTheDeadline() public {
        uint256 deadline = commitDeadline();
        fundAndAssign(JOB_ID, PRICE, providerA, providerB);

        vm.warp(deadline + 1);
        vm.prank(providerA);
        vm.expectRevert("Commit deadline passed");
        evaluation.commitResult(JOB_ID, hashOf(scores));
    }

    function test_RevertWhen_AssignAfterTheDeadline() public {
        uint256 deadline = commitDeadline();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);

        vm.warp(deadline + 1);
        vm.prank(backend);
        vm.expectRevert("Commit deadline passed");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB");
    }

    function test_RevealAllowedAtTheDeadline() public {
        uint256 deadline = revealDeadline();
        commitBoth(hashOf(scores), hashOf(scores));

        vm.warp(deadline);
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
    }

    function test_RevertWhen_RevealAfterTheDeadline() public {
        uint256 deadline = revealDeadline();
        commitBoth(hashOf(scores), hashOf(scores));

        vm.warp(deadline + 1);
        vm.prank(providerA);
        vm.expectRevert("Reveal deadline passed");
        evaluation.revealResult(JOB_ID, scores);
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
        evaluation.commitResult(JOB_ID, hashOf(scores));
        uint256 balanceBefore = creator.balance;

        vm.warp(deadline + 1);
        vm.prank(creator);
        evaluation.refund(JOB_ID);

        assertEq(creator.balance, balanceBefore + PRICE);
        assertEq(providerA.balance, 0);
    }

    function test_RevertWhen_RefundBeforeRevealDeadlineWithBothCommits() public {
        uint256 deadline = revealDeadline();
        commitBoth(hashOf(scores), hashOf(scores));

        vm.warp(deadline);
        vm.prank(creator);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
    }

    function test_NeitherProviderPaidWhenOneNeverReveals() public {
        uint256 deadline = revealDeadline();
        commitBoth(hashOf(scores), hashOf(scores));
        vm.prank(providerA);
        evaluation.revealResult(JOB_ID, scores);
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
        commitBoth(hashOf(scores), hashOf(scores));

        vm.warp(deadline + 1);
        vm.startPrank(creator);
        evaluation.refund(JOB_ID);
        vm.expectRevert("Job not refundable");
        evaluation.refund(JOB_ID);
        vm.stopPrank();
    }

    function test_RevertWhen_TimeoutRefundCallerNotCreator() public {
        uint256 deadline = revealDeadline();
        commitBoth(hashOf(scores), hashOf(scores));

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
}
