import { z } from "zod";

/// Zod schema for all env vars market-api reads at boot. Fail-loud on missing/malformed:
/// the process exits with a clear message rather than running half-configured.

const HexKey = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be 0x + 64 hex (private key)");
const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x + 40 hex (EVM address)");
const Hex32NoPrefix = z.string().regex(/^[a-fA-F0-9]{64}$/, "must be 64 hex chars (no 0x)");

const Schema = z.object({
  // Arc Testnet. ARC_RPC_URL is the primary endpoint; ARC_RPC_URL_FALLBACK is
  // tried next if the primary errors or times out. With both set, viem's
  // `fallback` transport rotates between them — drpc free-tier mempools fill
  // up under heavy multi-agent traffic, so we pair Alchemy (primary, paid)
  // with the Arc-published public RPC (failover) for resilience.
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_RPC_URL_FALLBACK: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().url().optional(),
    ),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  ARC_USDC: EvmAddress.default("0x3600000000000000000000000000000000000000"),
  // EURC on Arc Testnet — second collateral option for prediction markets so
  // we hit Agora RFB 03 ("USDC ↔ EURC pairing") with first-class support.
  ARC_EURC: EvmAddress.default("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"),

  // Service wallets
  MARKET_API_PRIVATE_KEY: HexKey, // pays gas for buyShares + createMarket
  MARKET_QUOTE_PRIVATE_KEY: HexKey, // signs EIP-712 backend quotes
  RESOLVER_ADMIN_PRIVATE_KEY: HexKey, // signs Resolution payloads (held by resolver service)
  // 32-byte hex (no 0x) — encrypts custodial trader wallets at rest. Generate with `openssl rand -hex 32`.
  TRADER_MASTER_KEY: Hex32NoPrefix,
  // P1-F-004 — HMAC secret applied to the raw identity ("email:user@x.com" or
  // "wallet:0x…") before it becomes a trader-table primary key. Stops trivial
  // enumeration: a leaked DB still requires this server-side secret to map an
  // address back to its identity. Generate with `openssl rand -hex 32`.
  IDENTITY_HMAC_SECRET: z.string().min(32),

  // Circle Gateway
  CIRCLE_GATEWAY_FACILITATOR_URL: z.string().url().default("https://gateway-api-testnet.circle.com"),
  SELLER_WALLET_ADDRESS: EvmAddress,

  // M7 — CCTP V2 on Arc Testnet. Verified addresses from docs.arc.network.
  // MessageTransmitterV2 is what we call `receiveMessage` on to finalize a
  // burn-and-mint coming from any other CCTP V2 chain (Base, Ethereum, OP,
  // Arbitrum, Polygon). TokenMessengerV2 is the *source-side* contract users
  // call on Base — we surface it in the burn-config endpoint for the UI.
  ARC_CCTP_MESSAGE_TRANSMITTER: EvmAddress.default("0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"),
  ARC_CCTP_TOKEN_MESSENGER: EvmAddress.default("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"),
  // Circle's attestation service. Sandbox for testnets; mainnet uses
  // https://iris-api.circle.com. Default is the sandbox since Arc Testnet
  // is a testnet — flip in env when we move to Arc mainnet.
  CIRCLE_IRIS_API_URL: z.string().url().default("https://iris-api-sandbox.circle.com"),

  // DB driver — switchable. See apps/market-api/src/db/index.ts.
  //   - Default (sqlite fallback for demo week): `./data/forum.db` (or any
  //     filesystem path / `file:...` / `sqlite:...`).
  //   - Postgres production: `postgres://user:pass@host:5432/dbname` or
  //     `postgresql://...`. Driver auto-detected from the scheme.
  DATABASE_URL: z.string().default("./data/forum.db"),

  // Server. Prefer MARKET_API_PORT over PORT so co-deployed services on the same VPS
  // can each pick their own port without colliding on a shared PORT env.
  MARKET_API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8403),
  HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // P2-B-004 — admin-only mutations (/admin/sync-market, /admin/resolve) require
  // this shared secret in x-admin-secret. Generate with `openssl rand -hex 32`.
  ADMIN_SECRET: z.string().min(16).optional(),

  // P3 — demo affordance toggled by PersonaAiDrawer's "Use FORUM's shared MiMo
  // key" pill. Declared here so a malformed value would fail-loud at boot.
  FORUM_DEMO_MIMO_KEY: z.string().optional(),

  // P0-B audit constraint — forum-personas runner is server-side and has no
  // Dynamic wallet. Two paths the audit accepted: (a) shared secret bypass,
  // or (b) runner signs with agent privkey. We use (a): when X-Runner-Secret
  // matches this value, requireTraderAuth() short-circuits. Only set on the
  // server-side runner's process env, never on the public-facing market-api.
  // Generate with `openssl rand -hex 32`.
  RUNNER_AUTH_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    // Render a human-readable error and crash fast.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment for @forum/market-api:\n${issues}`);
  }
  return parsed.data;
}
