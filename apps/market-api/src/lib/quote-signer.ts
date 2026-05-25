import type { PrivateKeyAccount } from "viem";
import { keccak256, encodePacked } from "viem";

/// EIP-712 quote signing for agent bet intents.
/// Validity = 30 seconds. Signing key MUST NOT be the gas-paying MARKET_API key —
/// a leaked quote key allows price spoofing but not fund theft.

export const QUOTE_DOMAIN_NAME = "FORUM Market Quote";
export const QUOTE_DOMAIN_VERSION = "1";
export const QUOTE_DOMAIN_CHAIN_ID = 5042002;

export const QUOTE_TYPES = {
  Quote: [
    { name: "marketId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "shares", type: "uint256" }, // WAD
    { name: "costUsdc", type: "uint256" }, // 6-dec
    { name: "feeUsdc", type: "uint256" }, // 6-dec
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type QuoteData = {
  marketId: `0x${string}`;
  outcome: number;
  shares: bigint;
  costUsdc: bigint;
  feeUsdc: bigint;
  validUntil: bigint;
  nonce: `0x${string}`;
};

export type SignedQuote = QuoteData & {
  signature: `0x${string}`;
  signer: `0x${string}`;
  domainSeparatorHash: `0x${string}`;
};

/// Sign a quote. Throws if `validUntil` is in the past or `shares == 0`.
export async function signQuote(account: PrivateKeyAccount, q: QuoteData): Promise<SignedQuote> {
  if (q.shares === 0n) throw new Error("signQuote: shares must be > 0");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (q.validUntil <= nowSec) throw new Error("signQuote: validUntil already passed");

  const domain = {
    name: QUOTE_DOMAIN_NAME,
    version: QUOTE_DOMAIN_VERSION,
    chainId: QUOTE_DOMAIN_CHAIN_ID,
    verifyingContract: account.address,
  } as const;

  const signature = await account.signTypedData({
    domain,
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: q,
  });

  const domainSeparatorHash = keccak256(
    encodePacked(
      ["string", "string", "uint256", "address"],
      [domain.name, domain.version, BigInt(domain.chainId), domain.verifyingContract],
    ),
  );

  return { ...q, signature, signer: account.address, domainSeparatorHash };
}

/// 32-byte random nonce.
export function randomNonce(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return `0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}
