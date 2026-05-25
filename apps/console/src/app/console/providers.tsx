"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";

const ARC_TESTNET = {
  blockExplorerUrls: ["https://testnet.arcscan.app"],
  chainId: 5042002,
  chainName: "Arc Testnet",
  iconUrls: [],
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  networkId: 5042002,
  rpcUrls: ["https://rpc.testnet.arc.network"],
  vanityName: "Arc",
};

// CCTP V2 source chains — needed so the auto-burn flow can request a chain
// switch from the user's wallet via Dynamic.
const ETHEREUM_SEPOLIA = {
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
  chainId: 11155111,
  chainName: "Ethereum Sepolia",
  iconUrls: [],
  name: "Ethereum Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  networkId: 11155111,
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  vanityName: "Sepolia",
};

const BASE_SEPOLIA = {
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  chainId: 84532,
  chainName: "Base Sepolia",
  iconUrls: [],
  name: "Base Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  networkId: 84532,
  rpcUrls: ["https://sepolia.base.org"],
  vanityName: "Base Sepolia",
};

const ARBITRUM_SEPOLIA = {
  blockExplorerUrls: ["https://sepolia.arbiscan.io"],
  chainId: 421614,
  chainName: "Arbitrum Sepolia",
  iconUrls: [],
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  networkId: 421614,
  rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
  vanityName: "Arb Sepolia",
};

export function DynamicProvider({ children }: { children: React.ReactNode }) {
  const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;
  if (!envId) {
    return (
      <div
        className="mono"
        style={{
          padding: 24,
          fontSize: "var(--text-xs)",
          color: "var(--color-tessera-oxblood)",
          border: "1px solid var(--color-tessera-oxblood)",
          borderRadius: 4,
          margin: "32px auto",
          maxWidth: 540,
        }}
      >
        Dynamic not configured: set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID in .env.local.
        See docs/SETUP.md.
      </div>
    );
  }
  return (
    <DynamicContextProvider
      settings={{
        environmentId: envId,
        walletConnectors: [EthereumWalletConnectors],
        // Prioritize injected EOA wallets (MetaMask etc) for users who need
        // EIP-3009 signing (FORUM bet flow). Dria embedded MPC wallets work
        // for browsing + signing but USDC.transferWithAuthorization only
        // validates EOA ecrecover signatures.
        initialAuthenticationMode: "connect-and-sign",
        overrides: {
          evmNetworks: [ARC_TESTNET, ETHEREUM_SEPOLIA, BASE_SEPOLIA, ARBITRUM_SEPOLIA],
        },
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
