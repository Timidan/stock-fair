import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { robinhood } from "./chain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export async function connect() {
  if (!window.ethereum) throw new Error("No wallet found. Install a browser wallet to vote.");
  const wallet = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  try {
    await wallet.switchChain({ id: robinhood.id });
  } catch {
    await wallet.addChain({ chain: robinhood });
  }
  return { wallet, account: account as Address };
}
