// Rebuilds the "Mainnet rounds" table from Stock Fair's events on chain, so every link in it is a real transaction.
// Usage: node proof.mjs prints the table; node proof.mjs --write also replaces it in ../README.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, defineChain, formatUnits, http, parseAbi } from "viem";

const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const client = createPublicClient({ chain, transport: http(process.env.RPC || undefined) });
const FAIR = "0x16e7f897c6ee9394fbf08716515c66e8b6f85937";
const DEPLOY_BLOCK = 101105934n;
const EXPLORER = "https://robinhoodchain.blockscout.com";
// The keeper's weekday rounds until the final closes: [day, picks close, round ends] in UTC (New York moves off DST on 1 Nov).
const SCHEDULE = [["2026-10-30", "13:30", "20:00"], ["2026-11-02", "14:30", "21:00"], ["2026-11-03", "14:30", "21:00"], ["2026-11-04", "14:30", "21:00"], ["2026-11-05", "14:30", "21:00"], ["2026-11-06", "14:30", "21:00"], ["2026-11-09", "14:30", "21:00"], ["2026-11-10", "14:30", "21:00"], ["2026-11-11", "14:30", "21:00"], ["2026-11-12", "14:30", "21:00"], ["2026-11-13", "14:30", "21:00"], ["2026-11-16", "14:30", "21:00"]];
const SYMBOL = { "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL", "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "NVDA", "0x322f0929c4625ed5bad873c95208d54e1c003b2d": "TSLA", "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": "SPY" };
const abi = parseAbi([
  "event RoundCreated(uint256 indexed roundId, address indexed sponsor, (address token, address feed)[] assets, uint256 lockAt, uint256 endAt, uint256 pot)",
  "event Voted(uint256 indexed roundId, address indexed voter, uint256 assetIndex, uint256 amount)",
  "event Settled(uint256 indexed roundId, int256[] startPrices, int256[] endPrices, uint256 winnerMask)",
  "event Voided(uint256 indexed roundId)",
  "event Claimed(uint256 indexed roundId, address indexed voter, uint256 amount)",
  "event Refunded(uint256 indexed roundId, address indexed sponsor, uint256 amount)",
  "function rounds(uint256) view returns (((address token, address feed)[] assets, uint256 lockAt, uint256 endAt, uint256 pot, address sponsor, uint8 state, int256[] startPrices, int256[] endPrices, uint256 winnerMask, bool refunded, uint256 carriedIn, uint256 payoutBase))",
]);

const amount = (v, d) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const hm = (t) => new Date(t * 1000).toISOString().slice(11, 16);
const tx = (log, label) => `[${label}](${EXPLORER}/tx/${log.transactionHash})`;
const txs = (logs) => logs.slice(0, 10).map((l, i) => tx(l, i + 1)).join(" ") + (logs.length > 10 ? ` [+${logs.length - 10} more](${EXPLORER}/address/${FAIR})` : "");

const latest = await client.getBlockNumber();
const { timestamp } = await client.getBlock({ blockNumber: latest });
const now = Number(timestamp);
// The RPC allows wide block ranges only for one event at a time.
const logs = [];
for (const eventName of ["RoundCreated", "Voted", "Settled", "Voided", "Claimed", "Refunded"]) {
  for (let from = DEPLOY_BLOCK; from <= latest; from += 5_000_000n) {
    const to = from + 4_999_999n < latest ? from + 4_999_999n : latest;
    logs.push(...(await client.getContractEvents({ address: FAIR, abi, eventName, fromBlock: from, toBlock: to })));
  }
}
const of = (name, id) => logs.filter((l) => l.eventName === name && l.args.roundId === id);
const opened = logs.filter((l) => l.eventName === "RoundCreated");

const rows = [];
let burnedAll = 0n, paidAll = 0n;
for (const created of opened) {
  const id = created.args.roundId;
  const r = await client.readContract({ address: FAIR, abi, functionName: "rounds", args: [id] });
  const lockAt = Number(r.lockAt), endAt = Number(r.endAt);
  const votes = of("Voted", id), claims = of("Claimed", id), [settled] = of("Settled", id), [voided] = of("Voided", id), [refund] = of("Refunded", id);
  const burned = votes.reduce((s, l) => s + l.args.amount, 0n), paid = claims.reduce((s, l) => s + l.args.amount, 0n);
  burnedAll += burned;
  paidAll += paid;
  const winner = settled
    ? r.assets.map((a, i) => ((r.winnerMask >> BigInt(i)) & 1n ? `${SYMBOL[a.token.toLowerCase()] ?? a.token} ${((Number(r.endPrices[i]) / Number(r.startPrices[i]) - 1) * 100).toFixed(2).replace(/^(?!-)/, "+")}%` : null)).filter(Boolean).join(", ")
    : "";
  rows.push({
    lockAt,
    cells: [
      id,
      day(lockAt),
      `${amount(r.pot, 6)} USDG${r.carriedIn ? ` (${amount(r.carriedIn, 6)} carried in)` : ""}`,
      tx(created, hm(Number((await client.getBlock({ blockNumber: created.blockNumber })).timestamp)) + " UTC"),
      votes.length ? `${amount(burned, 18)} $WIF · ${txs(votes)}` : now < lockAt ? `picks close ${hm(lockAt)} UTC` : "none",
      settled ? tx(settled, "settle") : voided ? `void · ${tx(voided, "tx")}` : now < endAt ? `after ${hm(endAt)} UTC` : "settling",
      winner,
      claims.length ? `${amount(paid, 6)} USDG · ${txs(claims)}` : refund ? `refunded · ${tx(refund, "tx")}` : settled && r.payoutBase === 0n ? "nobody backed it, pot carried" : settled ? "not claimed yet" : "",
    ],
  });
}
for (const [date, lock, end] of SCHEDULE) {
  const lockAt = Date.parse(`${date}T${lock}:00Z`) / 1000;
  if (rows.some((r) => day(r.lockAt) === day(lockAt))) continue;
  rows.push({ lockAt, cells: now < lockAt ? ["", day(lockAt), "0.8 USDG + carry", "opens 00:00 UTC", `picks close ${lock} UTC`, `after ${end} UTC`, "", ""] : ["", day(lockAt), "", "no round opened", "", "", "", ""] });
}
rows.sort((a, b) => a.lockAt - b.lockAt);

const table = [
  `**${opened.length} round${opened.length === 1 ? "" : "s"} so far · ${amount(burnedAll, 18)} $WIF burned · ${amount(paidAll, 6)} USDG paid to winners.** Built from the contract's events by \`node keeper/proof.mjs\`, last run ${new Date(now * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
  "",
  "| Round | Day | Pot | Opened | $WIF burned | Settled | Winner | Paid out |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.cells.join(" | ")} |`),
].join("\n");

console.log(table);
if (process.argv.includes("--write")) {
  const path = new URL("../README.md", import.meta.url);
  const readme = readFileSync(path, "utf8");
  if (!/<!-- rounds -->[\s\S]*<!-- \/rounds -->/.test(readme)) throw new Error("README.md has no <!-- rounds --> … <!-- /rounds --> block");
  writeFileSync(path, readme.replace(/<!-- rounds -->[\s\S]*<!-- \/rounds -->/, `<!-- rounds -->\n${table}\n<!-- /rounds -->`));
}
