import { createPublicClient, defineChain, http, parseAbi, type Abi, type Address } from "viem";
import abi from "./abi.json";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const params = new URLSearchParams(location.search);
// VITE_RPC (or ?rpc=) points the app at a local fork for demos; production uses the public RPC.
export const client = createPublicClient({ chain: robinhood, transport: http(import.meta.env.VITE_RPC || params.get("rpc") || undefined) });

export const WIF: Address = "0x5173b8eA6923c2d40267890D45C46a3480954773";
export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
// Empty until the contract is deployed; the page then shows live prices and no round.
export const STOCK_FAIR = (import.meta.env.VITE_STOCK_FAIR || params.get("fair") || "") as Address | "";

export type Asset = { symbol: string; name: string; feed: Address };

// Chainlink proxies on chain 4663, read 26 Oct 2026 (8 decimals, multiplier already applied).
export const ASSETS: Asset[] = [
  { symbol: "AAPL", name: "Apple", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  { symbol: "NVDA", name: "Nvidia", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  { symbol: "TSLA", name: "Tesla", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  { symbol: "SPY", name: "S&P 500", feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A" },
];

export const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

// Exported from contracts/out by `npm run abi`; Astra owns the source.
export const stockFairAbi = abi as Abi;

export const explorerTx = (hash: string) => `${robinhood.blockExplorers.default.url}/tx/${hash}`;
