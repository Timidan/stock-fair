// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockFair} from "../src/StockFair.sol";

library Assets {
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    address internal constant SPY_FEED = 0x319724394D3A0e3669269846abE664Cd621f9f6A;
    address internal constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address internal constant TSLA_FEED = 0x4A1166a659A55625345e9515b32adECea5547C38;

    // Token addresses checked in api.robinhood.com/rhj/assets, chainId 4663, 2026-10-26.
    function all() internal pure returns (StockFair.Asset[] memory assets) {
        assets = new StockFair.Asset[](4);
        assets[0] = StockFair.Asset(AAPL, AAPL_FEED);
        assets[1] = StockFair.Asset(NVDA, NVDA_FEED);
        assets[2] = StockFair.Asset(TSLA, TSLA_FEED);
        assets[3] = StockFair.Asset(SPY, SPY_FEED);
    }
}
