// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, Vm} from "forge-std/Test.sol";
import {Evaluation} from "../src/Evaluation.sol";

contract EvaluationCommitTest is Test {
    Evaluation evaluation;

    address backend = makeAddr("backend");
    address creator = makeAddr("creator");
    address providerA = makeAddr("providerA");
    address providerB = makeAddr("providerB");
    address outsider = makeAddr("outsider");

    string constant JOB_ID = "job1";
    uint256 constant PRICE = 2500;
    bytes32 constant COMMIT_A = keccak256("result A");
    bytes32 constant COMMIT_B = keccak256("result B");

    event CommitComplete(string jobId);

    function setUp() public {
        evaluation = new Evaluation(backend);
        vm.deal(creator, 1 ether);
    }

    function fundJob() internal {
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}(JOB_ID);
    }

    function fundAndAssign() internal {
        fundJob();
        vm.prank(backend);
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB");
    }

    function test_FirstCommitDoesNotEmitCommitComplete() public {
        fundAndAssign();

        vm.recordLogs();
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function test_SecondCommitEmitsCommitComplete() public {
        fundAndAssign();

        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);

        vm.expectEmit(address(evaluation));
        emit CommitComplete(JOB_ID);
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, COMMIT_B);
    }

    function test_CommitOrderDoesNotMatter() public {
        fundAndAssign();

        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, COMMIT_B);

        vm.expectEmit(address(evaluation));
        emit CommitComplete(JOB_ID);
        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);
    }

    function test_RevertWhen_ProviderCommitsTwice() public {
        fundAndAssign();

        vm.startPrank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);
        vm.expectRevert("Already committed");
        evaluation.commitResult(JOB_ID, COMMIT_B);
        vm.stopPrank();
    }

    function test_RevertWhen_ProviderCommitsTwiceAfterCommitComplete() public {
        fundAndAssign();

        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);
        vm.prank(providerB);
        evaluation.commitResult(JOB_ID, COMMIT_B);

        vm.prank(providerB);
        vm.expectRevert("Already committed");
        evaluation.commitResult(JOB_ID, COMMIT_A);
    }

    function test_RevertWhen_CallerNotAssigned() public {
        fundAndAssign();

        vm.prank(outsider);
        vm.expectRevert("Unauthorized");
        evaluation.commitResult(JOB_ID, COMMIT_A);
    }

    function test_RevertWhen_JobNotFound() public {
        vm.prank(providerA);
        vm.expectRevert("Job not found");
        evaluation.commitResult(JOB_ID, COMMIT_A);
    }

    function test_RevertWhen_ProvidersNotAssigned() public {
        fundJob();

        vm.prank(providerA);
        vm.expectRevert("Providers not assigned");
        evaluation.commitResult(JOB_ID, COMMIT_A);
    }

    function test_RevertWhen_CommitIsZero() public {
        fundAndAssign();

        vm.prank(providerA);
        vm.expectRevert("Invalid commit");
        evaluation.commitResult(JOB_ID, bytes32(0));
    }

    function test_CommitsAreScopedToTheirJob() public {
        fundAndAssign();
        vm.prank(creator);
        evaluation.fundJob{value: PRICE}("job2");
        vm.prank(backend);
        evaluation.assignProviders("job2", providerA, "pA", providerB, "pB");

        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);

        // providerA's commit on job1 must not block or count toward job2
        vm.recordLogs();
        vm.prank(providerB);
        evaluation.commitResult("job2", COMMIT_B);
        assertEq(vm.getRecordedLogs().length, 0);

        vm.expectEmit(address(evaluation));
        emit CommitComplete("job2");
        vm.prank(providerA);
        evaluation.commitResult("job2", COMMIT_A);
    }

    function test_RevertWhen_ProvidersAreTheSameAddress() public {
        fundJob();

        vm.prank(backend);
        vm.expectRevert("Providers must be distinct");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerA, "pA");
    }

    function test_RevertWhen_ProvidersAlreadyAssigned() public {
        fundAndAssign();

        vm.prank(backend);
        vm.expectRevert("Providers already assigned");
        evaluation.assignProviders(JOB_ID, providerA, "pA", outsider, "pC");
    }

    function test_ReassignmentCannotResetCommits() public {
        fundAndAssign();

        vm.prank(providerA);
        evaluation.commitResult(JOB_ID, COMMIT_A);

        vm.prank(backend);
        vm.expectRevert("Providers already assigned");
        evaluation.assignProviders(JOB_ID, providerA, "pA", providerB, "pB");

        vm.prank(providerA);
        vm.expectRevert("Already committed");
        evaluation.commitResult(JOB_ID, COMMIT_B);
    }
}
