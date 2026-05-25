/// Arc Testnet constants — kept inline so the SDK doesn't take a heavy chain config dep.
/// (Mirror of apps/market-api/src/chain/arc.ts; intentional duplication for SDK independence.)

import type { Address, Hex } from "./types.js";

export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network" as const;
export const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app" as const;

export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
export const ARC_EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
export const ARC_USYC: Address = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C";

/// EIP-712 domain for USDC's `transferWithAuthorization` on Arc. The version comes from
/// Circle's USDC v2 contract — verified empirically by AUREUS Day 2 probes.
export const USDC_EIP712_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: ARC_TESTNET_CHAIN_ID,
  verifyingContract: ARC_USDC,
} as const;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/// 6-decimal USDC <-> WAD (1e18) precision helpers. The SDK uses bigint everywhere
/// internally and converts at the boundary.

export function usdcToWad(usdc6: bigint): bigint {
  return usdc6 * 10n ** 12n;
}

export function wadToUsdc(wad: bigint): bigint {
  return wad / 10n ** 12n;
}

/// Parse a decimal USDC string like "1.50" into 6-dec base units (1_500_000n). Throws on
/// malformed input.
export function parseUsdc(s: string): bigint {
  const m = s.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!m) throw new Error(`parseUsdc: malformed amount "${s}"`);
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").padEnd(6, "0");
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

export function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function arcExplorerTx(hash: Hex): string {
  return `${ARC_TESTNET_EXPLORER}/tx/${hash}`;
}

/// Minimal ABI subsets needed by SDK for agent-side reads + claim.
export const FOREX_MARKET_ABI = [
  {
    type: "function",
    name: "phase",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "winningOutcome",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "marketId",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "outcomeToken",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "outcome", type: "uint8" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [{ name: "payout", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export const OUTCOME_TOKEN_ABI = [
  {
    type: "function",
    name: "tokenIdOf",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;
