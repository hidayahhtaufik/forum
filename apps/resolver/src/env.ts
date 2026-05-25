import { z } from "zod";

const HexKey = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const Schema = z.object({
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),

  /// EOA whose signature Resolver.admin accepts. The CONTRACT was initialized with
  /// this address; rotating it requires `Resolver.setAdmin` from the contract owner.
  RESOLVER_ADMIN_PRIVATE_KEY: HexKey,

  /// market-api endpoint, used to discover open markets to resolve.
  MARKET_API_URL: z.string().url().default("http://127.0.0.1:8403"),

  /// Shared secret for /admin/sync-market calls. Resolver fires those when it
  /// sees an on-chain RESOLVED market whose DB row is still phase=0 (because
  /// an earlier resolve tick's notify roundtrip failed). Optional — without
  /// it, the resolver still resolves new markets; just won't auto-heal stuck
  /// DB rows. Must match ADMIN_SECRET on market-api.
  ADMIN_SECRET: z.string().optional(),

  /// How often to poll for markets that have hit `closesAt`. Defaults to 10s
  /// so the resolved banner lands within ~10–15s of the close timestamp.
  /// Old default (60s) made the lag obvious to demo viewers.
  RESOLVER_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(10_000),

  /// Grace period after closesAt before we attempt resolution. Tightened from
  /// 30s to 5s so resolution timestamp tracks closesAt closely. ECB data is
  /// already past by the time closesAt is reached, so the buffer is mostly
  /// concurrency contention insurance — 5s is plenty.
  RESOLVER_GRACE_MS: z.coerce.number().int().min(0).default(5_000),

  /// Where the deployer wrote contract addresses (relative or absolute). The path
  /// resolution mirrors apps/market-api/src/deployment.ts.
  DEPLOYMENT_PATH: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment for @forum/resolver:\n${issues}`);
  }
  return parsed.data;
}
