import { defineChain } from "viem";

/// Viem chain config for Arc Testnet. USDC is the native gas currency, so we declare
/// nativeCurrency accordingly even though Viem doesn't model 6-dec native well.
/// On Arc, gas estimation is paid in USDC base units; viem returns the raw bigint and
/// callers convert with `formatUnits(value, 6)` for display.

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
