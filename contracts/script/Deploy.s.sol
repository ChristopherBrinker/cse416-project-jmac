// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {Evaluation} from "../src/Evaluation.sol";

contract EvaluationScript is Script {
    Evaluation public evaluation;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        evaluation = new Evaluation();

        vm.stopBroadcast();
    }
}
