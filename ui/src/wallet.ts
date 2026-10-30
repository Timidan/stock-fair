import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { robinhood } from "./chain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// Follows the account the wallet has open for this site, so switching accounts never leaves another account's balances on the page.
export function watchAccount(onChange: (account: Address | null) => void) {
  const { ethereum } = window;
  if (!ethereum) return;
  const update = (accounts: readonly Address[]) => onChange(accounts[0] ?? null);
  ethereum.request({ method: "eth_accounts" }).then(update).catch(() => {});
  ethereum.on?.("accountsChanged", update);
  return () => ethereum.removeListener?.("accountsChanged", update);
}

// Forgets this site in wallets that support it, so a reload doesn't reconnect.
export const disconnect = () => window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});

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
