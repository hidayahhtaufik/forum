import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

/// Custodial trader-wallet crypto. Each FORUM identity gets a fresh EOA — the
/// 32-byte privkey is AES-256-GCM encrypted at rest using TRADER_MASTER_KEY.
///
/// Why custodial? USDC EIP-3009 on Arc only supports ecrecover (raw ECDSA). Smart
/// wallets (Dynamic Dria / Safe / Argent) can't sign EIP-3009 messages that the
/// USDC contract will accept. Polymarket and Kalshi solve this exactly the same
/// way: generate a fresh EOA per user, custody server-side, treat it as the
/// trader's funded account.
///
/// Security model:
///   - TRADER_MASTER_KEY is a 32-byte hex string in env (NEVER committed).
///   - Each privkey encrypted with its own random 12-byte IV (stored alongside).
///   - 16-byte GCM auth tag stored separately — tampering breaks decryption.
///   - Loss of TRADER_MASTER_KEY = loss of all trader balances. Back it up.

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

function hexToBuf(hex: string, expectedBytes?: number): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = Buffer.from(clean, "hex");
  if (expectedBytes !== undefined && buf.length !== expectedBytes) {
    throw new Error(`expected ${expectedBytes} bytes, got ${buf.length}`);
  }
  return buf;
}

function masterKey(): Buffer {
  const raw = process.env["TRADER_MASTER_KEY"];
  if (!raw) {
    throw new Error("TRADER_MASTER_KEY not set — generate with: openssl rand -hex 32");
  }
  return hexToBuf(raw, KEY_BYTES);
}

export type GeneratedTrader = {
  address: `0x${string}`;
  /** Hex string of ciphertext (no 0x prefix). */
  encryptedPrivkey: string;
  /** Hex string of IV (no 0x prefix). */
  iv: string;
  /** Hex string of 16-byte GCM auth tag. */
  authTag: string;
};

/// Mint a fresh EOA, encrypt the privkey under TRADER_MASTER_KEY. Returns the
/// address + ciphertext bundle ready to persist.
export function generateTrader(): GeneratedTrader {
  const privkey = generatePrivateKey();
  const account = privateKeyToAccount(privkey);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(hexToBuf(privkey, 32)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    address: account.address,
    encryptedPrivkey: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/// Reverse of generateTrader. Returns the raw privkey hex (0x-prefixed) for
/// passing to viem `privateKeyToAccount`. Throws on auth-tag mismatch or wrong
/// master key.
export function decryptTraderPrivkey(args: {
  encryptedPrivkey: string;
  iv: string;
  authTag: string;
}): `0x${string}` {
  const iv = hexToBuf(args.iv, IV_BYTES);
  const authTag = hexToBuf(args.authTag, 16);
  const ciphertext = hexToBuf(args.encryptedPrivkey);

  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plain.length !== KEY_BYTES) {
    throw new Error(`decrypted privkey wrong length: ${plain.length}`);
  }
  return ("0x" + plain.toString("hex")) as `0x${string}`;
}
