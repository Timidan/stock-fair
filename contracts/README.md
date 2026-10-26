# Stock Fair contracts

Foundry project for `../SPEC.md`, Solidity 0.8.24. Runtime dependencies are three small interfaces; `forge-std` is the only library dependency. No admin, upgrade path, fees, or deployment has been added.

## Build and test

```sh
cd contracts
forge build
forge test
```

The six fork tests use Robinhood Chain mainnet (4663), block **98,482,863**, timestamp **2026-10-26 14:29:59 UTC**, via `https://rpc.mainnet.chain.robinhood.com`. They walk real feed history for Friday **2026-10-23 14:00–20:00 UTC**, then rewind the fork clock to create and vote before those boundaries. This is historical fork simulation, not live transactions or a wall-clock oracle-update test. Settlement tests use real token code and oracle round data; only WIF/USDG account balances are supplied with `deal`. Separate checks reject an unlisted mock feed and exercise the local replay helper etched over a forked proxy.

The public RPC returned `historical state ... is not available` for the previous block 98,396,913, so the pin was refreshed. Reproducibility needs RPC access to the pinned state; if that state becomes unavailable, use an archival endpoint or deliberately refresh `FORK_BLOCK` and recheck the fixture. Tests do not silently fall back to an unpinned fork.

The scenarios are a funded round with repeated votes, WIF reaching `0x000000000000000000000000000000000000dEaD`, signed returns and claims exhausting an exactly divisible pot; expiration followed by a sponsor refund with WIF still burned; an older, non-current price proof reverting; latest-round end proofs with no successors settling; an unlisted feed reverting; and replay-feed history after etching.

## UI / settler ABI

- `createRound((address token,address feed)[] assets,uint256 lockAt,uint256 endAt,uint256 pot)` returns a round id, starting at **1**, and rejects pairs outside the constructor's allowlist. `allowedAssets()` returns that fixed list; `script/Assets.sol` and the deploy script supply AAPL, NVDA, TSLA and SPY in that order. NVDA and TSLA addresses were read from the [Robinhood registry](https://api.robinhood.com/rhj/assets), filtering deployments for chain 4663, on 2026-10-26.
- `rounds(id)` returns one `Round` tuple: `assets, lockAt, endAt, pot, sponsor, state, startPrices, endPrices, winnerMask, refunded`. `state` is `0=Open`, `1=Locked`, `2=Settled`, `3=Void`. Locked is computed at read time; expiration requires `voidExpired(id)` to record Void.
- `assetTotals(id)` and `userWeights(id,user)` return amounts in asset order. WIF amounts have **18 decimals**; USDG amounts have **6 decimals**. Prices are signed raw feed answers (these four feeds have **8 decimals**); no token multiplier is applied. Returns use `end * 1e18 / start - 1e18` with signed `int256` arithmetic. `winnerMask & (1 << index)` identifies a winner.
- `settle(id,uint80[] startRoundIds,uint80[] endRoundIds)` takes one proof for each asset and boundary in the same order. It is callable strictly after `endAt` and through `endAt + 7 days`. `MAX_STALE` is **3 days**. Malformed proofs revert; valid but stale proofs or a currently paused stock token void the round. `voidExpired` becomes callable strictly after the seven-day window.
- Approve USDG before `createRound` / `fund`, and WIF before `vote`. Anyone can sponsor, fund, vote, settle or expire rounds; only the sponsor can refund. `claimable(id,user)` returns a USDG amount, `claim(id)` pays it once, and `refund(id)` pays the sponsor once when Void or when settled winners have zero votes. The original pot remains visible after claims/refund; `refunded` distinguishes a completed refund. Dust stays in the contract.
- The ABI includes every event named in SPEC. Full argument names and indexed fields are available with `forge inspect src/StockFair.sol:StockFair abi --json`, or in `out/StockFair.sol/StockFair.json` after building.

All outgoing and incoming ERC-20 transfers check the boolean result. Mutations precede token transfers and share a reentrancy lock. No function accepts or holds WIF for voting: `transferFrom(voter, BURN, amount)` goes directly to the burn address. **Burned WIF is never returned**, including void rounds; the UI must disclose this before every vote.

## Find a historical price round

```sh
forge script script/FindRound.s.sol:FindRound \
  --sig 'run(address,uint256)' \
  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 1792764000 \
  --rpc-url robinhood --fork-block-number 98482863
```

This read-only script prints `roundId` for AAPL at the start boundary used by the tests. For current operation, omit `--fork-block-number`; pass the desired feed and boundary timestamp. Run for both boundaries of every asset and preserve the round's asset order. It walks backward from the latest round to the last update at or before the timestamp. It rejects missing rounds and future boundaries, and explicitly stops if the timestamp predates the current proxy phase. An id being found does **not** guarantee it is fresh enough. A successor that reverts or has `updatedAt == 0` is accepted as absent. See [script/README.md](script/README.md) for the local replay demo.

## Deploy script (not broadcast)

`script/Deploy.s.sol` only deploys `StockFair`. It reads `DEPLOYER_PRIVATE_KEY` at run time with `vm.envUint`, with no key literals, writes or logging. Supply that environment variable securely outside tracked files. A simulation command is:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url robinhood
```

There is deliberately no `--broadcast` command here. No mainnet transaction was sent, and no deployed address or explorer verification is claimed. SPEC's explorer-verification acceptance remains a later deployment task; the current instruction requires a deploy-only script and no mainnet broadcast.

## SPEC issues preserved for review

1. **`r+1` is not phase-aware.** A proxy upgrade can put the next real update in a new phase. A revert or zero timestamp for the last round of an old phase does not establish that it was current at the boundary. The finder only traverses the current phase and fails explicitly for older boundaries.
2. **Additional funding is a donation to the sponsor's round.** As specified, the sponsor receives the entire pot on refund, including third-party funding. There are no individual funder refunds. Only the token's pause flag at settlement is checked; a corporate-action pause that ended earlier is not detectable by this rule.
3. **Weekend scheduling is a v1 operational restriction.** No weekday/calendar enforcement is specified or implemented. Schedule weekday rounds in the UI. Fixed-point ties, non-divisible-payout dust and irrecoverable WIF burns follow SPEC.

The tests do not independently cover paused/stale voids, phase upgrades, malicious callbacks, ties, dust, or the zero-winning-vote refund branch; no broader test suite or audit is claimed.
