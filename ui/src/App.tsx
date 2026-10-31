import { useEffect, useRef, useState } from "react";
import { BaseError, formatUnits, parseUnits, type Address } from "viem";
import { ASSETS, GET_WIF, STOCK_FAIR, USDG, WIF, client, erc20Abi, explorerAddress, explorerTx, stockFairAbi } from "./chain";
import { countdown, roundAt, useFair, useMarkets, useNow } from "./data";
import { Altars } from "./Altars";
import { Oracle } from "./Oracle";
import { emberFlight, revealOnScroll } from "./motion";
import { OPEN_IN, connect, disconnect, watchAccount } from "./wallet";

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

const POWERED = [
  { name: "$WIF", url: "https://worldisflat.fun", logo: "/brand/wif.png" },
  { name: "USDG", url: "https://globaldollar.com", logo: "/brand/usdg.png" },
  { name: "Chainlink", url: "https://chain.link", logo: "/brand/logos/chainlink.svg" },
  { name: "DexScreener", url: "https://dexscreener.com/robinhood", logo: "/brand/logos/dexscreener.png" },
];

type Balances = { wif: bigint; usdg: bigint; eth: bigint };

const TOKENS = [
  { key: "wif", symbol: "$WIF", name: "World is Flat", decimals: 18, digits: 2 },
  { key: "usdg", symbol: "USDG", name: "Global Dollar", decimals: 6, digits: 2 },
  { key: "eth", symbol: "ETH", name: "For gas", decimals: 18, digits: 6 },
] as const;

export default function App() {
  const [refresh, setRefresh] = useState(0);
  const { round, past, offline, carry, prices, startPrices, reading, flares } = useFair(refresh);
  const markets = useMarkets();
  const now = useNow();
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("100");
  const [account, setAccount] = useState<Address | null>(null);
  const [burns, setBurns] = useState<bigint[] | null>(null);
  const [claims, setClaims] = useState<{ id: bigint; owed: bigint }[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tx?: string; error?: boolean } | null>(null);
  const [ownFlares, setOwnFlares] = useState(() => ASSETS.map(() => 0));
  const [copied, setCopied] = useState(false);
  const [nudge, setNudge] = useState(false);
  const burnButton = useRef<HTMLButtonElement>(null);
  const walletDialog = useRef<HTMLDialogElement>(null);
  const openDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => revealOnScroll(), []);
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 6000);
    return () => clearTimeout(t);
  }, [nudge]);
  useEffect(() => watchAccount(setAccount), []);

  // A finished round moves down to the history, and the top of the page looks ahead to the next one.
  const live = round && round.state !== "Settled" && round.state !== "Void" ? round : null;
  const totals = live?.totals ?? ASSETS.map(() => 0n);
  const sum = totals.reduce((a, b) => a + b, 0n);
  const shares = totals.map((t) => (sum ? Number((t * 10_000n) / sum) / 10_000 : 0));
  const open = round != null && round.state === "Open" && now < round.lockAt;
  useEffect(() => { if (!open) setSelected(null); }, [open]);
  const settleable = round != null && (round.state === "Open" || round.state === "Locked") && now > round.endAt;

  useEffect(() => {
    if (!account || !live || !STOCK_FAIR) return setBurns(null);
    client.readContract({ address: STOCK_FAIR, abi: stockFairAbi, functionName: "userWeights", args: [live.id, account] })
      .then((b) => setBurns([...(b as readonly bigint[])]))
      .catch(() => setBurns(null));
  }, [account, live?.id, live?.totals.join(), refresh]);

  // Winnings stay claimable after the next round opens, so they follow the history, not the latest round.
  useEffect(() => {
    if (!account || !STOCK_FAIR) return setClaims([]);
    const address = STOCK_FAIR;
    Promise.all(past.map((p) => client.readContract({ address, abi: stockFairAbi, functionName: "claimable", args: [p.id, account] }) as Promise<bigint>))
      .then((owed) => setClaims(past.map((p, i) => ({ id: p.id, owed: owed[i] })).filter((c) => c.owed > 0n)))
      .catch(() => setClaims([]));
  }, [account, past.map((p) => p.id).join(), refresh]);

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
    if (!window.ethereum) return openDialog.current?.showModal();
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
      if (burnButton.current && stage) await emberFlight(burnButton.current, stage, ASSETS[selected].color);
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

  const claim = (id: bigint) =>
    run("Check your wallet…", async ({ wallet, account }) => {
      if (!STOCK_FAIR) return;
      const owed = (await client.readContract({ address: STOCK_FAIR, abi: stockFairAbi, functionName: "claimable", args: [id, account] })) as bigint;
      if (owed === 0n) return { text: "This wallet has nothing to claim in this round." };
      const hash = await wallet.writeContract({ account, address: STOCK_FAIR, abi: stockFairAbi, functionName: "claim", args: [id] });
      await client.waitForTransactionReceipt({ hash });
      return { text: `Claimed ${fmt(owed, 6, 2)} USDG.`, tx: hash };
    });

  // The keeper opens each weekday's round on its first run after 00:00 UTC.
  const nextOpen = (t: number) => { let d = Math.floor(t / 86400) + 1; while ([0, 6].includes(new Date(d * 86400000).getUTCDay())) d++; return d * 86400; };

  const next = round ? nextOpen(round.endAt) : 0;
  // Chainlink's stock feeds go quiet after Friday's close and resume at 00:00 UTC on Monday, when the next round opens.
  const weekend = round != null && !live && now < next && next - round.endAt > 86400;
  // Before it opens, the next pot is the last sponsor deposit plus everything carried forward.
  const pot = round ? (live ? round.pot : round.pot - round.carriedIn + carry) : 0n;
  const carried = live ? live.carriedIn : carry;

  const clock: { label: string; at?: number } =
    round === undefined ? { label: "Lighting the fires…" }
    : !round ? { label: "First round opens soon" }
    : open ? { label: "Picks close in", at: round.lockAt }
    : live ? (now < live.endAt ? { label: "Picks locked · settles in", at: live.endAt } : { label: "Ready to settle" })
    : now < next ? { label: `Round ${round.id + 1n} opens in`, at: next }
    : { label: `Round ${round.id + 1n} opens soon` };

  const myBurns = burns?.map((b, i) => (b > 0n ? `${fmt(b, 18)} on ${ASSETS[i].symbol}` : null)).filter(Boolean);
  const short = account && `${account.slice(0, 6)}…${account.slice(-4)}`;
  const connectWallet = () => {
    setNudge(false);
    if (!window.ethereum) return openDialog.current?.showModal();
    connect().then((w) => setAccount(w.account)).catch((e) => setStatus({ text: explain(e), error: true }));
  };
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <main>
      <header>
        <span className="mark"><img src="/brand/mark.svg" alt="" width="32" height="32" />Stock Fair</span>
        <span className="by">a $WIF fair on Robinhood Chain</span>
        {account ? (
          <button className="acct" onClick={() => walletDialog.current?.showModal()}>{short}</button>
        ) : (
          <button className="pill ghost" onClick={connectWallet}>Connect</button>
        )}
      </header>

      {offline && <p className="status error" role="alert">Can't reach Robinhood Chain right now. Prices and the round will load when it's back.</p>}

      <h1>Burn $WIF on the stock you think climbs most.</h1>
      <p className="lede">
        <span>
          {!round ? "Call it right and split the pot."
            : <>Call it right and split <Usdg v={(pot * 8n) / 10n} />.{carried > 0n && <small>Includes {fmt((carried * 8n) / 10n, 6, 2)} carried from earlier rounds.</small>}</>}
        </span>
      </p>

      <p className="timer">
        <span>{clock.label}</span>
        {clock.at != null && <b>{countdown(clock.at - now)}</b>}
      </p>
      {round && <p className="total"><img src="/brand/wif.png" alt="" /><b>{fmt(sum, 18)}</b> $WIF burned this round</p>}

      <Altars
        prices={prices}
        markets={markets}
        shares={shares}
        burned={totals.map((t) => Number(formatUnits(t, 18)))}
        returns={ASSETS.map((_, i) => (live && startPrices[i] && prices[i] ? prices[i]!.price / startPrices[i]! - 1 : null))}
        selected={selected}
        onSelect={(i) => setSelected((s) => (s === i ? null : i))}
        onTap={() => { if (!open) setNudge(true); }}
        pickable={open}
        ready={round !== undefined}
        flares={flares.map((n, i) => n + ownFlares[i])}
      />

      {open && (
        <section className={`panel burn${selected != null ? " active" : ""}`}>
          <label>
            <span className="amount-head">
              <span>{selected == null ? "Pick a stock above" : `$WIF to burn on ${ASSETS[selected].symbol}`}</span>
              {balances && <span>Balance {fmt(balances.wif, 18, 2)} $WIF</span>}
            </span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} disabled={selected == null} />
          </label>
          {account ? (
            <button ref={burnButton} className="pill lime" onClick={vote} disabled={busy || selected == null || !amount}>
              Burn and pick
            </button>
          ) : (
            <button className="pill lime" onClick={connectWallet}>Connect your wallet to burn</button>
          )}
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

      {claims.map((c) => (
        <section className="panel" key={c.id.toString()}>
          <p className="note">You won <b>{fmt(c.owed, 6, 2)} USDG</b> in round {c.id.toString()}.</p>
          <button className="pill lime" onClick={() => claim(c.id)} disabled={busy}>Claim USDG</button>
        </section>
      ))}

      {!account && !live && reading && (
        <section className="panel">
          <p className="note">Backed the winner? Connect to collect.</p>
          <button className="pill lime" onClick={connectWallet}>Check and claim</button>
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

      {account && (
        <dialog ref={walletDialog} className="wallet" aria-label="Wallet" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
          <div>
            <p className="wallet-head">
              {short}
              <button aria-label="Close" onClick={() => walletDialog.current?.close()}>×</button>
            </p>
            <ul>
              {TOKENS.map((t) => (
                <li key={t.key}>
                  <img src={`/brand/${t.key}.png`} alt="" />
                  <span>{t.symbol}<small>{t.name}</small></span>
                  <b>{balances ? fmt(balances[t.key], t.decimals, t.digits) : "…"}</b>
                </li>
              ))}
            </ul>
            <div className="wallet-actions">
              <button className="pill ghost" onClick={() => copy(account)}>{copied ? "Copied" : "Copy address"}</button>
              <a className="pill ghost" href={explorerAddress(account)} target="_blank" rel="noreferrer">Explorer</a>
              <button className="pill ghost" onClick={() => { walletDialog.current?.close(); disconnect(); setAccount(null); }}>Disconnect</button>
            </div>
          </div>
        </dialog>
      )}

      {nudge && (weekend || !account) && (
        <div className="nudge" role="status">
          <span>{weekend ? "Prices don't update on weekends. These are Friday's last prices." : "Picks are closed."}{!account && " Connect your wallet to burn in the next round."}</span>
          {!account && <button className="pill lime" onClick={connectWallet}>Connect</button>}
        </div>
      )}

      <dialog ref={openDialog} className="wallet" aria-label="Open in your wallet" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div>
          <p className="wallet-head">
            Open in your wallet
            <button aria-label="Close" onClick={() => openDialog.current?.close()}>×</button>
          </p>
          <div className="wallet-open">
            {OPEN_IN.map((w) => <a key={w.name} className="pill ghost" href={w.url}>{w.name}</a>)}
            <button className="pill ghost" onClick={() => copy(location.origin)}>{copied ? "Copied" : "Copy link for another wallet"}</button>
          </div>
        </div>
      </dialog>

      <footer>
        <ul className="powered" aria-label="Powered by">
          {POWERED.map((p) => (
            <li key={p.name}>
              <a href={p.url} target="_blank" rel="noreferrer"><img src={p.logo} alt="" />{p.name}</a>
            </li>
          ))}
        </ul>
        <p>Built on Robinhood Chain</p>
      </footer>
    </main>
  );
}
