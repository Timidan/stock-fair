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

// The price the contract will settle against: the last round at or before `t`.
async function priceAt(feed: Address, t: number): Promise<number | null> {
  try {
    let [id, answer, , updatedAt] = (await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" })) as readonly [bigint, bigint, bigint, bigint, bigint];
    for (let i = 0; i < 50 && Number(updatedAt) > t; i++) {
      id -= 1n;
      [, answer, , updatedAt] = (await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [id] })) as readonly [bigint, bigint, bigint, bigint, bigint];
      if (updatedAt === 0n) return null;
    }
    return Number(updatedAt) <= t ? Number(answer) / 1e8 : null;
  } catch {
    return null;
  }
}

export const STATES = ["Open", "Locked", "Settled", "Void"] as const;

export type Round = {
  id: bigint;
  sponsor: string;
  lockAt: number;
  endAt: number;
  pot: bigint;
  state: (typeof STATES)[number];
  winnerMask: number;
  totals: bigint[];
};

type RawRound = {
  lockAt: bigint; endAt: bigint; pot: bigint; sponsor: string; state: number;
  startPrices: readonly bigint[]; endPrices: readonly bigint[]; winnerMask: bigint;
};

export type Fair = {
  round: Round | null | undefined;
  prices: (Price | null)[];
  startPrices: (number | null)[];
  reading: Reading | null;
  flares: number[];
};

// One poller for everything on the page: prices, the latest round, new burns and the settlement.
export function useFair(refresh: number): Fair {
  const [fair, setFair] = useState<Fair>({ round: undefined, prices: ASSETS.map(() => null), startPrices: ASSETS.map(() => null), reading: null, flares: ASSETS.map(() => 0) });
  const seen = useRef<{ block: bigint | null; round: bigint | null }>({ block: null, round: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const prices = await Promise.all(ASSETS.map((a) => latest(a.feed)));
      let round: Round | null = null, reading: Reading | null = null, startPrices: (number | null)[] = ASSETS.map(() => null);
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
            state: STATES[raw.state], winnerMask: Number(raw.winnerMask), totals: [...totals],
          };
          const now = Math.floor(Date.now() / 1000);
          if (now >= round.lockAt && round.state !== "Settled") startPrices = await Promise.all(ASSETS.map((a) => priceAt(a.feed, round!.lockAt)));
          const head = await client.getBlockNumber();
          if (round.state === "Settled") {
            // The tx link is a nicety: a bounded log search that may fail must not hide the result.
            const logs = await client
              .getContractEvents({ address, abi: stockFairAbi, eventName: "Settled", args: { roundId: id }, fromBlock: head > 20_000n ? head - 20_000n : 0n })
              .catch(() => []);
            reading = {
              roundId: id, winnerMask: round.winnerMask, tx: logs[0]?.transactionHash ?? "",
              start: raw.startPrices.map((p) => Number(p) / 1e8), end: raw.endPrices.map((p) => Number(p) / 1e8),
            };
          }
          // New burns since the last poll make their fire flare (anyone's burn, not just this wallet's).
          if (seen.current.round === id && seen.current.block != null && head > seen.current.block) {
            const votes = await client.getContractEvents({ address, abi: stockFairAbi, eventName: "Voted", args: { roundId: id }, fromBlock: seen.current.block + 1n, toBlock: head });
            for (const v of votes) bumps[Number((v.args as { assetIndex: bigint }).assetIndex)]++;
          }
          seen.current = { block: head, round: id };
        }
      }
      if (alive) setFair((f) => ({ round, prices, startPrices, reading, flares: f.flares.map((n, i) => n + bumps[i]) }));
    };
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), POLL);
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
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`;
}
