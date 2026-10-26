import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { ASSETS, STOCK_FAIR, WIF, client, erc20Abi, explorerTx, stockFairAbi } from "./chain";
import { countdown, useFair, useNow } from "./data";
import { Altars } from "./Altars";
import { Oracle } from "./Oracle";
import { connect } from "./wallet";

const fmt = (v: bigint, d: number, digits = 0) =>
  Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: digits });

export default function App() {
  const [refresh, setRefresh] = useState(0);
  const { round, prices, startPrices, reading, flares } = useFair(refresh);
  const now = useNow();
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("100000");
  const [account, setAccount] = useState<Address | null>(null);
  const [status, setStatus] = useState<{ text: string; tx?: string; error?: boolean } | null>(null);

  const totals = round?.totals ?? ASSETS.map(() => 0n);
  const sum = totals.reduce((a, b) => a + b, 0n);
  const shares = totals.map((t) => (sum ? Number((t * 10_000n) / sum) / 10_000 : 0));
  const winners = ASSETS.map((_, i) => round?.state === "Settled" && ((round.winnerMask >> i) & 1) === 1);
  const open = round?.state === "Open" && now < round.lockAt;

  async function vote() {
    if (selected == null || !round || !STOCK_FAIR) return;
    try {
      const { wallet, account } = await connect();
      setAccount(account);
      const wei = parseUnits(amount, 18);
      const allowance = await client.readContract({ address: WIF, abi: erc20Abi, functionName: "allowance", args: [account, STOCK_FAIR] });
      if (allowance < wei) {
        setStatus({ text: "Approve $WIF in your wallet…" });
        const h = await wallet.writeContract({ account, address: WIF, abi: erc20Abi, functionName: "approve", args: [STOCK_FAIR, wei] });
        await client.waitForTransactionReceipt({ hash: h });
      }
      setStatus({ text: `Burning ${Number(amount).toLocaleString()} $WIF for ${ASSETS[selected].symbol}…` });
      const hash = await wallet.writeContract({ account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "vote", args: [round.id, BigInt(selected), wei] });
      await client.waitForTransactionReceipt({ hash });
      setStatus({ text: `Burned for ${ASSETS[selected].symbol}.`, tx: hash });
      setRefresh((r) => r + 1);
    } catch (e) {
      setStatus({ text: (e as Error).message.split("\n")[0], error: true });
    }
  }

  async function claim() {
    if (!round || !STOCK_FAIR) return;
    try {
      const { wallet, account } = await connect();
      setAccount(account);
      const owed = (await client.readContract({ address: STOCK_FAIR, abi: stockFairAbi, functionName: "claimable", args: [round.id, account] })) as bigint;
      if (owed === 0n) return setStatus({ text: "Nothing to claim for this wallet." });
      const hash = await wallet.writeContract({ account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "claim", args: [round.id] });
      await client.waitForTransactionReceipt({ hash });
      setStatus({ text: `Claimed ${fmt(owed, 6, 2)} USDG.`, tx: hash });
    } catch (e) {
      setStatus({ text: (e as Error).message.split("\n")[0], error: true });
    }
  }

  const clock = !round
    ? "First round opens soon"
    : round.state === "Open" && now < round.lockAt
      ? `Picks close in ${countdown(round.lockAt - now)}`
      : round.state === "Open" || round.state === "Locked"
        ? now < round.endAt ? `Settles in ${countdown(round.endAt - now)}` : "Waiting for settlement"
        : round.state === "Settled" ? "Settled" : "Void: pot returned to sponsor";

  return (
    <main>
      <header>
        <span className="mark">Stock Fair</span>
        <span className="by">a $WIF fair on Robinhood Chain</span>
        <span className="clock">{clock}</span>
        {account && <span className="acct">{account.slice(0, 6)}…{account.slice(-4)}</span>}
      </header>

      <h1>Burn $WIF on the stock you think climbs most.</h1>
      <p className="lede">
        {round ? <>Call it right and split the <b>{fmt(round.pot, 6)} USDG</b> pot.</> : "Call it right and split the pot."}
      </p>

      <Altars
        prices={prices}
        shares={shares}
        burned={totals.map((t) => fmt(t, 18))}
        returns={ASSETS.map((_, i) =>
          reading ? reading.end[i] / reading.start[i] - 1 : startPrices[i] && prices[i] ? prices[i]!.price / startPrices[i]! - 1 : null,
        )}
        winners={winners}
        selected={selected}
        onSelect={setSelected}
        flares={flares}
      />

      {open && (
        <section className="panel">
          <label>
            <span>{selected == null ? "Pick a column" : `$WIF to burn on ${ASSETS[selected].symbol}`}</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} disabled={selected == null} />
          </label>
          <button className="pill lime" onClick={vote} disabled={selected == null || !amount}>
            Burn and pick
          </button>
          <p className="warn">Burned $WIF is gone for good, win or lose. Winners split the USDG pot by $WIF burned on the top stock.</p>
        </section>
      )}

      {round?.state === "Settled" && (
        <section className="panel">
          <button className="pill lime" onClick={claim}>Claim my USDG</button>
        </section>
      )}

      {status && (
        <p className={`status${status.error ? " error" : ""}`} role="status">
          {status.text} {status.tx && <a href={explorerTx(status.tx)} target="_blank" rel="noreferrer">View transaction</a>}
        </p>
      )}

      <Oracle reading={reading} txUrl={explorerTx} />

      <footer>
        Prices: Chainlink on Robinhood Chain. The round's result comes from the last price at or before the close.
      </footer>
    </main>
  );
}
