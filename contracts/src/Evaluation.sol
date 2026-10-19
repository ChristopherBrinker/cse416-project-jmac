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
    string commit;
    bool[] result; // since mc format, result can be represented by a list of true/false for each item
    bool flag; // used to detect default Provider i.e. not initialized
}

contract Evaluation {
    mapping(string => Job) public jobs;

    address backend;

    event JobFunded(string jobId, uint256 price);
    event ProvidersAssigned(string jobId, address addressA, string providerIdA, address addressB, string providerIdB);

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

        Job memory j = jobs[jobId];
        require(j.flag, "Job not found");

        Provider memory providerA = Provider({
            addr: addressA,
            id: providerIdA,
            flag: true,
            commit: "",
            result: new bool[](0)
        });
        Provider memory providerB = Provider({
            addr: addressB,
            id: providerIdB,
            flag: true,
            commit: "",
            result: new bool[](0)
        });

        j.providerA = providerA;
        j.providerB = providerB;

        jobs[jobId] = j;
        emit ProvidersAssigned(jobId, addressA, providerIdA, addressB, providerIdB);
    }
}
