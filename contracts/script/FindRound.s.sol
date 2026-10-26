// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AggregatorV3} from "../src/Interfaces.sol";

contract FindRound is Script {
    function run(address feed, uint256 timestamp) external view returns (uint80 roundId) {
        roundId = find(feed, timestamp);
        console2.log("roundId", uint256(roundId));
    }

    function find(address feed, uint256 timestamp) public view returns (uint80 roundId) {
        require(timestamp <= block.timestamp, "Future boundary");
        (roundId,,,,) = AggregatorV3(feed).latestRoundData();
        while (true) {
            (uint80 id, int256 price,, uint256 updatedAt,) = AggregatorV3(feed).getRoundData(roundId);
            require(id == roundId && price > 0 && updatedAt != 0, "Missing round");
            if (updatedAt <= timestamp) return roundId;
            // shortcut: current phase only, add phase traversal if a boundary predates a proxy upgrade.
            require(uint64(roundId) > 1, "Boundary predates current phase");
            --roundId;
        }
    }
}
