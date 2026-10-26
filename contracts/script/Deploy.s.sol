// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {StockFair} from "../src/StockFair.sol";
import {Assets} from "./Assets.sol";

contract Deploy is Script {
    function run() external returns (StockFair deployed) {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        deployed = new StockFair(Assets.all());
        vm.stopBroadcast();
    }
}
