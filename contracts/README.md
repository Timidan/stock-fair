# Stock Fair contracts

Foundry project, Solidity 0.8.24. `src/StockFair.sol` is deployed on Robinhood Chain mainnet at [`0x16e7f897c6ee9394fbf08716515c66e8b6f85937`](https://robinhoodchain.blockscout.com/address/0x16e7f897c6ee9394fbf08716515c66e8b6f85937), with the source [verified on Sourcify](https://repo.sourcify.dev/4663/0x16E7F897C6eE9394Fbf08716515c66e8b6f85937) (exact match). The rules it follows are in [../SPEC.md](../SPEC.md). `forge-std` is the only library.

## Test

```bash
cd contracts
forge build
forge test
```

The 12 tests run on a fork of Robinhood Chain mainnet at block 98,482,863 (26 Oct 2026). They replay real Chainlink history for Fri 23 Oct, 14:00–20:00 UTC, against the real Stock Tokens and feeds. Only the WIF and USDG balances come from `deal`.

| Test | Checks |
|---|---|
| `testFullRoundRollsOver` | Votes burn WIF to `0x…dEaD`; settlement with real round ids; claims pay 80%, and 20% carries into the next round |
| `testUnbackedWinnerRollsOver` | Nobody backed the winner: the whole pot carries and the sponsor cannot refund |
| `testVoidAndRefund` | A round nobody settles within 7 days voids; the sponsor gets the deposit back once, and the WIF stays burned |
| `testBadProofReverts` · `testRetiredPhaseWithoutSuccessorReverts` | A price round that wasn't current at the boundary is rejected |
| `testSettleWithLatestEndRound` | The feed's latest round, with no successor yet, settles |
| `testPausedOracleCanRetrySettlement` | A paused Stock Token blocks settlement until it resumes |
| `testDuplicateAssetReverts` · `testZeroPotReverts` · `testUnlistedFeedReverts` | Bad rounds are refused |
| `testFundUnavailable` | There is no `fund()`, so nobody can add to another sponsor's pot |
| `testReplayFeedEtchedOverProxy` | The replay feed used by the local demo |

The public RPC prunes old state. If the pinned block is no longer served, use an archive RPC or move `FORK_BLOCK` and recheck the fixtures.

## ABI

| Function | Who, when | Does |
|---|---|---|
| `createRound(assets, lockAt, endAt, pot)` | Anyone (the sponsor), before `lockAt` | Opens a round with 2–4 allowlisted stock and feed pairs. Pulls `pot` USDG and adds the current carry. Ids start at 1. |
| `vote(id, assetIndex, wifAmount)` | Anyone, before `lockAt` | Moves `wifAmount` WIF from the voter straight to `0x…dEaD` and records the pick |
| `settle(id, startRoundIds, endRoundIds)` | Anyone, up to 7 days after `endAt` | Checks one Chainlink round per stock at `lockAt` and at `endAt`, then sets the winners and the carry. A stale price (over 3 days old) voids the round. |
| `claim(id)` | Backers of the winner | Pays `payoutBase × your weight on the winners / total weight on the winners`, once |
| `refund(id)` | The sponsor of a void round | Returns the deposit (`pot − carriedIn`); the carried part goes back to the next pot |
| `voidExpired(id)` | Anyone, more than 7 days after `endAt` | Voids a round nobody settled |

Views: `rounds(id)`, `assetTotals(id)`, `userWeights(id, user)`, `claimable(id, user)`, `claimed(id, user)`, `allowedAssets()`, `carry()`, `roundCount()`. `rounds(id).state` is 0 Open, 1 Locked, 2 Settled, 3 Void. WIF has 18 decimals, USDG 6, and prices are raw Chainlink answers with 8. `winnerMask & (1 << i)` marks a winner.

Events: `RoundCreated`, `Voted`, `Settled`, `RolledOver`, `Voided`, `Claimed`, `Refunded`. `keeper/proof.mjs` builds the README's rounds table from them.

## Scripts

- `script/Deploy.s.sol` deploys `StockFair` with the AAPL, NVDA, TSLA and SPY allowlist from `script/Assets.sol`. It reads `DEPLOYER_PRIVATE_KEY` from the environment.
- `script/FindRound.s.sol` prints the Chainlink round that was current at a timestamp, which is what `settle` needs. Read-only:

```bash
forge script script/FindRound.s.sol:FindRound --sig 'run(address,uint256)' \
  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 1792764000 --rpc-url robinhood
```

- `test/mocks/ReplayFeed.sol` replays prices on a local fork for the demo. It is never deployed to mainnet. See [script/README.md](script/README.md).

## Known limits

- **Feed phases.** The "next round" check is not phase-aware. A boundary that falls in an older proxy phase is rejected rather than proven.
- **Pauses.** Only the Stock Token's pause flag at settlement time is checked. A corporate-action pause that ended before settlement is not seen.
- **Schedule.** The contract doesn't enforce weekdays. The keeper opens rounds Monday to Friday only.
- **Dust.** Payouts round down; leftover dust stays in the contract.
