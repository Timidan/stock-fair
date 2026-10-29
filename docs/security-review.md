# Security review of StockFair.sol (26 Oct)

This review covers the first version of the contract, so its line links point at commit [4cea97c](https://github.com/Timidan/stock-fair/tree/4cea97c56496b7438e487596265a59c3add1ad70). The triage at the end lists what was fixed.

## Summary

A security review of the immutable [`StockFair.sol`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol) contract was conducted against the specifications in [`SPEC.md`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/SPEC.md) and live state on Robinhood Chain mainnet (chain ID 4663). While core mechanics such as non-reentrant state transitions, direct WIF burns to `0x...dEaD`, and absence of double-spend paths between `claim()` and `refund()` are soundly implemented, two high-severity and two medium-severity vulnerabilities exist. Most critically, `_priceAt()` relies on a naive `roundId + 1` successor check that breaks across Chainlink proxy phase upgrades, enabling any caller to permanently void any round or inject stale prices once an aggregator upgrade occurs. Additionally, `fund()` allows third-party funding that is unconditionally surrendered to `r.sponsor` upon refund, and checking the mutable `oraclePaused()` flag at settlement time exposes rounds to griefing and freeze attacks.

---

## Findings

### Severity Summary
- **Critical**: None (at the current deployment state; Finding 1 escalates to Critical once any Chainlink feed undergoes a proxy phase upgrade).
- **High**: 2 findings (Finding 1, Finding 2).
- **Medium**: 2 findings (Finding 3, Finding 4).
- **Low**: 3 findings (Finding 5, Finding 6, Finding 7).

---

### 1. Phase-Unaware Successor Check Enables Permanent Round Voiding (DoS) and Stale Price Injection

- **Severity**: High (Escalates to Critical post-feed upgrade)
- **Exact Line**: [`contracts/src/StockFair.sol:241-245`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L241-L245) (in `_priceAt`), invoked at [`contracts/src/StockFair.sol:139-140`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L139-L140) (in `settle`)
- **Primary Evidence**:
  - `StockFair.sol` lines 241–245:
    ```solidity
    try AggregatorV3(feed).getRoundData(roundId + 1) returns (
        uint80, int256, uint256, uint256 nextUpdatedAt, uint80
    ) {
        if (nextUpdatedAt != 0 && nextUpdatedAt <= timestamp) revert BadProof();
    } catch {}
    ```
  - Direct onchain inspection on Robinhood Chain mainnet:
    ```bash
    cast call 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 "phaseId()(uint16)" --rpc-url https://rpc.mainnet.chain.robinhood.com
    # Output: 1
    ```
    All 4 configured feeds (AAPL, NVDA, TSLA, SPY) currently report `phaseId = 1`.
  - Calling an unpopulated phase on the AAPL proxy reverts:
    ```bash
    cast call 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 "getRoundData(uint80)" 36893488147419103233 --rpc-url https://rpc.mainnet.chain.robinhood.com
    # Output: execution reverted, data: "0x"
    ```
- **Concrete Exploit Scenario**:
  Chainlink `EACAggregatorProxy` round IDs are 80-bit integers encoded as `(phaseId << 64) | aggregatorRoundId`.
  Because `StockFair` is immutable, when Robinhood Chain or Chainlink upgrades an aggregator:
  1. The proxy increments `phaseId` to 2. Future updates are written under `(2 << 64) | 1`, `(2 << 64) | 2`, etc.
  2. Phase 1 concluded at round $N$, with ID `(1 << 64) | N`.
  3. When anyone calls `getRoundData((1 << 64) | (N + 1))`, the proxy forwards the call to the Phase 1 aggregator, which reverts because round $N + 1$ was never created.
  4. In `StockFair.sol`, `try ... catch {}` swallows this revert, leaving `nextUpdatedAt = 0`. Line 244 (`nextUpdatedAt != 0 && nextUpdatedAt <= timestamp`) does not trigger.
  5. Line 246 evaluates `timestamp - updatedAt > MAX_STALE`. Since Phase 1 ended in the past (> 3 days ago), `staleStart` (or `staleEnd`) returns `true`.
  6. Line 141 sets `invalid = true`, lines 152–156 mark `r.state = State.Void`, and settlement permanently aborts.
  7. **Impact**: Any user (e.g. a sponsor seeking a pot refund or a voter backing a losing asset) can call `settle()` using `(1 << 64) | N` as a start or end proof to permanently void *any* subsequent round at zero cost. Legitimate voters who burned WIF lose everything.
  8. **Price Manipulation Sub-variant**: If an upgrade happened less than 3 days ago, `timestamp - updatedAt <= MAX_STALE` is true, so `(1 << 64) | N` is accepted as a valid "current" round. A settler can choose between the retired Phase 1 price and the active Phase 2 price, picking whichever favors their preferred token.
- **Minimal Fix**:
  A missing successor round (`nextUpdatedAt == 0` or revert) is only valid if `roundId` is the latest round on the entire feed. Query `latestRoundData()` and revert `BadProof()` if `nextUpdatedAt == 0` and `roundId != latestRoundId`:
  ```solidity
  (uint80 latestRoundId,,,,) = AggregatorV3(feed).latestRoundData();
  try AggregatorV3(feed).getRoundData(roundId + 1) returns (
      uint80, int256, uint256, uint256 nextUpdatedAt, uint80
  ) {
      if (nextUpdatedAt != 0 && nextUpdatedAt <= timestamp) revert BadProof();
  } catch {
      if (roundId != latestRoundId) revert BadProof();
  }
  if (nextUpdatedAt == 0 && roundId != latestRoundId) revert BadProof();
  ```

---

### 2. Sponsor Pot Hijacking / Third-Party Funder Loss on Refund

- **Severity**: High
- **Exact Line**: [`contracts/src/StockFair.sol:180-192`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L180-L192) (`refund`), interacting with [`contracts/src/StockFair.sol:109-115`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L109-L115) (`fund`)
- **Primary Evidence**:
  - `StockFair.sol:112`: `r.pot += amount;` accepts USDG from arbitrary callers without recording individual contributions.
  - `StockFair.sol:184-190`:
    ```solidity
    if (
        msg.sender != r.sponsor || r.refunded
            || !(r.state == State.Void || (r.state == State.Settled && total == 0))
    ) {
        revert NotRefundable();
    }
    r.refunded = true;
    if (!USDG.transfer(msg.sender, r.pot)) revert TransferFailed();
    ```
- **Concrete Exploit Scenario**:
  1. Attacker creates a round via `createRound(assets, now + 1 hours, now + 2 hours, 1)` with `pot = 1` (1 micro-USDG).
  2. A third-party partner or community member deposits 10,000 USDG via `fund(id, 10_000e6)`.
  3. The pot is now 10,000.000001 USDG.
  4. If the round ends and nobody voted on the winning token (or no votes were cast), `total == 0`. Alternatively, if the round expires after 7 days without settlement, `voidExpired(id)` sets `State.Void`.
  5. The attacker calls `refund(id)`.
  6. Line 190 transfers `r.pot` (all 10,000.000001 USDG) directly to `msg.sender` (`r.sponsor`).
  7. **Impact**: The attacker extracts 10,000 USDG of third-party capital for a 1 micro-USDG initial expense. The funder has no recourse.
- **Minimal Fix**:
  Either restrict `fund()` to `r.sponsor`:
  ```solidity
  if (msg.sender != r.sponsor) revert NotRefundable();
  ```
  Or track contributions per funder (`mapping(uint256 => mapping(address => uint256)) private _funded;`) and disburse refunds pro-rata to depositors.

---

### 3. Settle Timing Griefing via Transient `oraclePaused()` Check

- **Severity**: Medium
- **Exact Line**: [`contracts/src/StockFair.sol:141`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L141), [`contracts/src/StockFair.sol:152-156`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L152-L156)
- **Primary Evidence**:
  - `StockFair.sol:141`:
    ```solidity
    if (IStockToken(r.assets[i].token).oraclePaused() || staleStart || staleEnd) invalid = true;
    ```
  - `StockFair.sol:130`: Settlement is permitted anytime within `block.timestamp <= r.endAt + SETTLE_WINDOW` (a 7-day window).
  - Calling `oraclePaused()` on AAPL token (`0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`) on mainnet confirms it is an unparameterized live state check:
    ```bash
    cast call 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 "oraclePaused()(bool)" --rpc-url https://rpc.mainnet.chain.robinhood.com
    # Output: false
    ```
- **Concrete Exploit Scenario**:
  `IStockToken.oraclePaused()` evaluates the stock token's live status at the moment `settle()` is mined, not historically at `lockAt` or `endAt`.
  Suppose a round concludes on Friday at 20:00 UTC with all oracles active. TSLA gained +5% and Alice backed TSLA with 10,000 WIF; Bob backed SPY and lost.
  On Monday, Robinhood temporarily pauses TSLA's oracle for 30 minutes to process an off-market corporate action or maintenance.
  Bob (or the sponsor) notices `oraclePaused() == true` and immediately invokes `settle()`.
  Line 141 sets `invalid = true`, lines 152–156 transition `r.state` permanently to `State.Void`, and the function terminates.
  **Impact**: The round cannot be settled once unpaused. Alice's burned WIF is destroyed with zero payout, and the sponsor reclaims the pot via `refund()`, despite the round being completely valid at its conclusion.
- **Minimal Fix**:
  If `oraclePaused()` is true at settlement time, revert rather than permanently voiding the round:
  ```solidity
  if (IStockToken(r.assets[i].token).oraclePaused()) revert OraclePaused();
  ```
  This allows settlement once the pause lifts. If the pause persists for the full 7 days, `voidExpired()` remains available to void the round.

---

### 4. Unhandled Revert in `IStockToken.oraclePaused()` Freezes Settlement

- **Severity**: Medium
- **Exact Line**: [`contracts/src/StockFair.sol:141`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L141)
- **Primary Evidence**:
  - `StockFair.sol:141`:
    `if (IStockToken(r.assets[i].token).oraclePaused() || staleStart || staleEnd) invalid = true;`
  - The call is an unprotected high-level external call.
- **Concrete Exploit Scenario**:
  Robinhood stock tokens are upgradeable ERC-1967 proxies (e.g. AAPL implementation slot `0x3608...` points to `0x68184c449e1a8f34fa18d289737129fd27b66f8f`). If an implementation upgrade reverts on `oraclePaused()` or alters the interface, `settle()` will revert unconditionally on line 141.
  **Impact**: Settle becomes completely uncallable. The round cannot be settled or marked `Void` via normal execution. All funds remain locked until the 7-day `SETTLE_WINDOW` expires, after which callers must invoke `voidExpired(id)`.
- **Minimal Fix**:
  Wrap the call in `try ... catch`:
  ```solidity
  bool paused;
  try IStockToken(r.assets[i].token).oraclePaused() returns (bool p) {
      paused = p;
  } catch {
      invalid = true;
  }
  if (paused || staleStart || staleEnd) invalid = true;
  ```

---

### 5. `createRound` Allows Duplicate Assets, Distorting Winning Weights

- **Severity**: Low
- **Exact Line**: [`contracts/src/StockFair.sol:92-104`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L92-L104)
- **Primary Evidence**:
  - `StockFair.sol:92-104`:
    ```solidity
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
    ```
- **Concrete Exploit Scenario**:
  `createRound` validates that each asset is present in `_allowedAssets`, but never checks that `assets[i]` elements are pairwise distinct. A sponsor can submit `assets = [AAPL, AAPL]`.
  If AAPL wins, both slots produce identical `gain` and tie (`winnerMask = (1 << 0) | (1 << 1) = 3`).
  Voters voting on index 0 and index 1 are separated into distinct buckets. If a sponsor lists `[AAPL, NVDA, AAPL]`, AAPL voters are fractured into two pools, distorting UI representations and leaderboard calculations.
- **Minimal Fix**:
  Enforce uniqueness in `createRound`:
  ```solidity
  for (uint256 j; j < i; ++j) {
      if (assets[i].token == assets[j].token) revert InvalidAssets();
  }
  ```

---

### 6. Zero `pot` Allowed in `createRound`, Enabling Honey-Pot Rounds

- **Severity**: Low
- **Exact Line**: [`contracts/src/StockFair.sol:79-107`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L79-L107)
- **Primary Evidence**:
  - `createRound` has no check `if (pot == 0) revert ...`.
  - `USDG.transferFrom(msg.sender, address(this), 0)` succeeds without transferring tokens.
- **Concrete Exploit Scenario**:
  A creator calls `createRound(assets, lockAt, endAt, 0)`. Unwary users vote with WIF, transferring and burning real tokens at `0x...dEaD`.
  Upon settlement, `claimable()` calculates `r.pot * weight / total = 0 * weight / total = 0`. Any `claim()` call reverts with `NothingToClaim()`.
  Voters permanently lose burned WIF for a round where payouts are mathematically impossible.
- **Minimal Fix**:
  Require `if (pot == 0) revert InvalidAssets();` (or a dedicated `ZeroPot()` error).

---

### 7. Zero / Negative Price Reverts `settle()` Rather Than Marking Proof Invalid

- **Severity**: Low
- **Exact Line**: [`contracts/src/StockFair.sol:240`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L240)
- **Primary Evidence**:
  - `StockFair.sol:240`:
    `if (returnedId != roundId || answer <= 0 || updatedAt == 0 || updatedAt > timestamp) revert BadProof();`
- **Concrete Exploit Scenario**:
  If a stock experiences an extreme crash or bankruptcy and the oracle reports `answer <= 0`, `_priceAt()` reverts with `BadProof()`.
  Because `settle()` iterates through all assets and requires all to succeed, a single bankrupt token causes `settle()` to revert on every invocation.
  Voters who backed other, legitimately performing stocks cannot claim their winnings. The round is bricked until `voidExpired()` can be executed after 7 days.
- **Minimal Fix**:
  Flag `answer <= 0` as `invalid = true` (or treat as void/stale condition) rather than reverting the settlement transaction:
  ```solidity
  if (returnedId != roundId || updatedAt == 0 || updatedAt > timestamp) revert BadProof();
  if (answer <= 0) return (0, true);
  ```

---

## Details

### Comprehensive Mechanism Audit

| Category | Finding / Analysis | Status | Primary Reference |
|---|---|---|---|
| **Phase Changes** | `roundId + 1` across aggregator upgrades reverts, causing silent acceptance of obsolete rounds and forced voiding | **Vulnerable (High)** | [`StockFair.sol:241-245`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L241-L245) |
| **Sponsor Abuse** | Third-party funding via `fund()` is transferred to `r.sponsor` upon refund | **Vulnerable (High)** | [`StockFair.sol:180-192`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L180-L192) |
| **Token `oraclePaused()`** | Evaluated at settlement block rather than boundary; timing attacks allow deliberate voids | **Vulnerable (Medium)** | [`StockFair.sol:141`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L141) |
| **External Call Safety** | Unprotected `oraclePaused()` call bubbles up token reverts | **Vulnerable (Medium)** | [`StockFair.sol:141`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L141) |
| **Asset Validation** | Duplicate assets permitted in `createRound()` | **Vulnerable (Low)** | [`StockFair.sol:92-104`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L92-L104) |
| **Zero Pot Honey-pot** | `pot == 0` allowed, burning voter WIF with no reward | **Vulnerable (Low)** | [`StockFair.sol:79-107`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L79-L107) |
| **Negative Price Handling** | `answer <= 0` reverts `settle()`, freezing round for 7 days | **Vulnerable (Low)** | [`StockFair.sol:240`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L240) |
| **Claim/Refund Double-Spend** | Mutually exclusive states and check-before-transfer prevent double-spend | **Safe** | [`StockFair.sol:175`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L175), [`StockFair.sol:189`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L189) |
| **Reentrancy** | All external state-changing functions use `nonReentrant` modifier | **Safe** | [`StockFair.sol:72-77`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L72-L77) |
| **Ties & Zero-Vote Winners** | Correctly pools weights and totals across `winnerMask`; allows refund when total is 0 | **Safe** | [`StockFair.sol:228-236`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L228-L236) |
| **Rounding & Dust** | Integer division truncates down; dust stays in contract; strictly solvent | **Safe** | [`StockFair.sol:220`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L220) |
| **Integer Overflows** | Cancun EVM / 0.8.24 checked arithmetic; `gain` operates in `int256` | **Safe** | [`StockFair.sol:144`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L144) |
| **Events** | All 7 events specified in SPEC are emitted with correct indexed topics | **Safe** | [`StockFair.sol:56-64`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/contracts/src/StockFair.sol#L56-L64) |

---

### Detailed Analysis of Safe Mechanisms

#### 1. Claim / Refund Double-Spend Protection
- In `claim(uint256 id)`:
  - Line 173 checks `amount = claimable(id, msg.sender)`.
  - Line 218 ensures `claimable()` returns 0 if `r.state != State.Settled || claimed[id][user] || r.refunded`.
  - Line 175 sets `claimed[id][msg.sender] = true` *before* the external `USDG.transfer()` call.
- In `refund(uint256 id)`:
  - Line 184 checks `r.refunded == false` and requires `(r.state == State.Void || (r.state == State.Settled && total == 0))`.
  - If `r.state == State.Settled && total == 0`, no winning votes exist, meaning `claimable()` returns 0 for every address; no claims could have been executed or can ever be executed.
  - Line 189 sets `r.refunded = true` *before* `USDG.transfer()`.
  - Therefore, `claim()` and `refund()` are strictly mutually exclusive.

#### 2. Reentrancy Protection
- The contract maintains a storage slot `_entered = 1`.
- Every external state-changing method (`createRound`, `fund`, `vote`, `settle`, `voidExpired`, `claim`, `refund`) applies `nonReentrant`.
- In addition, state mutations strictly precede external calls (`USDG.transfer`, `USDG.transferFrom`, `WIF.transferFrom`).

#### 3. Ties, Pro-Rata Distribution, and Winner with Zero Votes
- **Ties**: Lines 145–150 build `winnerMask` bitwise (`mask |= 1 << i` when `gain == best`). Lines 228–236 sum the caller's weights and the round's totals across all assets enabled in `winnerMask`:
  $$\text{Payout} = \text{pot} \times \frac{\sum_{w \in \text{Winners}} \text{userWeight}_w}{\sum_{w \in \text{Winners}} \text{totalWeight}_w}$$
  This strictly preserves pro-rata distribution across all tied assets.
- **Zero Votes on Winner**: If the winning asset received no votes, `total == 0`. In `claimable()`, `total == 0 ? 0 : ...` returns 0. In `refund()`, condition `r.state == State.Settled && total == 0` evaluates to true, permitting the sponsor to reclaim the pot.
- **Partial Tie with Zero Votes**: If Token A and Token B tie, and Token A has 10 WIF in votes while Token B has 0, `total = 10 + 0 = 10 > 0`. Sponsor refund is correctly blocked, and Token A voters receive 100% of the pot.

#### 4. Rounding, Dust, and Contract Solvency
- Let $w_i$ be voter $i$'s weight and $T = \sum w_i$ be the total winning weight.
- Payout to voter $i$ is $\lfloor \frac{\text{pot} \times w_i}{T} \rfloor$.
- By properties of integer division:
  $$\sum_{i=1}^M \lfloor \frac{\text{pot} \times w_i}{T} \rfloor \le \text{pot}$$
- The contract never pays out more USDG than was transferred in. Leftover dust ($\le M-1$ micro-USDG) remains unclaimable in the contract, exactly as permitted by [`SPEC.md:47`](https://github.com/Timidan/stock-fair/blob/4cea97c56496b7438e487596265a59c3add1ad70/SPEC.md#L47).

#### 5. Return Calculation and Negative Returns
- `int256 gain = end * 1e18 / start - 1e18;` (line 144).
- Prices on these feeds have 8 decimals (e.g. $300.00 is $300 \times 10^8 = 3 \times 10^{10}$).
- Multiplication $end \times 10^{18} \approx 3 \times 10^{28}$, which is far below `type(int256).max` ($\approx 5.7 \times 10^{76}$). Overflow is impossible under any realistic asset valuation.
- If all assets decline during the round ($end < start$), $end \times 10^{18} / start < 10^{18}$, yielding a negative `gain`. Because `best` is initialized to `type(int256).min`, the asset with the least negative return is correctly selected as the winner.

---

## Unverified / open questions

1. **Chainlink Proxy Phase Upgrade Schedule**:
   - *Status*: Unverified.
   - *Detail*: All four mainnet feeds are currently in Phase 1 (`phaseId == 1`). Whether Robinhood or Chainlink plans to upgrade feed aggregators before or during the hackathon judging period is unknown.
   - *Verification method*: Monitor `phaseId()` on the 4 feed proxies (`0x6B22...`, `0x3197...`, `0x379E...`, `0x4A11...`).
2. **Frequency of `oraclePaused()` Assertions by Robinhood**:
   - *Status*: Unverified.
   - *Detail*: While `oraclePaused()` currently returns `false` on all allowlisted stock tokens, the frequency and duration of corporate action pauses on Robinhood Chain could not be confirmed without off-chain Robinhood operational data.
   - *Verification method*: Review historical event logs or historical state diffs of the Robinhood stock token contracts during market closed hours.
3. **Robinhood Public RPC Pruning Behavior**:
   - *Status*: Observed limitation.
   - *Detail*: The public endpoint `https://rpc.mainnet.chain.robinhood.com` pruned block `98,482,863` state within hours of commit, causing historical fork tests in `StockFair.t.sol` to fail with error `-32000: historical state ... is not available`.
   - *Verification method*: Run tests against an archival node or a fresh local fork pinned to the latest head block (`98,538,738+`).


## Lead triage (26 Oct)
Accepted and fixed: 1 (phase-aware successor), 2 (remove fund), 3 (pause reverts instead of voiding), 5 (no duplicate assets), 6 (no zero pot). Declined: 4 (covered by 3 plus the 7-day voidExpired backstop) and 7 (stock prices cannot be zero or below).
