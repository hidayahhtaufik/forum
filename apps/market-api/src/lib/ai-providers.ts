/// AI provider detection + symmetric encryption for owner-supplied LLM keys.
///
/// Two responsibilities:
///   1. `detectProvider(baseUrl)` — best-effort routing of an OpenAI-compatible
///      endpoint URL to its canonical provider id. Used at /agents/spawn and
///      /agents/:address/update when the owner pastes a base URL without
///      explicitly picking a provider.
///   2. `encryptApiKey` / `decryptApiKey` — wraps the owner's API key with
///      AES-256-GCM using the same `TRADER_MASTER_KEY` env used by trader
///      privkeys. Re-using the same master key keeps secret management to
///      ONE rotation surface — losing it loses everything anyway.

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export type AiProvider = "claude" | "openai" | "gemini" | "deepseek" | "xai" | "mimo" | "custom";

const PROVIDER_HOST_PATTERNS: ReadonlyArray<{ provider: AiProvider; host: string }> = [
  { provider: "claude", host: "api.anthropic.com" },
  { provider: "openai", host: "api.openai.com" },
  { provider: "gemini", host: "generativelanguage.googleapis.com" },
  { provider: "deepseek", host: "api.deepseek.com" },
  { provider: "xai", host: "api.x.ai" },
  // MiMo (Xiaomi) — both pay-as-you-go and Token Plan subdomains route to "mimo".
  { provider: "mimo", host: "api.xiaomimimo.com" },
  { provider: "mimo", host: "token-plan-cn.xiaomimimo.com" },
];

/// Returns the canonical provider id for a known base URL host. Anything
/// unrecognized (or an empty string) returns "custom" — the runner will need
/// to be told what shape to call.
export function detectProvider(baseUrl: string | null | undefined): AiProvider {
  if (!baseUrl) return "custom";
  const lower = baseUrl.toLowerCase();
  for (const { provider, host } of PROVIDER_HOST_PATTERNS) {
    if (lower.includes(host)) return provider;
  }
  return "custom";
}

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

export type EncryptedApiKey = {
  /** Hex string of ciphertext (no 0x prefix). */
  ciphertext: string;
  /** Hex string of IV (no 0x prefix). */
  iv: string;
  /** Hex string of 16-byte GCM auth tag. */
  authTag: string;
};

/// Symmetric-encrypt an API key plaintext under TRADER_MASTER_KEY. Returns
/// the hex-encoded ciphertext + iv + tag triple ready to persist.
export function encryptApiKey(plaintext: string): EncryptedApiKey {
  if (!plaintext || plaintext.length === 0) {
    throw new Error("encryptApiKey: empty plaintext");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptApiKey(args: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): string {
  const iv = hexToBuf(args.iv, IV_BYTES);
  const authTag = hexToBuf(args.authTag, 16);
  const ciphertext = hexToBuf(args.ciphertext);
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
