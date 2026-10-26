// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3} from "../../src/Interfaces.sol";

// Local demo only: anyone can append arbitrary prices and timestamps.
contract ReplayFeed is AggregatorV3 {
    uint64 private _count;

    struct Round {
        int256 answer;
        uint256 updatedAt;
    }
    mapping(uint80 => Round) private _rounds;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function push(int256 answer, uint256 updatedAt) external {
        uint80 id = uint80(1 << 64) + ++_count;
        _rounds[id] = Round(answer, updatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(uint80(1 << 64) + _count);
    }

    function getRoundData(uint80 id) public view returns (uint80, int256, uint256, uint256, uint80) {
        if (id <= uint80(1 << 64) || id > uint80(1 << 64) + _count) return (0, 0, 0, 0, 0);
        Round memory r = _rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}
