// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

struct Job {
    address creatorAddr;
    string id;
    uint256 price;
    Provider providerA;
    Provider providerB;
    bool flag; // used to detect default job i.e. not in mapping
}

struct Provider {
    address addr;
    string id;
    bytes32 commit; // hash of the provider's result, zero until committed
    bool[] result; // since mc format, result can be represented by a list of true/false for each item
    bool flag; // used to detect default Provider i.e. not initialized
}

contract Evaluation {
    mapping(string => Job) public jobs;

    address backend;

    event JobFunded(string jobId, uint256 price);
    event ProvidersAssigned(string jobId, address addressA, string providerIdA, address addressB, string providerIdB);
    event CommitComplete(string jobId);

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
            result: new bool[](0)
        });
        Provider memory providerB = Provider({
            addr: addressB,
            id: providerIdB,
            flag: true,
            commit: bytes32(0),
            result: new bool[](0)
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

        Provider storage p;
        if (msg.sender == j.providerA.addr) {
            p = j.providerA;
        } else if (msg.sender == j.providerB.addr) {
            p = j.providerB;
        } else {
            revert("Unauthorized");
        }
        require(p.commit == bytes32(0), "Already committed");

        p.commit = commit;

        if (j.providerA.commit != bytes32(0) && j.providerB.commit != bytes32(0)) {
            emit CommitComplete(jobId);
        }
    }
}
