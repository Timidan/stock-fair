# Stock Fair: contract spec

This is the shared contract between `contracts/` (owned by Astra) and `ui/` (owned by Claude). Change it only by agreement.

**One line:** $WIF holders burn $WIF to pick the stock token that will gain most over a round. Voters on the winner split a USDG pot that was funded before voting opened.

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
| NVDA | from Robinhood registry `api.robinhood.com/rhj/assets` | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| TSLA | from Robinhood registry | `0x4A1166a659A55625345e9515b32adECea5547C38` |

**Feed facts (checked 26 Oct):**
- Feeds are 24/5, with a 0.5% deviation trigger and a 24h heartbeat, so updates are sparse.
- Phase 1 round ids are around 2^64 + n. Past rounds are readable.
- The price already includes the token's `uiMultiplier()`. Don't apply it again.
- The token's `oraclePaused()` freezes the feed around corporate actions.

## Round lifecycle
1. `createRound(assets[], lockAt, endAt, pot)`
   - Anyone can call it. The caller is the round's **sponsor** and transfers `pot` USDG in.
   - Takes 2–4 assets, each matching a constructor-configured allowed `(token, feed)` pair exposed by `allowedAssets()`. Requires `now < lockAt < endAt`.
   - `fund(roundId, amount)` lets anyone add USDG before `lockAt`.
2. `vote(roundId, assetIndex, wifAmount)`
   - Only before `lockAt`.
   - Transfers `wifAmount` of WIF from the voter **straight to the burn address**. The contract never holds WIF.
   - Adds the amount to the voter's weight on that asset and to the asset's total.
   - A voter can vote many times and on several assets.
3. `settle(roundId, startRoundIds[], endRoundIds[])`
   - Anyone can call it once `now > endAt`.
   - For each asset and each boundary time `t` (`lockAt` for the start, `endAt` for the end), the caller passes the Chainlink round that was current at `t`. The contract checks:
     - `updatedAt(r) <= t`
     - either `getRoundData(r+1)` reverts or returns `updatedAt == 0` (no successor yet), or the next round's `updatedAt > t`
     - `t - updatedAt(r) <= MAX_STALE` (a constant, e.g. 3 days)
   - Return = `end / start - 1`, in fixed point. The winner set is the asset(s) with the highest return. Ties share.
   - **Void** if any proof fails the staleness bound, if any asset token's `oraclePaused()` is true at settle time, or if nobody settles within `SETTLE_WINDOW` (e.g. 7 days) after `endAt` (`voidExpired` is callable by anyone).
4. `claim(roundId)`
   - Payout = `pot × (voter's weight on winning assets) / (total weight on winning assets)`.
   - One claim per voter. Leftover dust stays in the contract.
5. **Refunds:** if a round is void, or nobody voted for a winning asset, the sponsor calls `refund(roundId)` and gets the pot back. **Burned WIF is never returned.** The UI must say this before every vote.

## Views the UI needs
- `rounds(id)`: assets, lockAt, endAt, pot, sponsor, state (Open / Locked / Settled / Void), and the start/end prices and winners once settled.
- `assetTotals(id)` and `userWeights(id, user)`, plus `claimable(id, user)`.
- Events: `RoundCreated`, `Funded`, `Voted(roundId, voter, assetIndex, amount)`, `Settled(roundId, startPrices, endPrices, winnerMask)`, `Voided`, `Claimed`, `Refunded`. The UI builds its leaderboard and history from these, so there's no backend.

## Out of scope for v1
- Fee or USDG→WIF buyback. Add it once there's a route with real depth; the WIF/USDG pool has about $129 of USDG.
- Admin keys, upgradeability and pausing. The contract is immutable.
- Rounds that span a weekend. Run daily rounds Monday to Friday.

## Acceptance
- Fork tests against mainnet (anvil `--fork-url https://rpc.mainnet.chain.robinhood.com`) cover:
  - a full round: create → votes (WIF actually lands at the burn address) → warp → settle with real round ids → claims add up to the pot
  - a void round, followed by a refund
  - a bad round-id proof, which must revert
- A deploy script verifies the contract on the explorer. Mainnet deploy happens only after the user funds the deployer.
