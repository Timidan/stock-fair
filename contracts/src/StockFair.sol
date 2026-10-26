// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, AggregatorV3, IStockToken} from "./Interfaces.sol";

contract StockFair {
    IERC20 public constant WIF = IERC20(0x5173b8eA6923c2d40267890D45C46a3480954773);
    IERC20 public constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_STALE = 3 days;
    uint256 public constant SETTLE_WINDOW = 7 days;

    enum State {
        Open,
        Locked,
        Settled,
        Void
    }

    struct Asset {
        address token;
        address feed;
    }

    struct Round {
        Asset[] assets;
        uint256 lockAt;
        uint256 endAt;
        uint256 pot;
        address sponsor;
        State state;
        int256[] startPrices;
        int256[] endPrices;
        uint256 winnerMask;
        bool refunded;
    }

    uint256 public roundCount;
    Asset[] private _allowedAssets;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => uint256[]) private _totals;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) private _weights;
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 private _entered = 1;

    error InvalidRound();
    error InvalidAssets();
    error WrongTime();
    error WrongState();
    error BadProof();
    error TransferFailed();
    error Reentrant();
    error NothingToClaim();
    error NotRefundable();

    event RoundCreated(
        uint256 indexed roundId, address indexed sponsor, Asset[] assets, uint256 lockAt, uint256 endAt, uint256 pot
    );
    event Funded(uint256 indexed roundId, address indexed funder, uint256 amount);
    event Voted(uint256 indexed roundId, address indexed voter, uint256 assetIndex, uint256 amount);
    event Settled(uint256 indexed roundId, int256[] startPrices, int256[] endPrices, uint256 winnerMask);
    event Voided(uint256 indexed roundId);
    event Claimed(uint256 indexed roundId, address indexed voter, uint256 amount);
    event Refunded(uint256 indexed roundId, address indexed sponsor, uint256 amount);

    constructor(Asset[] memory assets) {
        for (uint256 i; i < assets.length; ++i) {
            _allowedAssets.push(assets[i]);
        }
    }

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrant();
        _entered = 2;
        _;
        _entered = 1;
    }

    function createRound(Asset[] calldata assets, uint256 lockAt, uint256 endAt, uint256 pot)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (assets.length < 2 || assets.length > 4) revert InvalidAssets();
        if (block.timestamp >= lockAt || lockAt >= endAt) revert WrongTime();
        id = ++roundCount;
        Round storage r = _rounds[id];
        r.lockAt = lockAt;
        r.endAt = endAt;
        r.pot = pot;
        r.sponsor = msg.sender;
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].token.code.length == 0 || assets[i].feed.code.length == 0) revert InvalidAssets();
            bool allowed;
            for (uint256 j; j < _allowedAssets.length; ++j) {
                if (assets[i].token == _allowedAssets[j].token && assets[i].feed == _allowedAssets[j].feed) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) revert InvalidAssets();
            r.assets.push(assets[i]);
            _totals[id].push(0);
        }
        if (!USDG.transferFrom(msg.sender, address(this), pot)) revert TransferFailed();
        emit RoundCreated(id, msg.sender, assets, lockAt, endAt, pot);
    }

    function fund(uint256 id, uint256 amount) external nonReentrant {
        Round storage r = _round(id);
        if (block.timestamp >= r.lockAt) revert WrongTime();
        r.pot += amount;
        if (!USDG.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Funded(id, msg.sender, amount);
    }

    function vote(uint256 id, uint256 assetIndex, uint256 wifAmount) external nonReentrant {
        Round storage r = _round(id);
        if (block.timestamp >= r.lockAt) revert WrongTime();
        if (assetIndex >= r.assets.length) revert InvalidAssets();
        _weights[id][msg.sender][assetIndex] += wifAmount;
        _totals[id][assetIndex] += wifAmount;
        if (!WIF.transferFrom(msg.sender, BURN, wifAmount)) revert TransferFailed();
        emit Voted(id, msg.sender, assetIndex, wifAmount);
    }

    function settle(uint256 id, uint80[] calldata startRoundIds, uint80[] calldata endRoundIds) external nonReentrant {
        Round storage r = _round(id);
        if (r.state != State.Open) revert WrongState();
        if (block.timestamp <= r.endAt || block.timestamp > r.endAt + SETTLE_WINDOW) revert WrongTime();
        uint256 n = r.assets.length;
        if (startRoundIds.length != n || endRoundIds.length != n) revert BadProof();
        int256[] memory starts = new int256[](n);
        int256[] memory ends = new int256[](n);
        bool invalid;
        int256 best = type(int256).min;
        uint256 mask;
        for (uint256 i; i < n; ++i) {
            (int256 start, bool staleStart) = _priceAt(r.assets[i].feed, startRoundIds[i], r.lockAt);
            (int256 end, bool staleEnd) = _priceAt(r.assets[i].feed, endRoundIds[i], r.endAt);
            if (IStockToken(r.assets[i].token).oraclePaused() || staleStart || staleEnd) invalid = true;
            starts[i] = start;
            ends[i] = end;
            int256 gain = end * 1e18 / start - 1e18;
            if (gain > best) {
                best = gain;
                mask = 1 << i;
            } else if (gain == best) {
                mask |= 1 << i;
            }
        }
        if (invalid) {
            r.state = State.Void;
            emit Voided(id);
            return;
        }
        r.state = State.Settled;
        r.startPrices = starts;
        r.endPrices = ends;
        r.winnerMask = mask;
        emit Settled(id, starts, ends, mask);
    }

    function voidExpired(uint256 id) external nonReentrant {
        Round storage r = _round(id);
        if (r.state != State.Open) revert WrongState();
        if (block.timestamp <= r.endAt + SETTLE_WINDOW) revert WrongTime();
        r.state = State.Void;
        emit Voided(id);
    }

    function claim(uint256 id) external nonReentrant {
        uint256 amount = claimable(id, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[id][msg.sender] = true;
        if (!USDG.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(id, msg.sender, amount);
    }

    function refund(uint256 id) external nonReentrant {
        Round storage r = _round(id);
        (, uint256 total) = _winningWeights(id, msg.sender);
        if (
            msg.sender != r.sponsor || r.refunded
                || !(r.state == State.Void || (r.state == State.Settled && total == 0))
        ) {
            revert NotRefundable();
        }
        r.refunded = true;
        if (!USDG.transfer(msg.sender, r.pot)) revert TransferFailed();
        emit Refunded(id, msg.sender, r.pot);
    }

    function allowedAssets() public view returns (Asset[] memory) {
        return _allowedAssets;
    }

    function rounds(uint256 id) external view returns (Round memory r) {
        r = _round(id);
        if (r.state == State.Open && block.timestamp >= r.lockAt) r.state = State.Locked;
    }

    function assetTotals(uint256 id) external view returns (uint256[] memory) {
        _round(id);
        return _totals[id];
    }

    function userWeights(uint256 id, address user) external view returns (uint256[] memory weights) {
        uint256 n = _round(id).assets.length;
        weights = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            weights[i] = _weights[id][user][i];
        }
    }

    function claimable(uint256 id, address user) public view returns (uint256) {
        Round storage r = _round(id);
        if (r.state != State.Settled || claimed[id][user] || r.refunded) return 0;
        (uint256 weight, uint256 total) = _winningWeights(id, user);
        return total == 0 ? 0 : r.pot * weight / total;
    }

    function _round(uint256 id) private view returns (Round storage r) {
        if (id == 0 || id > roundCount) revert InvalidRound();
        return _rounds[id];
    }

    function _winningWeights(uint256 id, address user) private view returns (uint256 weight, uint256 total) {
        Round storage r = _rounds[id];
        for (uint256 i; i < r.assets.length; ++i) {
            if (r.winnerMask & (1 << i) != 0) {
                weight += _weights[id][user][i];
                total += _totals[id][i];
            }
        }
    }

    function _priceAt(address feed, uint80 roundId, uint256 timestamp) private view returns (int256 price, bool stale) {
        (uint80 returnedId, int256 answer,, uint256 updatedAt,) = AggregatorV3(feed).getRoundData(roundId);
        if (returnedId != roundId || answer <= 0 || updatedAt == 0 || updatedAt > timestamp) revert BadProof();
        try AggregatorV3(feed).getRoundData(roundId + 1) returns (
            uint80, int256, uint256, uint256 nextUpdatedAt, uint80
        ) {
            if (nextUpdatedAt != 0 && nextUpdatedAt <= timestamp) revert BadProof();
        } catch {}
        return (answer, timestamp - updatedAt > MAX_STALE);
    }
}
