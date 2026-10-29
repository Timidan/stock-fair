# Stock Fair

**Burn $WIF on the stock you think climbs most. Call it right and split the USDG pot.**

Live: https://stock-fair.timidan.xyz · Robinhood Chain mainnet (4663) · Built for the [World is Flat hackathon](https://worldisflat.fun/build)

Every weekday, Stock Fair opens a round on four Robinhood stock tokens: AAPL, NVDA, TSLA and SPY. Before the US market opens, $WIF holders burn $WIF on the stock they think will gain most by the close. Every $WIF burned is one vote, and it goes straight to the dead address. At the close, the contract reads Chainlink's prices on chain. Everyone who backed the winner splits 80% of the pot in proportion to their burn, and the other 20% rolls into tomorrow's pot.

It is the WIF team's own format, burn to vote, as World is Fair ran it, pointed at the main asset of Robinhood Chain.

## Why $WIF

| The brief asks for | Stock Fair |
|---|---|
| "a real reason to use $wif" | You can't play without burning $WIF. It is the only way to back a stock, and your share of the pot is your share of the $WIF burned on the winner. |
| "runs on robinhood chain" | Robinhood stock tokens, Chainlink's Robinhood equity feeds and USDG all exist together only on this chain. |
| "a flywheel, so using it keeps bringing people back to $wif" | See below: a pot that grows, and a new round every weekday. |
| "real transactions", "stays live" | Mainnet contract, keeper-run rounds every weekday until the final closes, every burn and settlement on the explorer. |

## Who pays, and the flywheel

- **The pot is paid by the sponsor.** We seed 0.8 USDG per weekday round from our own wallet, and every carry adds to it. Any project can sponsor a round, and the natural long-term sponsor is $WIF's own creator fees from trading on Pons.
- **Players pay in $WIF, by burning it.** At about $0.00125 per $WIF, 1 USDG buys about 800 $WIF. Winners are paid in proportion to their burn, so a burn is worth making whenever your share of the pot is worth more than the $WIF you burned.
- **Winners take 80%.** The other 20% carries into the next round, and if nobody backed the winner, all of it carries.

So pots grow from round to round, bigger pots are worth burning more $WIF for, and every burn takes $WIF out of supply for good.

Burns never refill the pot; only sponsors do. If nobody sponsors, rounds stop. `createRound` is open to any wallet, so any project can put up a pot for its own community without asking us.

## How a round settles (no admin, no oracle trust beyond Chainlink)

- The contract is immutable, with no owner, no pause and no upgrade.
- Anyone can settle a round, using the Settle button on the page or the keeper. The caller passes the Chainlink round that was current at the lock and at the close for each stock. The contract checks that each one is the last round at or before that moment, and that no newer round existed by then.
- A stale price voids the round, and its sponsor is refunded. A price feed paused for a corporate action makes settlement wait instead of voiding it.
- Only the four approved stock and feed pairs can be used.

## Try it

1. Open the live page. It shows the round, live Chainlink prices and the $WIF burned on each stock, with no wallet needed.
2. To play, connect a wallet on Robinhood Chain that holds $WIF, pick a brazier and press **Burn and pick**.
3. After the close, the oracle tablet shows the result. Winners press **Claim USDG**.

## Contracts and proof

| | Address / transaction |
|---|---|
| StockFair | [`0x16e7f897c6ee9394fbf08716515c66e8b6f85937`](https://robinhoodchain.blockscout.com/address/0x16e7f897c6ee9394fbf08716515c66e8b6f85937) (source verified on Sourcify) |
| $WIF | `0x5173b8eA6923c2d40267890D45C46a3480954773` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| First round, burns, settlement, claim | _linked here after the first mainnet round_ |

## Repository

- `contracts/`: `StockFair.sol`, with fork tests against Robinhood Chain mainnet (`forge test`)
- `ui/`: the page (Vite, React, viem). The fire is a halftone simulation driven by the real $WIF burned.
- `keeper/`: opens and settles the weekday rounds (`node keeper/keeper.mjs`, run every 10 minutes)
- `demo/`: a full round on a local fork, replaying real Chainlink prices (`bash demo/round.sh`)
- `docs/security-review-agy.md`: an independent security review, with what was fixed and why

## Run it locally

```bash
cd contracts && forge test                     # fork tests against mainnet state
cd ui && npm install && npm run dev            # http://localhost:5173
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 &
bash demo/round.sh                             # a full round in ~7 minutes; open the URL it prints
```

The public RPC prunes old state after about 12 minutes, so start a fresh fork right before the demo.
