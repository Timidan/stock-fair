import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { ASSETS, STOCK_FAIR, client, feedAbi, stockFairAbi } from "./chain";
import type { Reading } from "./Oracle";

export type Price = { price: number; updatedAt: number };

const POLL = Number(import.meta.env.VITE_POLL_MS || new URLSearchParams(location.search).get("poll") || 15_000);

async function latest(feed: Address): Promise<Price | null> {
  try {
    const [, answer, , updatedAt] = (await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" })) as readonly [bigint, bigint, bigint, bigint, bigint];
    return { price: Number(answer) / 1e8, updatedAt: Number(updatedAt) };
  } catch {
    return null;
  }
}

type RoundData = readonly [bigint, bigint, bigint, bigint, bigint];

// The Chainlink round current at `t`: the last one at or before it. This is exactly the proof `settle` checks.
// Round ids count up, so this jumps back in doubling steps until it passes `t`, then bisects, instead of reading every round.
export async function roundAt(feed: Address, t: number): Promise<{ id: bigint; price: number } | null> {
  const read = (id: bigint) =>
    (client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [id] }) as Promise<RoundData>)
      .then(([, answer, , updatedAt]) => (updatedAt === 0n ? null : { id, price: Number(answer) / 1e8, at: Number(updatedAt) }))
      .catch(() => null);
  try {
    const [id, answer, , updatedAt] = (await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" })) as RoundData;
    if (Number(updatedAt) <= t) return { id, price: Number(answer) / 1e8 };
    let hi = id, lo = id, step = 1n;
    for (;;) {
      lo = hi - step;
      const r = await read(lo);
      if (!r || r.at <= t) break;
      hi = lo;
      step *= 2n;
    }
    while (hi - lo > 1n) {
      const mid = lo + (hi - lo) / 2n, r = await read(mid);
      if (r && r.at > t) hi = mid;
      else lo = mid;
    }
    const found = await read(lo);
    return found && found.at <= t ? { id: found.id, price: found.price } : null;
  } catch {
    return null;
  }
}

export type Market = { change24h: number | null; volume24h: number; liquidity: number; marketCap: number | null };

type DexPair = { chainId: string; priceChange?: { h24?: number }; volume?: { h24?: number }; liquidity?: { usd?: number }; marketCap?: number };

// Totals across the token's pools on this chain (DexScreener lists up to 30, deepest first); the 24h move is the deepest pool's.
async function market(token: Address): Promise<Market | null> {
  try {
    const { pairs } = (await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`)).json()) as { pairs: DexPair[] | null };
    const pools = (pairs ?? []).filter((p) => p.chainId === "robinhood");
    if (!pools.length) return null;
    const deepest = pools.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    return {
      change24h: deepest.priceChange?.h24 ?? null,
      volume24h: pools.reduce((sum, p) => sum + (p.volume?.h24 ?? 0), 0),
      liquidity: pools.reduce((sum, p) => sum + (p.liquidity?.usd ?? 0), 0),
      marketCap: deepest.marketCap ?? null,
    };
  } catch {
    return null;
  }
}

// Market stats only add detail: if DexScreener fails the altars keep the last figures, or show none, and the fair carries on.
export function useMarkets() {
  const [markets, setMarkets] = useState<(Market | null)[]>(() => ASSETS.map(() => null));
  useEffect(() => {
    const load = () => Promise.all(ASSETS.map((a) => market(a.token))).then((next) => setMarkets((m) => next.map((n, i) => n ?? m[i])));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return markets;
}

export const STATES = ["Open", "Locked", "Settled", "Void"] as const;

export type Round = {
  id: bigint;
  sponsor: string;
  lockAt: number;
  endAt: number;
  pot: bigint;
  state: (typeof STATES)[number];
  totals: bigint[];
  carriedIn: bigint;
};

type RawRound = {
  lockAt: bigint; endAt: bigint; pot: bigint; sponsor: string; state: number;
  startPrices: readonly bigint[]; endPrices: readonly bigint[]; winnerMask: bigint; carriedIn: bigint;
};

export type Past = { id: bigint; winnerMask: number; pot: bigint; burned: bigint; state: (typeof STATES)[number]; start: number[]; end: number[] };

export type Fair = {
  round: Round | null | undefined;
  past: Past[];
  offline: boolean;
  carry: bigint;
  prices: (Price | null)[];
  startPrices: (number | null)[];
  reading: Reading | null;
  flares: number[];
};

// One poller for everything on the page: prices, the latest round, new burns and the settlement.
export function useFair(refresh: number): Fair {
  const [fair, setFair] = useState<Fair>({ round: undefined, past: [], offline: false, carry: 0n, prices: ASSETS.map(() => null), startPrices: ASSETS.map(() => null), reading: null, flares: ASSETS.map(() => 0) });
  const seen = useRef<{ block: bigint | null; round: bigint | null }>({ block: null, round: null });
  const starts = useRef<{ round: bigint; prices: (number | null)[] } | null>(null); // a round's lock prices never change
  const settleTx = useRef(new Map<bigint, string>());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const pricesRead = Promise.all(ASSETS.map((a) => latest(a.feed)));
      let round: Round | null = null, reading: Reading | null = null, past: Past[] = [], carry = 0n, startPrices: (number | null)[] = ASSETS.map(() => null);
      const bumps = ASSETS.map(() => 0);
      if (STOCK_FAIR) {
        const address = STOCK_FAIR;
        const count = (await client.readContract({ address, abi: stockFairAbi, functionName: "roundCount" })) as bigint;
        if (count > 0n) {
          const id = count;
          const [raw, totals] = (await Promise.all([
            client.readContract({ address, abi: stockFairAbi, functionName: "rounds", args: [id] }),
            client.readContract({ address, abi: stockFairAbi, functionName: "assetTotals", args: [id] }),
          ])) as [RawRound, readonly bigint[]];
          round = {
            id, sponsor: raw.sponsor, lockAt: Number(raw.lockAt), endAt: Number(raw.endAt), pot: raw.pot,
            state: STATES[raw.state], totals: [...totals], carriedIn: raw.carriedIn,
          };
          carry = (await client.readContract({ address, abi: stockFairAbi, functionName: "carry" })) as bigint;
          // Show the round now: everything below only adds to it.
          const known = await pricesRead, shown = round, shownCarry = carry;
          if (alive) setFair((f) => ({ ...f, round: shown, carry: shownCarry, prices: known, offline: known.every((p) => p == null) }));
          const now = Math.floor(Date.now() / 1000);
          if (now >= round.lockAt && round.state !== "Settled") {
            if (starts.current?.round !== id) starts.current = { round: id, prices: await Promise.all(ASSETS.map((a) => roundAt(a.feed, round!.lockAt).then((r) => r?.price ?? null))) };
            startPrices = starts.current.prices;
          }
          const head = await client.getBlockNumber();
          // New burns since the last poll make their fire flare (anyone's burn, not just this wallet's).
          if (seen.current.round === id && seen.current.block != null && head > seen.current.block) {
            const votes = await client.getContractEvents({ address, abi: stockFairAbi, eventName: "Voted", args: { roundId: id }, fromBlock: seen.current.block + 1n, toBlock: head });
            for (const v of votes) bumps[Number((v.args as { assetIndex: bigint }).assetIndex)]++;
          }
          seen.current = { block: head, round: id };
          // The latest round joins the history once it's finished. Twelve rounds covers the fair up to the final.
          const last = round.state === "Settled" || round.state === "Void" ? count : count - 1n;
          const older = Array.from({ length: Math.min(12, Number(last)) }, (_, k) => last - BigInt(k));
          past = await Promise.all(
            older.map(async (pid) => {
              const [r, t] = (await Promise.all([
                client.readContract({ address, abi: stockFairAbi, functionName: "rounds", args: [pid] }),
                client.readContract({ address, abi: stockFairAbi, functionName: "assetTotals", args: [pid] }),
              ])) as [RawRound, readonly bigint[]];
              return {
                id: pid, winnerMask: Number(r.winnerMask), pot: r.pot, burned: t.reduce((x, y) => x + y, 0n), state: STATES[r.state],
                start: r.startPrices.map((p) => Number(p) / 1e8), end: r.endPrices.map((p) => Number(p) / 1e8),
              };
            }),
          );
          const settled = past.find((p) => p.state === "Settled");
          if (settled) {
            // The tx link is a nicety: a bounded log search that may fail must not hide the result. The RPC allows about 5M blocks, roughly 6 days.
            if (!settleTx.current.has(settled.id)) {
              const logs = await client
                .getContractEvents({ address, abi: stockFairAbi, eventName: "Settled", args: { roundId: settled.id }, fromBlock: head > 5_000_000n ? head - 5_000_000n : 0n })
                .catch(() => []);
              if (logs[0]) settleTx.current.set(settled.id, logs[0].transactionHash);
            }
            reading = { roundId: settled.id, winnerMask: settled.winnerMask, tx: settleTx.current.get(settled.id) ?? "", start: settled.start, end: settled.end };
          }
        }
      }
      const prices = await pricesRead;
      if (alive) setFair((f) => ({ round, past, carry, offline: prices.every((p) => p == null), prices, startPrices, reading, flares: f.flares.map((n, i) => n + bumps[i]) }));
    };
    const run = () => load().catch(() => alive && setFair((f) => ({ ...f, offline: true })));
    run();
    const t = setInterval(run, POLL);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refresh]);
  return fair;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function countdown(seconds: number) {
  const s = Math.max(0, seconds), two = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ""}${two(h)}:${two(m)}:${two(s % 60)}`;
}
