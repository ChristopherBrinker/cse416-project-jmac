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

    event JobFunded(string jobId, uint256 price);

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
}
