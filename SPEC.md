# Stock Fair: contract spec

How the deployed contract behaves. Source: [contracts/src/StockFair.sol](contracts/src/StockFair.sol).

**One line:** $WIF holders burn $WIF to pick the stock token that will gain most over a round. Voters on the winner split 80% of a USDG pot funded before voting opened; 20% rolls into the next round.

## Chain and addresses (Robinhood Chain mainnet, id 4663)
| Name | Address | Decimals |
|---|---|---|
| WIF | `0x5173b8eA6923c2d40267890D45C46a3480954773` | 18 |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | **6** |
| Burn address | `0x000000000000000000000000000000000000dEaD` | |

| Asset | Stock token | Chainlink proxy (8 dec) |
|---|---|---|
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | `0x319724394D3A0e3669269846abE664Cd621f9f6A` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | `0x4A1166a659A55625345e9515b32adECea5547C38` |

**Feed facts (checked 26 Oct):**
- Feeds are 24/5, with a 0.5% deviation trigger and a 24h heartbeat, so updates are sparse.
- Phase 1 round ids are around 2^64 + n. Past rounds are readable.
- The price already includes the token's `uiMultiplier()`. Don't apply it again.
- The token's `oraclePaused()` freezes the feed around corporate actions.

## Round lifecycle
1. `createRound(assets[], lockAt, endAt, pot)`
   - Anyone can call it. The caller is the round's **sponsor** and transfers `pot > 0` USDG in.
   - The stored round pot is this sponsor deposit plus the whole current `carry`. The round stores that carry as `carriedIn`, then resets `carry` to zero. A positive sponsor deposit is required even when carry is available.
   - Takes 2–4 distinct asset tokens, each matching a constructor-configured allowed `(token, feed)` pair exposed by `allowedAssets()`. Requires `now < lockAt < endAt`.
2. `vote(roundId, assetIndex, wifAmount)`
   - Only before `lockAt`.
   - Transfers `wifAmount` of WIF from the voter **straight to the burn address**. The contract never holds WIF.
   - Adds the amount to the voter's weight on that asset and to the asset's total.
   - A voter can vote many times and on several assets.
3. `settle(roundId, startRoundIds[], endRoundIds[])`
   - Anyone can call it once `now > endAt`.
   - For each asset and each boundary time `t` (`lockAt` for the start, `endAt` for the end), the caller passes the Chainlink round that was current at `t`. The contract checks:
     - `updatedAt(r) <= t`
     - either the next round's `updatedAt > t`, or, when `getRoundData(r+1)` reverts or returns `updatedAt == 0`, `r` equals the feed's current `latestRoundData()` round id
     - `t - updatedAt(r) <= MAX_STALE` (3 days)
   - Return = `end / start - 1`, in fixed point. The winner set is the asset(s) with the highest return. Ties share.
   - If total weight on the winning assets is positive, `rolled = pot × ROLLOVER_BPS / 10000` goes into `carry`, with `ROLLOVER_BPS = 2000` (20%). The round stores `payoutBase = pot - rolled` for claims. Integer division rounds down.
   - If nobody backed a winning asset, the whole pot goes into `carry`, `payoutBase` is zero, and the sponsor cannot refund it. Both cases emit `RolledOver(roundId, rolled)`.
   - Reverts with `OraclePaused()` if any asset token's `oraclePaused()` is true at settle time, allowing retries; **void** if any proof fails the staleness bound or if nobody settles within `SETTLE_WINDOW` (7 days) after `endAt` (`voidExpired` is callable by anyone).
4. `claim(roundId)`
   - Payout = `payoutBase × (voter's weight on winning assets) / (total weight on winning assets)`.
   - One claim per voter. Leftover dust stays in the contract.
5. **Refunds:** only if a round is void (stale proof or `voidExpired`), the sponsor calls `refund(roundId)` and receives only their deposit (`pot - carriedIn`); `carriedIn` returns to `carry`, emitting `RolledOver(roundId, carriedIn)` if nonzero. **Burned WIF is never returned.** The UI must say this before every vote.

Carry left after the last round stays in the contract until someone opens another round.

## Views the UI needs
- `rounds(id)`: assets, lockAt, endAt, pot, sponsor, state (Open / Locked / Settled / Void), startPrices, endPrices, winnerMask, refunded, carriedIn, payoutBase. The sponsor deposit is `pot - carriedIn`; `payoutBase` is set at settlement.
- `carry()`: USDG waiting for the next round; `ROLLOVER_BPS()`: 2000 (20%).
- `assetTotals(id)` and `userWeights(id, user)`, plus `claimable(id, user)`.
- Events: `RoundCreated` (pot includes carry), `Voted(roundId, voter, assetIndex, amount)`, `Settled(roundId, startPrices, endPrices, winnerMask)`, `RolledOver(roundId, amount)`, `Voided`, `Claimed`, `Refunded`. The UI builds its leaderboard and history from these, so there's no backend.

## Out of scope for v1
- Fee or USDG→WIF buyback. Add it once a WIF/USDG route has real depth.
- Admin keys, upgradeability and pausing. The contract is immutable.
- Rounds that span a weekend. Run daily rounds Monday to Friday.

## Tests and deployment
- Fork tests against mainnet (anvil `--fork-url https://rpc.mainnet.chain.robinhood.com`) cover:
  - a full round: create → votes (WIF actually lands at the burn address) → warp → settle with real round ids → claims add up to 80% of the pot, with 20% carried into the next round
  - a round with no weight on the winner carries its whole pot into the next round and cannot be refunded
  - a void round, followed by a refund of the sponsor's deposit, with any carry returned to the next pot
  - a bad round-id proof, which must revert
- Deployed on mainnet at [`0x16e7f897c6ee9394fbf08716515c66e8b6f85937`](https://robinhoodchain.blockscout.com/address/0x16e7f897c6ee9394fbf08716515c66e8b6f85937) in block 101,105,934, with the source [verified on Sourcify](https://repo.sourcify.dev/4663/0x16E7F897C6eE9394Fbf08716515c66e8b6f85937) (exact match).
