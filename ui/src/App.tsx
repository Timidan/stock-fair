import { useEffect, useRef, useState } from "react";
import { BaseError, formatUnits, parseUnits, type Address } from "viem";
import { ASSETS, GET_WIF, STOCK_FAIR, USDG, WIF, client, erc20Abi, explorerTx, stockFairAbi } from "./chain";
import { countdown, roundAt, useFair, useMarkets, useNow } from "./data";
import { Altars } from "./Altars";
import { Oracle } from "./Oracle";
import { emberFlight, revealOnScroll } from "./motion";
import { connect, watchAccount } from "./wallet";

const fmt = (v: bigint, d: number, digits = 0) =>
  Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: digits });

const Usdg = ({ v }: { v: bigint }) => <b><img src="/brand/usdg.png" alt="" />{fmt(v, 6, 2)} USDG</b>;

// Wallet and contract errors, in words a voter can act on.
const explain = (e: unknown) => {
  const msg = e instanceof BaseError ? e.shortMessage : (e as Error).message;
  if (/User rejected|denied/i.test(msg)) return "You cancelled in your wallet.";
  if (/OraclePaused/.test(msg)) return "A stock's price feed is paused for a corporate action. Try settling again later.";
  if (/WrongTime/.test(msg)) return "Too early or too late for that step in this round.";
  if (/exceeds balance|insufficient/i.test(msg)) return "Not enough $WIF in this wallet.";
  return msg.split("\n")[0];
};

type Position = { burns: bigint[]; claimable: bigint };
type Balances = { wif: bigint; usdg: bigint; eth: bigint };

export default function App() {
  const [refresh, setRefresh] = useState(0);
  const { round, past, offline, carry, prices, startPrices, reading, flares } = useFair(refresh);
  const markets = useMarkets();
  const now = useNow();
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("100");
  const [account, setAccount] = useState<Address | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tx?: string; error?: boolean } | null>(null);
  const [ownFlares, setOwnFlares] = useState(() => ASSETS.map(() => 0));
  const burnButton = useRef<HTMLButtonElement>(null);

  useEffect(() => revealOnScroll(), []);
  useEffect(() => watchAccount(setAccount), []);

  const totals = round?.totals ?? ASSETS.map(() => 0n);
  const sum = totals.reduce((a, b) => a + b, 0n);
  const shares = totals.map((t) => (sum ? Number((t * 10_000n) / sum) / 10_000 : 0));
  const winners = ASSETS.map((_, i) => round?.state === "Settled" && ((round.winnerMask >> i) & 1) === 1);
  const open = round != null && round.state === "Open" && now < round.lockAt;
  useEffect(() => { if (!open) setSelected(null); }, [open]);
  const settleable = round != null && (round.state === "Open" || round.state === "Locked") && now > round.endAt;

  useEffect(() => {
    if (!account || !round || !STOCK_FAIR) return setPosition(null);
    const address = STOCK_FAIR;
    Promise.all([
      client.readContract({ address, abi: stockFairAbi, functionName: "userWeights", args: [round.id, account] }),
      client.readContract({ address, abi: stockFairAbi, functionName: "claimable", args: [round.id, account] }),
    ])
      .then(([burns, claimable]) => setPosition({ burns: [...(burns as readonly bigint[])], claimable: claimable as bigint }))
      .catch(() => setPosition(null));
  }, [account, round?.id, round?.state, round?.totals.join(), refresh]);

  useEffect(() => {
    if (!account) return setBalances(null);
    const load = () =>
      Promise.all([
        client.readContract({ address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        client.getBalance({ address: account }),
      ])
        .then(([wif, usdg, eth]) => setBalances({ wif, usdg, eth }))
        .catch(() => setBalances(null));
    load();
    // Back from a bridge or a swap in another tab, the wallet holds something new.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [account, refresh]);

  async function run(label: string, fn: (w: Awaited<ReturnType<typeof connect>>) => Promise<{ text: string; tx?: string } | void>) {
    setBusy(true);
    try {
      const w = await connect();
      setAccount(w.account);
      setStatus({ text: label });
      const done = await fn(w);
      if (done) setStatus(done);
      setRefresh((r) => r + 1);
    } catch (e) {
      setStatus({ text: explain(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const vote = () =>
    run("Check your wallet…", async ({ wallet, account }) => {
      if (selected == null || !round || !STOCK_FAIR) return;
      const wei = parseUnits(amount, 18);
      const [allowance, balance] = await Promise.all([
        client.readContract({ address: WIF, abi: erc20Abi, functionName: "allowance", args: [account, STOCK_FAIR] }),
        client.readContract({ address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      ]);
      if (balance < wei) throw new Error("Not enough $WIF in this wallet.");
      if (allowance < wei) {
        setStatus({ text: "Approve $WIF in your wallet…" });
        // The whole balance, so the next burns need one confirmation. The contract only takes $WIF from the wallet calling vote.
        const h = await wallet.writeContract({ account, address: WIF, abi: erc20Abi, functionName: "approve", args: [STOCK_FAIR, balance] });
        await client.waitForTransactionReceipt({ hash: h });
      }
      setStatus({ text: `Burning ${Number(amount).toLocaleString()} $WIF on ${ASSETS[selected].symbol}…` });
      const hash = await wallet.writeContract({ account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "vote", args: [round.id, BigInt(selected), wei] });
      await client.waitForTransactionReceipt({ hash });
      // Only once the burn is confirmed: the embers you see are WIF that is actually gone.
      const stage = document.querySelectorAll(".altar .stage")[selected];
      if (burnButton.current && stage) await emberFlight(burnButton.current, stage);
      setOwnFlares((f) => f.map((n, i) => (i === selected ? n + 1 : n)));
      return { text: `Burned ${Number(amount).toLocaleString()} $WIF on ${ASSETS[selected].symbol}.`, tx: hash };
    });

  // Anyone can settle: the page finds the Chainlink rounds current at the lock and the close, and the contract checks them.
  const settle = () =>
    run("Reading Chainlink rounds at the lock and the close…", async ({ wallet, account }) => {
      if (!round || !STOCK_FAIR) return;
      const [starts, ends] = await Promise.all([
        Promise.all(ASSETS.map((a) => roundAt(a.feed, round.lockAt))),
        Promise.all(ASSETS.map((a) => roundAt(a.feed, round.endAt))),
      ]);
      if ([...starts, ...ends].some((r) => r == null)) throw new Error("Couldn't find a price round for one of the stocks. Try again shortly.");
      const hash = await wallet.writeContract({
        account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "settle",
        args: [round.id, starts.map((r) => r!.id), ends.map((r) => r!.id)],
      });
      await client.waitForTransactionReceipt({ hash });
      return { text: "Round settled.", tx: hash };
    });

  const claim = () =>
    run("Check your wallet…", async ({ wallet, account }) => {
      if (!round || !STOCK_FAIR) return;
      const owed = (await client.readContract({ address: STOCK_FAIR, abi: stockFairAbi, functionName: "claimable", args: [round.id, account] })) as bigint;
      if (owed === 0n) return { text: "This wallet has nothing to claim in this round." };
      const hash = await wallet.writeContract({ account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "claim", args: [round.id] });
      await client.waitForTransactionReceipt({ hash });
      return { text: `Claimed ${fmt(owed, 6, 2)} USDG.`, tx: hash };
    });

  // The keeper opens each weekday's round on its first run after 00:00 UTC.
  const nextOpen = (t: number) => { let d = Math.floor(t / 86400) + 1; while ([0, 6].includes(new Date(d * 86400000).getUTCDay())) d++; return d * 86400; };

  const clock =
    round === undefined ? "Loading…"
    : !round ? "First round opens soon"
    : open ? `Picks close in ${countdown(round.lockAt - now)}`
    : round.state === "Open" || round.state === "Locked" ? (now < round.endAt ? `Picks locked · settles in ${countdown(round.endAt - now)}` : "Ready to settle")
    : `Round ${round.id} ${round.state === "Settled" ? "settled" : "void"} · next opens in ${countdown(nextOpen(now) - now)}`;

  const myBurns = position?.burns.map((b, i) => (b > 0n ? `${fmt(b, 18)} on ${ASSETS[i].symbol}` : null)).filter(Boolean);
  const holdings = balances && (
    <span className="holdings">
      <span>{fmt(balances.wif, 18, 2)} $WIF</span>
      <span>{fmt(balances.usdg, 6, 2)} USDG</span>
      <span>{fmt(balances.eth, 18, 6)} ETH</span>
    </span>
  );

  return (
    <main>
      <header>
        <span className="mark"><img src="/brand/mark.svg" alt="" width="32" height="32" />Stock Fair</span>
        <span className="by">a $WIF fair on Robinhood Chain</span>
        <span className="clock">{clock}</span>
        {holdings}
        {account ? (
          <span className="acct">{account.slice(0, 6)}…{account.slice(-4)}</span>
        ) : (
          <button className="pill ghost" onClick={() => connect().then((w) => setAccount(w.account)).catch((e) => setStatus({ text: explain(e), error: true }))}>
            Connect
          </button>
        )}
      </header>

      {offline && <p className="status error" role="alert">Can't reach Robinhood Chain right now. Prices and the round will load when it's back.</p>}

      <h1>Burn $WIF on the stock you think climbs most.</h1>
      <p className="lede">
        <span>
          {!round ? "Call it right and split the pot."
            : round.state === "Settled" ? <>Winners split <Usdg v={round.payoutBase} />.{carry > 0n && <> <Usdg v={carry} /> carries into the next round.</>}</>
            : <>Call it right and split <Usdg v={(round.pot * 8n) / 10n} />.{round.carriedIn > 0n && <small>Includes {fmt((round.carriedIn * 8n) / 10n, 6, 2)} carried from earlier rounds.</small>}</>}
        </span>
      </p>

      <Altars
        prices={prices}
        markets={markets}
        shares={shares}
        burned={totals.map((t) => fmt(t, 18))}
        returns={ASSETS.map((_, i) =>
          reading ? reading.end[i] / reading.start[i] - 1 : startPrices[i] && prices[i] ? prices[i]!.price / startPrices[i]! - 1 : null,
        )}
        winners={winners}
        selected={selected}
        onSelect={setSelected}
        pickable={open}
        flares={flares.map((n, i) => n + ownFlares[i])}
      />

      {open && (
        <section className="panel">
          <label>
            <span className="amount-head">
              <span>{selected == null ? "Pick a stock above" : `$WIF to burn on ${ASSETS[selected].symbol}`}</span>
              {holdings}
            </span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} disabled={selected == null} />
          </label>
          <button ref={burnButton} className="pill lime" onClick={vote} disabled={busy || selected == null || !amount}>
            Burn and pick
          </button>
          <p className="warn">
            Burned $WIF is gone for good, win or lose.
            {myBurns?.length ? ` You burned ${myBurns.join(", ")} this round.` : ""}
          </p>
        </section>
      )}

      {settleable && (
        <section className="panel">
          <p className="note">The round has closed. Anyone can settle it; the contract checks Chainlink's prices itself.</p>
          <button className="pill lime" onClick={settle} disabled={busy}>Settle round {round!.id.toString()}</button>
        </section>
      )}

      {round?.state === "Settled" && (!account || (position?.claimable ?? 0n) > 0n) && (
        <section className="panel">
          <p className="note">{position ? <>You won <b>{fmt(position.claimable, 6, 2)} USDG</b>.</> : "Backed the winner? Connect to collect."}</p>
          <button className="pill lime" onClick={claim} disabled={busy}>{position ? "Claim USDG" : "Check and claim"}</button>
        </section>
      )}

      {status && (
        <p className={`status${status.error ? " error" : ""}`} role="status">
          {status.text} {status.tx && <a href={explorerTx(status.tx)} target="_blank" rel="noreferrer">View transaction</a>}
        </p>
      )}

      <ol className="ways">
        {GET_WIF.map((w) => (
          <li key={w.url}>
            <a className="pill ghost" href={w.url} target="_blank" rel="noreferrer">
              {w.label}
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l6-6M4 3h5v5" /></svg>
            </a>
          </li>
        ))}
      </ol>

      <Oracle reading={reading} txUrl={explorerTx} />

      {past.length > 0 && (
        <section className="past" aria-labelledby="past-title">
          <h2 id="past-title">Earlier rounds</h2>
          <ol>
            {past.map((p) => (
              <li key={p.id.toString()}>
                <span>Round {p.id.toString()}</span>
                <span>{p.state === "Void" ? "Void" : ASSETS.filter((_, i) => (p.winnerMask >> i) & 1).map((a) => a.symbol).join(" + ") || "Unsettled"}</span>
                <span>{fmt(p.pot, 6, 2)} USDG</span>
                <span>{fmt(p.burned, 18)} $WIF burned</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer>Prices: Chainlink on Robinhood Chain. Each round settles on the last price at or before its close. 24h change, volume and liquidity: the tokens' pools on Robinhood Chain, from DexScreener.</footer>
    </main>
  );
}
