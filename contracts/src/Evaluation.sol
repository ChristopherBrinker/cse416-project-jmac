// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

// Result policy (docs/m4/protocol.md): a job is accepted only when both assigned providers reveal
// the same keyed digest of their ordered predicted choice indices and the same correct count.
// Only the digest and the count reach the chain; questions, answer keys, predictions and
// per-item correctness stay off-chain. Agreement proves the two providers reported identical
// outputs, not that either one executed the model honestly.
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
    uint256 commitDeadline; // reveals close REVEAL_WINDOW after this
    bytes32 specHash; // keccak256(abi.encode(benchmark content hash, model id)), set at assignment
    uint256 itemCount; // benchmark length, bound into every result commitment
}

struct Provider {
    address addr;
    string id;
    bytes32 commit; // resultCommitment of the provider's result, zero until committed
    // keyed digest of the ordered predicted choice indices (see outputDigest in
    // workers/jmac_worker/commitments.py); zero until revealed
    bytes32 outputDigest;
    bool flag; // used to detect default Provider i.e. not initialized
    bool revealed;
    bool claimed;
    // workers read this struct by tuple index, so only append new fields
    uint256 correctCount; // revealed number of correctly answered items
}

contract Evaluation {
    uint256 public constant COMMIT_WINDOW = 5 minutes;
    uint256 public constant REVEAL_WINDOW = 2.5 minutes;

    mapping(string => Job) public jobs;

    address backend;

    event JobFunded(string jobId, uint256 price);
    event ProvidersAssigned(string jobId, address addressA, string providerIdA, address addressB, string providerIdB);
    event CommitComplete(string jobId);
    // Accepted-result evidence: the spec, the agreed output digest and the agreed score.
    // Provider identities are in ProvidersAssigned and the jobs getter.
    event JobComplete(string jobId, bytes32 specHash, bytes32 outputDigest, uint256 correctCount, uint256 itemCount);
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
        j.commitDeadline = block.timestamp + COMMIT_WINDOW;
        jobs[jobId] = j;
        emit JobFunded(jobId, msg.value);
    }

    function assignProviders(
        string memory jobId,
        address addressA,
        string memory providerIdA,
        address addressB,
        string memory providerIdB,
        bytes32 specHash,
        uint256 itemCount
    ) public {
        require(msg.sender == backend, "Unauthorized");
        require(addressA != address(0), "Invalid address");
        require(addressB != address(0), "Invalid address");
        require(addressA != addressB, "Providers must be distinct");
        require(specHash != bytes32(0), "Invalid spec");
        require(itemCount > 0, "Invalid item count");

        Job memory j = jobs[jobId];
        require(j.flag, "Job not found");
        // the creator's own wallet may never evaluate its job; Convex also excludes the
        // creator's account and pairs of providers sharing a user or wallet
        require(addressA != j.creatorAddr && addressB != j.creatorAddr, "Creator cannot provide");
        // reassigning would reset commits already submitted
        require(!j.providerA.flag && !j.providerB.flag, "Providers already assigned");
        require(block.timestamp <= j.commitDeadline, "Commit deadline passed");

        Provider memory providerA = Provider({
            addr: addressA,
            id: providerIdA,
            flag: true,
            commit: bytes32(0),
            outputDigest: bytes32(0),
            revealed: false,
            claimed: false,
            correctCount: 0
        });
        Provider memory providerB = Provider({
            addr: addressB,
            id: providerIdB,
            flag: true,
            commit: bytes32(0),
            outputDigest: bytes32(0),
            revealed: false,
            claimed: false,
            correctCount: 0
        });

        j.providerA = providerA;
        j.providerB = providerB;
        j.specHash = specHash;
        j.itemCount = itemCount;

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
        require(block.timestamp <= j.commitDeadline, "Commit deadline passed");

        p.commit = commit;

        if (j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0)) {
            emit CommitComplete(jobId);
        }
    }

    // The commitment binds the result to this chain, contract, job, provider, evaluation spec and
    // item count, so it cannot be replayed elsewhere or copied by the other provider. The secret
    // salt stops anyone recovering the committed result by enumeration before the reveal.
    // Must match result_commitment in workers/jmac_worker/commitments.py.
    function resultCommitment(
        string memory jobId,
        address provider,
        bytes32 outputDigest,
        uint256 correctCount,
        bytes32 salt
    ) public view returns (bytes32) {
        Job storage j = jobs[jobId];
        return keccak256(
            abi.encode(
                block.chainid, address(this), jobId, provider, j.specHash, j.itemCount, outputDigest, correctCount, salt
            )
        );
    }

    // Called by each assigned provider to reveal the result behind its commit. Reveals only open
    // once both commits are in, so neither provider can base its commit on the other's result.
    function revealResult(string memory jobId, bytes32 outputDigest, uint256 correctCount, bytes32 salt) external {
        Job storage j = jobs[jobId];
        require(j.flag, "Job not found");
        require(j.providerA.flag && j.providerB.flag, "Providers not assigned");

        Provider storage p = assignedProvider(j);
        require(j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0), "Commits incomplete");
        require(!p.revealed, "Already revealed");
        require(block.timestamp <= j.commitDeadline + REVEAL_WINDOW, "Reveal deadline passed");
        require(outputDigest != bytes32(0), "Invalid result");
        require(correctCount <= j.itemCount, "Score exceeds item count");
        require(
            resultCommitment(jobId, msg.sender, outputDigest, correctCount, salt) == p.commit,
            "Result does not match commit"
        );

        p.revealed = true;
        p.outputDigest = outputDigest;
        p.correctCount = correctCount;

        if (j.providerA.revealed && j.providerB.revealed) {
            // commits differ per provider (address and salt), so agreement compares the reveals
            bool agreed = j.providerA.outputDigest == j.providerB.outputDigest
                && j.providerA.correctCount == j.providerB.correctCount;
            if (agreed) {
                j.status = JobStatus.Complete;
                emit JobComplete(jobId, j.specHash, outputDigest, correctCount, j.itemCount);
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
        bool timedOut = j.status == JobStatus.Open && hasTimedOut(j);
        require(j.status == JobStatus.Failed || timedOut, "Job not refundable");
        require(msg.sender == j.creatorAddr, "Unauthorized");

        j.status = JobStatus.Refunded;

        if (timedOut) {
            emit JobFailed(jobId);
        }

        (bool success,) = msg.sender.call{value: j.price}("");
        require(success, "Transfer failed");
    }

    // Without both commits nothing can be revealed, so the job is over at the commit deadline.
    function hasTimedOut(Job storage j) private view returns (bool) {
        bool bothCommitted = j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0);
        uint256 deadline = bothCommitted ? j.commitDeadline + REVEAL_WINDOW : j.commitDeadline;
        return block.timestamp > deadline;
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
