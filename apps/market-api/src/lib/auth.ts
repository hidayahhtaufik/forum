/// EIP-712 challenge-response identity proof for privileged endpoints.
///
/// Why: 9 trader-controlled endpoints decrypt a server-held privkey + broadcast
/// on-chain transactions. Without an identity gate, possession of a trader
/// address is sufficient to drain it (P0-B-001..009 in docs/SECURITY_AUDIT.md).
///
/// Model: each trader_wallets row binds (a) a server-custodied trader EOA to
/// (b) the user's "owner_wallet" — the externally-controlled wallet (Rabby,
/// MetaMask, or Dynamic Dria embedded) that authenticated when /traders/issue
/// first minted the trader. The client signs an EIP-712 message with the owner
/// wallet; the server recovers the signer and verifies signer === owner_wallet.
///
/// Server-side runners (forum-personas) hold the trader privkey themselves —
/// they sign challenges with the trader's own key. signer === traderAddress
/// is accepted as a second valid path so the runner flow keeps working.
///
/// Replay protection: each (identity, nonce) tuple is single-use. Nonces
/// expire after CHALLENGE_TTL_MS. Stored in-memory; market-api is a single
/// process behind 127.0.0.1, so we don't need to share state across instances.

import { recoverTypedDataAddress } from "viem";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches audit spec
const GC_INTERVAL_MS = 60 * 1000;       // sweep expired entries every minute

type Challenge = { identity: string; nonce: string; expiresAt: number; used: boolean };

const challenges = new Map<string, Challenge>();

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of challenges) {
    if (c.expiresAt < now) challenges.delete(k);
  }
}, GC_INTERVAL_MS).unref?.();

/// Mint a fresh challenge. identity is the lowercased trader address (the
/// thing the caller wants to act on). The returned nonce is a 32-byte hex
/// string the client must include in the typed-data message it signs.
export function createChallenge(identity: string): { nonce: string; expiresAt: number } {
  const ident = identity.toLowerCase();
  const nonce = "0x" + [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(`${ident}:${nonce}`, { identity: ident, nonce, expiresAt, used: false });
  return { nonce, expiresAt };
}

/// Build the EIP-712 typed-data the client must sign. Domain pins the
/// FORUM market-api so a sig harvested elsewhere can't cross-bind here.
export function authTypedData(args: {
  identity: string;
  nonce: string;
  expiresAt: number;
  chainId: number;
}) {
  return {
    domain: {
      name: "FORUM market-api",
      version: "1",
      chainId: args.chainId,
    },
    types: {
      AuthChallenge: [
        { name: "identity", type: "address" },
        { name: "nonce", type: "bytes32" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    primaryType: "AuthChallenge" as const,
    message: {
      identity: args.identity as `0x${string}`,
      nonce: args.nonce as `0x${string}`,
      expiresAt: BigInt(args.expiresAt),
    },
  };
}

export type VerifyResult =
  | { ok: true; signer: string }
  | { ok: false; status: 401; message: string };

/// Verify an X-Auth-Signature header for a privileged request targeting
/// `traderAddress`. Returns the recovered signer on success, a structured
/// error on failure. Caller is responsible for ensuring `signer` matches
/// the trader's authorized owner (see verifyOwnsTrader below).
export async function verifyAuthHeader(args: {
  traderAddress: string;
  nonce: string | undefined;
  signature: string | undefined;
  chainId: number;
}): Promise<VerifyResult> {
  const ident = args.traderAddress.toLowerCase();
  if (!args.nonce || !args.signature) {
    return { ok: false, status: 401, message: "missing X-Auth-Nonce or X-Auth-Signature" };
  }
  if (!/^0x[a-f0-9]{64}$/i.test(args.nonce)) {
    return { ok: false, status: 401, message: "X-Auth-Nonce must be 0x + 64 hex" };
  }
  if (!/^0x[a-f0-9]{130}$/i.test(args.signature)) {
    return { ok: false, status: 401, message: "X-Auth-Signature must be 0x + 130 hex" };
  }
  const key = `${ident}:${args.nonce.toLowerCase()}`;
  const challenge = challenges.get(key);
  if (!challenge) return { ok: false, status: 401, message: "challenge not found or expired" };
  if (challenge.used) return { ok: false, status: 401, message: "challenge already used" };
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(key);
    return { ok: false, status: 401, message: "challenge expired" };
  }
  let signer: `0x${string}`;
  try {
    signer = await recoverTypedDataAddress({
      ...authTypedData({
        identity: ident,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        chainId: args.chainId,
      }),
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return { ok: false, status: 401, message: "signature recovery failed" };
  }
  // Burn the nonce — single-use even on failed authorization to prevent grind.
  challenge.used = true;
  return { ok: true, signer: signer.toLowerCase() };
}

/// Check if `signer` is authorized to act on `traderAddress`. Two paths:
///   1. Server-side runner — signer === traderAddress (the privkey itself).
///   2. End user — signer === trader_wallets.owner_wallet (set at /traders/issue).
/// `ownerWallet` is the value loaded from the DB row.
export function signerOwnsTrader(args: {
  signer: string;
  traderAddress: string;
  ownerWallet: string | null;
}): boolean {
  const s = args.signer.toLowerCase();
  if (s === args.traderAddress.toLowerCase()) return true;
  if (args.ownerWallet && s === args.ownerWallet.toLowerCase()) return true;
  return false;
}
