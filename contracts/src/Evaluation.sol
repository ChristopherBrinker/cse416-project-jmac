// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

enum JobStatus {
    Open,
    Complete, // both reveals matched; providers may claim payment
    Failed, // reveals differed; creator may refund
    Refunded
}

struct Job {
    address creatorAddr;
    string id;
    uint256 price;
    Provider providerA;
    Provider providerB;
    bool flag; // used to detect default job i.e. not in mapping
    // workers read these structs by tuple index, so only append new fields
    JobStatus status;
}

struct Provider {
    address addr;
    string id;
    bytes32 commit; // hash of the provider's result, zero until committed
    bool[] result; // since mc format, result can be represented by a list of true/false for each item
    bool flag; // used to detect default Provider i.e. not initialized
    bool revealed;
    bool claimed;
}

contract Evaluation {
    mapping(string => Job) public jobs;

    address backend;

    event JobFunded(string jobId, uint256 price);
    event ProvidersAssigned(string jobId, address addressA, string providerIdA, address addressB, string providerIdB);
    event CommitComplete(string jobId);
    event JobComplete(string jobId, bool[] scores);
    event JobFailed(string jobId);

    constructor(address backendAddr) {
        require(backendAddr != address(0), "Must provide a backend address");
        backend = backendAddr;
    }

    function fundJob(string memory jobId) external payable {
        require(msg.value > 0, "Funding required");
        Job memory j = jobs[jobId];
        require(!j.flag, "Job already exists with this id");
        j.creatorAddr = msg.sender;
        j.id = jobId;
        j.price = msg.value;
        j.flag = true;
        jobs[jobId] = j;
        emit JobFunded(jobId, msg.value);
    }

    function assignProviders(string memory jobId, address addressA, string memory providerIdA, address addressB, string memory providerIdB) public {
        require(msg.sender == backend, "Unauthorized");
        require(addressA != address(0), "Invalid address");
        require(addressB != address(0), "Invalid address");
        require(addressA != addressB, "Providers must be distinct");

        Job memory j = jobs[jobId];
        require(j.flag, "Job not found");
        // reassigning would reset commits already submitted
        require(!j.providerA.flag && !j.providerB.flag, "Providers already assigned");

        Provider memory providerA = Provider({
            addr: addressA,
            id: providerIdA,
            flag: true,
            commit: bytes32(0),
            result: new bool[](0),
            revealed: false,
            claimed: false
        });
        Provider memory providerB = Provider({
            addr: addressB,
            id: providerIdB,
            flag: true,
            commit: bytes32(0),
            result: new bool[](0),
            revealed: false,
            claimed: false
        });

        j.providerA = providerA;
        j.providerB = providerB;

        jobs[jobId] = j;
        emit ProvidersAssigned(jobId, addressA, providerIdA, addressB, providerIdB);
    }

    // Called by each assigned provider to submit the hash of its result. The hash is checked
    // against the revealed data later, so each provider may only commit once.
    function commitResult(string memory jobId, bytes32 commit) external {
        require(commit != bytes32(0), "Invalid commit");

        Job storage j = jobs[jobId];
        require(j.flag, "Job not found");
        require(j.providerA.flag && j.providerB.flag, "Providers not assigned");

        Provider storage p = assignedProvider(j);
        require(p.commit == bytes32(0), "Already committed");

        p.commit = commit;

        if (j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0)) {
            emit CommitComplete(jobId);
        }
    }

    // Called by each assigned provider to reveal the scores behind its commit. Reveals only open
    // once both commits are in, so neither provider can base its commit on the other's scores.
    function revealResult(string memory jobId, bool[] calldata scores) external {
        require(scores.length > 0, "Invalid result");

        Job storage j = jobs[jobId];
        require(j.flag, "Job not found");
        require(j.providerA.flag && j.providerB.flag, "Providers not assigned");

        Provider storage p = assignedProvider(j);
        require(j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0), "Commits incomplete");
        require(!p.revealed, "Already revealed");
        // must match the worker's encoding in workers/jmac_worker/commitments.py
        require(keccak256(abi.encode(scores)) == p.commit, "Result does not match commit");

        p.revealed = true;
        p.result = scores;

        if (j.providerA.revealed && j.providerB.revealed) {
            // both reveals match their commits, so equal commits mean equal scores
            if (j.providerA.commit == j.providerB.commit) {
                j.status = JobStatus.Complete;
                emit JobComplete(jobId, scores);
            } else {
                j.status = JobStatus.Failed;
                emit JobFailed(jobId);
            }
        }
    }

    function claimPayment(string memory jobId) external {
        Job storage j = jobs[jobId];
        require(j.flag, "Job not found");
        require(j.status == JobStatus.Complete, "Job not complete");

        Provider storage p = assignedProvider(j);
        require(!p.claimed, "Already claimed");

        p.claimed = true;

        // provider B takes the odd wei, if any, so no funds stay locked
        uint256 half = j.price / 2;
        uint256 amount = msg.sender == j.providerA.addr ? half : j.price - half;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function refund(string memory jobId) external {
        Job storage j = jobs[jobId];
        require(j.flag, "Job not found");
        require(j.status == JobStatus.Failed, "Job not refundable");
        require(msg.sender == j.creatorAddr, "Unauthorized");

        j.status = JobStatus.Refunded;

        (bool success,) = msg.sender.call{value: j.price}("");
        require(success, "Transfer failed");
    }

    function assignedProvider(Job storage j) private view returns (Provider storage) {
        if (msg.sender == j.providerA.addr) {
            return j.providerA;
        }
        if (msg.sender == j.providerB.addr) {
            return j.providerB;
        }
        revert("Unauthorized");
    }
}
