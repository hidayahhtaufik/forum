import type { PrivateKeyAccount } from "viem";
import type { Address, Hex, Eip3009Authorization } from "./types.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, USDC_EIP712_DOMAIN } from "./chain.js";

/// Sign an EIP-3009 `transferWithAuthorization` payload for USDC on Arc.
///
/// This is the buyer-side primitive that allows the market-api wallet (or Circle Gateway)
/// to pull USDC from the agent's wallet without a separate `approve` tx — the agent's
/// off-chain signature IS the approval.
///
/// The returned `Eip3009Authorization` includes the signature inline; market-api uses it
/// to call `USDC.transferWithAuthorization(...)` directly.

export type SignedAuthorization = Eip3009Authorization & {
  v: number;
  r: Hex;
  s: Hex;
  signature: Hex;
};

export async function signTransferAuthorization(
  account: PrivateKeyAccount,
  params: {
    to: Address;
    valueUsdc6: bigint;
    validAfter?: number;
    /// Defaults to now + 7 days. Circle's docs recommend ≥ 7 days for Nanopayments.
    validBefore?: number;
    /// 32-byte random nonce — caller should supply the same one used in the BetIntent
    /// so they're linkable on-chain.
    nonce: Hex;
  },
): Promise<SignedAuthorization> {
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = params.validAfter ?? nowSec - 60;
  const validBefore = params.validBefore ?? nowSec + 7 * 24 * 3600;

  if (validBefore <= validAfter) {
    throw new Error("signTransferAuthorization: validBefore must exceed validAfter");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(params.nonce)) {
    throw new Error("signTransferAuthorization: nonce must be 0x + 64 hex (32 bytes)");
  }

  const message = {
    from: account.address,
    to: params.to,
    value: params.valueUsdc6,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: params.nonce,
  } as const;

  const signature = (await account.signTypedData({
    domain: USDC_EIP712_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  })) as Hex;

  const { v, r, s } = decodeRsv(signature);

  return {
    from: account.address,
    to: params.to,
    value: params.valueUsdc6.toString(),
    validAfter,
    validBefore,
    nonce: params.nonce,
    v,
    r,
    s,
    signature,
  };
}

/// Split a 65-byte signature into (r, s, v). Normalises legacy v ∈ {0, 1} to {27, 28}.
export function decodeRsv(sig: Hex): { v: number; r: Hex; s: Hex } {
  if (sig.length !== 132) {
    throw new Error(`decodeRsv: signature must be 65 bytes (0x + 130 hex), got ${sig.length - 2}`);
  }
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

/// Generate a 32-byte random nonce as 0x + 64 hex.
export function randomNonce(): Hex {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return `0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}
