// Stock Fair keeper: run every ~10 minutes (cron). Each run does only what is due, so reruns are harmless.
//   1. a round ended and isn't settled -> settle it with the Chainlink rounds current at its lock and close
//   2. a round voided and we sponsored it -> refund (its carried part goes back into the next pot)
//   3. it's a weekday, before today's lock, and today's round doesn't exist -> open it
// Env: KEEPER_KEY (sponsor key, never logged), STOCK_FAIR, RPC (optional), POT_USDG (default 5),
//      LOCK_UTC / END_UTC as HH:MM to override the default, the NYSE regular session (09:30 / 16:00 New York time).
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = process.env;
// The base fee can jump more than viem's default 20% headroom between quote and send. A transaction pays only
// the base fee, so a 3x cap costs nothing extra.
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } }, fees: { baseFeeMultiplier: 3 } });
const transport = http(env.RPC || undefined);
const client = createPublicClient({ chain, transport });
const account = privateKeyToAccount(env.KEEPER_KEY);
const wallet = createWalletClient({ chain, transport, account });
const FAIR = env.STOCK_FAIR;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const POT = parseUnits(env.POT_USDG || "5", 6);

const fair = parseAbi([
  "function roundCount() view returns (uint256)",
  "function allowedAssets() view returns ((address token, address feed)[])",
  "function rounds(uint256) view returns (((address token, address feed)[] assets, uint256 lockAt, uint256 endAt, uint256 pot, address sponsor, uint8 state, int256[] startPrices, int256[] endPrices, uint256 winnerMask, bool refunded, uint256 carriedIn, uint256 payoutBase))",
  "function createRound((address token, address feed)[] assets, uint256 lockAt, uint256 endAt, uint256 pot) returns (uint256)",
  "function settle(uint256 id, uint80[] startRoundIds, uint80[] endRoundIds)",
  "function voidExpired(uint256 id)",
  "function refund(uint256 id)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
]);
const erc20 = parseAbi(["function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const now = async () => Number((await client.getBlock()).timestamp);
async function send(fn, args) {
  const hash = await wallet.writeContract({ address: FAIR, abi: fair, functionName: fn, args });
  const r = await client.waitForTransactionReceipt({ hash });
  log(fn, typeof args[0] === "bigint" ? `round ${args[0]}` : "", r.status, hash);
  if (r.status !== "success") throw new Error(`${fn} reverted`);
}

// The Chainlink round current at t: the last one at or before it (exactly what settle() checks).
async function roundAt(feed, t) {
  let [id, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
  for (let i = 0; i < 500 && Number(updatedAt) > t; i++) {
    id -= 1n;
    [, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [id] });
    if (updatedAt === 0n) throw new Error(`no round at ${t} for ${feed}`);
  }
  return id;
}

const at = (dayStart, hhmm) => dayStart + Number(hhmm.split(":")[0]) * 3600 + Number(hhmm.split(":")[1]) * 60;
// New York's offset from UTC in seconds at t: -4h in summer, -5h in winter, so rounds follow US daylight saving.
const nyOffset = (t) => {
  const [, sign, h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).format(new Date(t * 1000)).match(/GMT([+-])(\d\d):(\d\d)/);
  return (sign === "-" ? -1 : 1) * (Number(h) * 3600 + Number(m) * 60);
};

async function main() {
  const t = await now();
  const count = await client.readContract({ address: FAIR, abi: fair, functionName: "roundCount" });

  for (let id = count > 5n ? count - 4n : 1n; id <= count; id++) {
    const r = await client.readContract({ address: FAIR, abi: fair, functionName: "rounds", args: [id] });
    const lockAt = Number(r.lockAt), endAt = Number(r.endAt);
    if ((r.state === 0 || r.state === 1) && t > endAt) {
      if (t > endAt + 7 * 86400) { await send("voidExpired", [id]); continue; }
      try {
        const feeds = r.assets.map((a) => a.feed);
        await send("settle", [id, await Promise.all(feeds.map((f) => roundAt(f, lockAt))), await Promise.all(feeds.map((f) => roundAt(f, endAt)))]);
      } catch (e) {
        log("settle", id, "not yet:", e.shortMessage || e.message); // e.g. OraclePaused: retry next run
      }
    }
    const fresh = await client.readContract({ address: FAIR, abi: fair, functionName: "rounds", args: [id] });
    if (fresh.state === 3 && !fresh.refunded && fresh.sponsor.toLowerCase() === account.address.toLowerCase()) await send("refund", [id]);
  }

  const day = Math.floor(t / 86400) * 86400, weekday = new Date(t * 1000).getUTCDay();
  const ny = nyOffset(day + 12 * 3600);
  const lockAt = env.LOCK_UTC ? at(day, env.LOCK_UTC) : at(day, "09:30") - ny;
  const endAt = env.END_UTC ? at(day, env.END_UTC) : at(day, "16:00") - ny;
  const last = count > 0n ? await client.readContract({ address: FAIR, abi: fair, functionName: "rounds", args: [count] }) : null;
  const todayExists = last && Number(last.lockAt) === lockAt;
  const usdg = await client.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (weekday >= 1 && weekday <= 5 && t < lockAt - 600 && !todayExists && usdg < POT) log(`can't open today's round: keeper holds ${Number(usdg) / 1e6} USDG, needs ${Number(POT) / 1e6}`);
  else if (weekday >= 1 && weekday <= 5 && t < lockAt - 600 && !todayExists) {
    const allowance = await client.readContract({ address: USDG, abi: erc20, functionName: "allowance", args: [account.address, FAIR] });
    if (allowance < POT) {
      const hash = await wallet.writeContract({ address: USDG, abi: erc20, functionName: "approve", args: [FAIR, POT * 100n] });
      await client.waitForTransactionReceipt({ hash });
    }
    const assets = await client.readContract({ address: FAIR, abi: fair, functionName: "allowedAssets" });
    await send("createRound", [assets, BigInt(lockAt), BigInt(endAt), POT]);
  }
  const left = await client.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [account.address] });
  const eth = await client.getBalance({ address: account.address });
  log(`ok: ${count} rounds before this run; keeper holds ${Number(left) / 1e6} USDG, ${Number(eth) / 1e18} ETH`);
}

main().catch((e) => {
  log("keeper error:", e.shortMessage || e.message);
  process.exit(1);
});
