// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StockFair} from "../src/StockFair.sol";
import {IERC20, AggregatorV3, IStockToken} from "../src/Interfaces.sol";
import {Assets} from "../script/Assets.sol";
import {FindRound} from "../script/FindRound.s.sol";
import {ReplayFeed} from "./mocks/ReplayFeed.sol";

contract StockFairTest is Test {
    uint256 constant LOCK = 1_792_764_000; // Friday 2026-10-23 14:00 UTC
    uint256 constant END = 1_792_785_600; // Friday 2026-10-23 20:00 UTC
    StockFair fair;
    StockFair.Asset[] assets;
    uint80[] starts;
    uint80[] ends;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.createSelectFork("robinhood");
        StockFair.Asset[] memory configured = Assets.all();
        fair = new StockFair(configured);
        FindRound finder = new FindRound();
        for (uint256 i; i < configured.length; ++i) {
            assets.push(configured[i]);
            starts.push(finder.find(assets[i].feed, LOCK));
            ends.push(finder.find(assets[i].feed, END));
        }
        deal(address(fair.USDG()), address(this), 120e6);
        fair.USDG().approve(address(fair), 120e6);
        vm.warp(LOCK - 1 hours);
    }

    function testFullRoundRollsOver() public {
        assertEq(abi.encode(fair.allowedAssets()), abi.encode(assets));
        uint256 id = fair.createRound(assets, LOCK, END, 120e6);
        IERC20 wif = fair.WIF();
        uint256 burnedBefore = wif.balanceOf(fair.BURN());
        deal(address(wif), alice, 12e18);
        deal(address(wif), bob, 4e18);
        vm.startPrank(alice);
        wif.approve(address(fair), 12e18);
        for (uint256 i; i < 4; ++i) {
            fair.vote(id, i, 1e18);
            fair.vote(id, i, 2e18);
        }
        vm.stopPrank();
        vm.startPrank(bob);
        wif.approve(address(fair), 4e18);
        for (uint256 i; i < 4; ++i) {
            fair.vote(id, i, 1e18);
        }
        vm.stopPrank();
        assertEq(wif.balanceOf(fair.BURN()) - burnedBefore, 16e18);
        assertEq(wif.balanceOf(address(fair)), 0);
        assertEq(fair.userWeights(id, alice)[0], 3e18);
        assertEq(fair.assetTotals(id)[0], 4e18);
        vm.warp(LOCK);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Locked));
        vm.warp(END + 1);
        vm.expectEmit(true, false, false, true);
        emit StockFair.RolledOver(id, 24e6);
        fair.settle(id, starts, ends);
        StockFair.Round memory r = fair.rounds(id);
        assertEq(uint256(r.state), uint256(StockFair.State.Settled));
        assertLt(r.endPrices[0], r.startPrices[0]); // AAPL fell during this historical window.
        assertEq(r.winnerMask, 4); // TSLA alone gained; AAPL, NVDA and SPY fell.
        assertEq(r.carriedIn, 0);
        assertEq(r.payoutBase, 96e6);
        assertEq(fair.carry(), 24e6);
        deal(address(fair.USDG()), address(this), 10e6);
        fair.USDG().approve(address(fair), 10e6);
        uint256 next = fair.createRound(assets, END + 1 hours, END + 2 hours, 10e6);
        assertEq(fair.rounds(next).pot, 34e6);
        assertEq(fair.rounds(next).carriedIn, 24e6);
        assertEq(fair.carry(), 0);
        assertEq(fair.claimable(id, alice), 72e6);
        assertEq(fair.claimable(id, bob), 24e6);
        uint256 beforeClaims = fair.USDG().balanceOf(alice) + fair.USDG().balanceOf(bob);
        vm.prank(alice);
        fair.claim(id);
        vm.prank(bob);
        fair.claim(id);
        assertEq(fair.USDG().balanceOf(alice) + fair.USDG().balanceOf(bob) - beforeClaims, 96e6);
        assertEq(fair.USDG().balanceOf(address(fair)), 34e6);
        vm.prank(alice);
        vm.expectRevert(StockFair.NothingToClaim.selector);
        fair.claim(id);
    }

    function testUnbackedWinnerRollsOver() public {
        uint256 id = fair.createRound(assets, LOCK, END, 100e6);
        deal(address(fair.WIF()), address(this), 1e18);
        fair.WIF().approve(address(fair), 1e18);
        fair.vote(id, 0, 1e18); // AAPL loses to TSLA.
        vm.warp(END + 1);
        vm.expectEmit(true, false, false, true);
        emit StockFair.RolledOver(id, 100e6);
        fair.settle(id, starts, ends);
        assertEq(fair.rounds(id).winnerMask, 4);
        assertEq(fair.rounds(id).payoutBase, 0);
        assertEq(fair.claimable(id, address(this)), 0);
        assertEq(fair.carry(), 100e6);
        vm.expectRevert(StockFair.NotRefundable.selector);
        fair.refund(id);
        vm.expectRevert(StockFair.InvalidRound.selector);
        fair.createRound(assets, END + 1 hours, END + 2 hours, 0);
        uint256 next = fair.createRound(assets, END + 1 hours, END + 2 hours, 20e6);
        assertEq(fair.rounds(next).pot, 120e6);
        assertEq(fair.rounds(next).carriedIn, 100e6);
        assertEq(fair.carry(), 0);
        vm.warp(END + 2 hours + fair.SETTLE_WINDOW() + 1);
        fair.voidExpired(next);
        vm.expectEmit(true, false, false, true);
        emit StockFair.RolledOver(next, 100e6);
        fair.refund(next);
        assertEq(fair.carry(), 100e6);
        assertEq(fair.USDG().balanceOf(address(this)), 20e6);
        assertEq(fair.USDG().balanceOf(address(fair)), 100e6);
    }

    function testVoidAndRefund() public {
        uint256 id = fair.createRound(assets, LOCK, END, 120e6);
        deal(address(fair.WIF()), address(this), 1e18);
        fair.WIF().approve(address(fair), 1e18);
        uint256 burnedBefore = fair.WIF().balanceOf(fair.BURN());
        fair.vote(id, 0, 1e18);
        vm.warp(END + fair.SETTLE_WINDOW() + 1);
        fair.voidExpired(id);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Void));
        fair.refund(id);
        assertEq(fair.USDG().balanceOf(address(this)), 120e6);
        assertEq(fair.USDG().balanceOf(address(fair)), 0);
        assertEq(fair.WIF().balanceOf(fair.BURN()) - burnedBefore, 1e18);
        vm.expectRevert(StockFair.NotRefundable.selector);
        fair.refund(id);
    }

    function testBadProofReverts() public {
        uint256 id = fair.createRound(assets, LOCK, END, 120e6);
        vm.warp(END + 1);
        --starts[0];
        vm.expectRevert(StockFair.BadProof.selector);
        fair.settle(id, starts, ends);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Locked));
    }

    function testRetiredPhaseWithoutSuccessorReverts() public {
        uint256 id = fair.createRound(assets, LOCK, END, 120e6);
        vm.warp(END + 1);
        address feed = assets[0].feed;
        bytes memory successor = abi.encodeCall(AggregatorV3.getRoundData, (starts[0] + 1));
        bytes memory latest = abi.encode(starts[0] + uint80(1 << 64), 0, 0, 0, 0);
        vm.mockCall(feed, abi.encodeCall(AggregatorV3.latestRoundData, ()), latest);
        vm.mockCallRevert(feed, successor, "No data");
        vm.expectRevert(StockFair.BadProof.selector);
        fair.settle(id, starts, ends);
        vm.clearMockedCalls();
        vm.mockCall(feed, abi.encodeCall(AggregatorV3.latestRoundData, ()), latest);
        vm.mockCall(feed, successor, abi.encode(0, 0, 0, 0, 0));
        vm.expectRevert(StockFair.BadProof.selector);
        fair.settle(id, starts, ends);
    }

    function testFundUnavailable() public {
        uint256 id = fair.createRound(assets, LOCK, END, 100e6);
        (bool success,) = address(fair).call(abi.encodeWithSignature("fund(uint256,uint256)", id, 20e6));
        assertFalse(success);
        assertEq(fair.rounds(id).pot, 100e6);
        assertEq(fair.USDG().balanceOf(address(this)), 20e6);
    }

    function testPausedOracleCanRetrySettlement() public {
        uint256 id = fair.createRound(assets, LOCK, END, 120e6);
        vm.warp(END + 1);
        vm.mockCall(assets[0].token, abi.encodeCall(IStockToken.oraclePaused, ()), abi.encode(true));
        vm.expectRevert(StockFair.OraclePaused.selector);
        fair.settle(id, starts, ends);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Locked));
        vm.clearMockedCalls();
        fair.settle(id, starts, ends);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Settled));
    }

    function testDuplicateAssetReverts() public {
        assets[1] = assets[0];
        vm.expectRevert(StockFair.InvalidAssets.selector);
        fair.createRound(assets, LOCK, END, 120e6);
    }

    function testZeroPotReverts() public {
        vm.expectRevert(StockFair.InvalidRound.selector);
        fair.createRound(assets, LOCK, END, 0);
    }

    function testSettleWithLatestEndRound() public {
        uint256 endAt = END;
        for (uint256 i; i < assets.length; ++i) {
            (uint80 latestId,,, uint256 updatedAt,) = AggregatorV3(assets[i].feed).latestRoundData();
            ends[i] = latestId;
            if (updatedAt > endAt) endAt = updatedAt;
            (,,, uint256 nextUpdatedAt,) = AggregatorV3(assets[i].feed).getRoundData(latestId + 1);
            assertEq(nextUpdatedAt, 0);
        }
        uint256 id = fair.createRound(assets, LOCK, endAt, 120e6);
        vm.warp(endAt + 1);
        fair.settle(id, starts, ends);
        assertEq(uint256(fair.rounds(id).state), uint256(StockFair.State.Settled));
    }

    function testUnlistedFeedReverts() public {
        assets[0].feed = address(new ReplayFeed());
        vm.expectRevert(StockFair.InvalidAssets.selector);
        fair.createRound(assets, LOCK, END, 120e6);
    }

    function testReplayFeedEtchedOverProxy() public {
        ReplayFeed feed = ReplayFeed(assets[0].feed);
        vm.etch(address(feed), type(ReplayFeed).runtimeCode);
        vm.store(address(feed), bytes32(0), bytes32(0)); // Etching preserves the proxy's storage.
        assertEq(feed.decimals(), 8);
        feed.push(100e8, LOCK);
        feed.push(101e8, END);
        uint80 first = uint80((1 << 64) + 1);
        (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();
        assertEq(
            abi.encode(id, answer, startedAt, updatedAt, answeredInRound),
            abi.encode(first + 1, int256(101e8), END, END, first + 1)
        );
        (id, answer, startedAt, updatedAt, answeredInRound) = feed.getRoundData(first);
        assertEq(
            abi.encode(id, answer, startedAt, updatedAt, answeredInRound),
            abi.encode(first, int256(100e8), LOCK, LOCK, first)
        );
        (id, answer, startedAt, updatedAt, answeredInRound) = feed.getRoundData(first + 2);
        assertEq(
            abi.encode(id, answer, startedAt, updatedAt, answeredInRound),
            abi.encode(uint80(0), int256(0), uint256(0), uint256(0), uint80(0))
        );
    }
}
