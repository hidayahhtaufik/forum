#!/usr/bin/env tsx
/// FORUM market-keeper
///
/// Keeps two arenas populated in parallel:
///   1. EUR/USD timeframe markets (5m/15m/1h/4h/24h) — see ECB loop below
///   2. Trace markets for the 5 reference agents (Oracle/Mirror/Sage/Hermes/
///      Augur), 24h window, 50% win-rate threshold
/// So judges (and traders) never hit a "no markets" empty state in either tab.
///
/// EUR/USD loop: every KEEPER_POLL_SECONDS the keeper asks /markets?status=open
/// for the active set, buckets them by close-minus-open duration, and for every
/// configured timeframe with zero OPEN markets it snapshots the current ECB
/// EUR/USD reference rate (Frankfurter, same source the resolver uses) and
/// POSTs /markets with a GTE strike pinned to that rate.
///
/// Trace loop: same tick. GET /trace-markets?status=open, group by targetAgent,
/// and POST /trace-markets for any reference agent that doesn't already have an
/// OPEN market. Backend dedupes by (target, threshold, opensAt-second) — re-runs
/// return `{ deduped: true, ... }` instead of inserting.
///
/// Source-of-truth: ECB reference rate via api.frankfurter.app. The resolver
/// uses the SAME endpoint at close-time, so strikes line up with what the
/// market will eventually be settled against.
///
/// Env (read from process.env, NOT auto-loaded — caller sources .env first):
///   MARKET_API_URL                 defaults to http://127.0.0.1:8403
///   KEEPER_POLL_SECONDS            defaults to 60   (tick cadence)
///   KEEPER_TIMEFRAMES              defaults to "5m,15m,1h,4h,24h"
///                                  (comma-separated; supports {N}m, {N}h, {N}d)
///   KEEPER_LIQUIDITY_SUBSIDY_USDC  defaults to "0.2"  (per-side; doubled for
///                                  the on-chain LMSR subsidy so both YES + NO
///                                  start liquid — 0.4 USDC/market total)
///   KEEPER_DRY_RUN                 "true" = log intent only, never POST
///   KEEPER_LABEL                   defaults to "forum-keeper" (log prefix)
///   KEEPER_TRACE_ENABLED           "true" (default) = run trace loop too
///   KEEPER_TRACE_AGENTS            comma-separated 0x… addresses (defaults to
///                                  the 5 reference agents Oracle/Mirror/Sage/
///                                  Hermes/Augur)
///   KEEPER_TRACE_THRESHOLD_BPS     defaults to "5000" (50% win-rate threshold)
///   KEEPER_TRACE_WINDOW_SECONDS    defaults to "86400" (24h); converted to
///                                  windowHours for the market-api payload
///
/// PM2 entry: see ecosystem.config.cjs → agentApp("keeper", "forum-keeper").

type Timeframe = {
  /** Human label like "5m" / "24h". Used in logs + question text. */
  label: string;
  /** Window length in seconds. Becomes closesAt - opensAt. */
  seconds: number;
};

type MarketRow = {
  id: string;
  pair: string;
  opensAt: number;
  closesAt: number;
  phase: number;
};

const DEFAULT_TIMEFRAMES = "5m,15m,1h,4h,24h";
/// Pairs the keeper rotates through every tick. Each pair owns its own
/// timeframe coverage check + ECB/BoC reference rate fetcher. Markets are
/// auto-resolved by the resolver service against the same source at close,
/// so strikes and resolutions stay self-consistent.
type PairCode = "EURUSD" | "CADUSD";
type PairConfig = {
  /** Wire-protocol code that ends up on-chain in markets.pair */
  code: PairCode;
  /** Display label inside the on-chain question string */
  display: string;
  /** Function that returns the current spot rate from the authoritative source */
  fetchRate: () => Promise<number>;
  /** Human-readable source attribution for logs */
  sourceLabel: string;
};
const COMPARATOR: "GTE" = "GTE";
/// Matches the LMSR b parameter every other market on FORUM uses. Keeps cost
/// curves comparable across the keeper-created arena and the scout-created
/// news-driven markets.
const B_WAD = "100000000000000000000";
const CREATED_BY = "auto-keeper";
/// ±5% tolerance when bucketing an OPEN market into a timeframe. Accounts for
/// the few seconds of drift between the keeper's tick and the on-chain block
/// timestamp that ends up in markets.opens_at / closes_at.
const DURATION_TOLERANCE = 0.05;

function parseTimeframe(token: string): Timeframe | null {
  const m = token.trim().match(/^(\d+)([mhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n * 86400;
  return { label: `${n}${unit}`, seconds };
}

/// Frankfurter.app — public, no-auth ECB reference rate. Same endpoint the
/// resolver uses, so the strike we lock here matches whatever the resolver
/// will fetch at close-time.
async function fetchEcbEurUsd(): Promise<number> {
  const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
  const json = (await res.json()) as { rates?: Record<string, number> };
  const rate = json.rates?.["USD"];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`frankfurter: no USD rate in response`);
  }
  return rate;
}

/// Bank of Canada Valet API — official source for CAD/USD, no auth required.
/// FXUSDCAD is the daily noon rate of USD-per-CAD; we invert it to get the
/// CAD/USD figure used by FORUM markets ("Will CAD/USD ≥ 0.7283 by …").
/// Same series the resolver hits at close-time, so strikes resolve cleanly.
async function fetchBocCadUsd(): Promise<number> {
  const res = await fetch(
    "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1",
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`bankofcanada HTTP ${res.status}`);
  const json = (await res.json()) as { observations?: Array<{ FXUSDCAD?: { v: string } }> };
  const usdcad = Number(json.observations?.[0]?.FXUSDCAD?.v);
  if (!Number.isFinite(usdcad) || usdcad <= 0) {
    throw new Error("bankofcanada: malformed FXUSDCAD observation");
  }
  return 1 / usdcad;
}

const PAIR_CONFIGS: PairConfig[] = [
  {
    code: "EURUSD",
    display: "EUR/USD",
    fetchRate: fetchEcbEurUsd,
    sourceLabel: "ECB (Frankfurter)",
  },
  {
    code: "CADUSD",
    display: "CAD/USD",
    fetchRate: fetchBocCadUsd,
    sourceLabel: "BoC Valet",
  },
];

/// Convert a floating-point rate (e.g. 1.0834) into the 1e18-scaled bigint
/// string the contracts expect. We round to 6 decimals first so floating point
/// jitter doesn't ripple into the strike.
function rateToWad(rate: number): string {
  const rounded = Math.round(rate * 1_000_000) / 1_000_000;
  // Build the WAD without going through Number to dodge precision loss for
  // values close to JS_MAX_SAFE_INTEGER. 1e18 * 1.0834 = 1.0834e18, well
  // within safe range, but the BigInt path is the convention used elsewhere.
  const scaled = BigInt(Math.round(rounded * 1e6)) * 10n ** 12n;
  return scaled.toString();
}

function displayRate(rate: number): string {
  return rate.toFixed(4);
}

/// Generate a strike that sits OFF the current spot by a randomized
/// pip offset. Critical because ECB / BoC publish daily noon fixes —
/// without offset, every market's strike = spot rate at creation, and
/// the same daily-fix at resolution time, so `GTE` always evaluates
/// TRUE → every market resolves YES, no real prediction value.
///
/// We pick a uniformly-random offset in the range ±MAX_PIPS, then
/// quantize to whole pips so the strike reads cleanly (e.g. 1.0875
/// not 1.08753218).
///
/// For EUR/USD a pip = 0.0001. For CAD/USD inverted (~0.73) one pip
/// still = 0.0001 (4 dp convention). At ±50 pips we land between
/// "very likely YES" (-50p) and "very likely NO" (+50p), with the
/// 50/50 markets concentrated near 0.
function jitterStrike(spot: number, maxPips: number = 50): number {
  const pipsOffset = Math.floor((Math.random() * 2 - 1) * maxPips);
  const pip = 0.0001;
  const offset = pipsOffset * pip;
  return Math.round((spot + offset) * 10_000) / 10_000;
}

/// Format a unix timestamp into a "23 May 14:23 UTC" human-readable
/// label for embedding inside the on-chain market question. The earlier
/// version stuffed Date.toISOString() into the question string, which
/// produced "...at 2026-05-23T14:23:00.000Z?" — the 00z suffix readers
/// asked us to drop.
function formatMarketCloseLabel(unix: number): string {
  const d = new Date(unix * 1000);
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${dd} ${mon} ${hh}:${mm} UTC`;
}

/// Headers for admin-gated market-api endpoints. Keeper creates markets +
/// trace markets on a recurring schedule; market-api gates these endpoints
/// behind x-runner-secret to prevent treasury drain by external callers.
function adminHeaders(): Record<string, string> {
  const secret = process.env["RUNNER_AUTH_SECRET"];
  if (!secret) {
    throw new Error("RUNNER_AUTH_SECRET missing — keeper cannot create markets without it");
  }
  return {
    "Content-Type": "application/json",
    "x-runner-secret": secret,
  };
}

async function listOpenMarkets(marketApiURL: string): Promise<MarketRow[]> {
  const res = await fetch(`${marketApiURL}/markets?status=open`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET /markets ${res.status}`);
  const json = (await res.json()) as { markets?: MarketRow[] };
  return Array.isArray(json.markets) ? json.markets : [];
}

/// True iff `market` is an OPEN market on the given pair whose duration matches
/// `tf` within DURATION_TOLERANCE. The pair + duration check is what lets us
/// bucket the existing arena into per-(pair × timeframe) slots without a
/// dedicated DB column.
function matchesTimeframe(market: MarketRow, pair: PairCode, tf: Timeframe): boolean {
  if (market.pair?.toUpperCase() !== pair) return false;
  const duration = market.closesAt - market.opensAt;
  if (duration <= 0) return false;
  const drift = Math.abs(duration - tf.seconds) / tf.seconds;
  return drift <= DURATION_TOLERANCE;
}

type CreateResponse = {
  marketId: string;
  marketAddress: string;
  txHash: string;
  /// Present when market-api matched an existing (pair, opensAt, closesAt) row
  /// instead of creating a new one. Same shape otherwise.
  deduped?: boolean;
};

async function createMarket(
  marketApiURL: string,
  pair: PairConfig,
  tf: Timeframe,
  rate: number,
  subsidyUsdcBaseUnits: string,
): Promise<CreateResponse | { skipped: "exists" }> {
  const now = Math.floor(Date.now() / 1000);
  const opensAt = now;
  const closesAt = now + tf.seconds;
  // Strike is OFFSET from current spot, not pinned to it — see jitterStrike
  // comment above for why. This is what makes the prediction non-trivial.
  const strike = jitterStrike(rate);
  const strikeWad = rateToWad(strike);
  const question = `Will ${pair.display} ≥ ${displayRate(strike)} by ${formatMarketCloseLabel(closesAt)}?`;

  const body = {
    question,
    pair: pair.code,
    strikeWad,
    comparator: COMPARATOR,
    bWad: B_WAD,
    opensAt,
    closesAt,
    subsidyUsdc: subsidyUsdcBaseUnits,
    createdBy: CREATED_BY,
  };

  const res = await fetch(`${marketApiURL}/markets`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  // market-api hashes (question, closesAt) and 409s on collision. Treat that
  // as a benign "another tick raced us" outcome — the slot is now covered.
  if (res.status === 409) return { skipped: "exists" };

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /markets ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as CreateResponse;
}

/// Treasury balance pre-check via /protocol/stats. Logs a WARN when the
/// market-api wallet doesn't have enough USDC to subsidize at least one more
/// market (subsidyUsdc base units × 1 market). Doesn't throw — keeper keeps
/// running so the operator sees the warning AND any subsequent create errors.
async function readTreasuryUsdc(marketApiURL: string): Promise<bigint | null> {
  try {
    const res = await fetch(`${marketApiURL}/protocol/stats`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { treasuryBalance?: string };
    if (typeof json.treasuryBalance !== "string") return null;
    return BigInt(json.treasuryBalance);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace markets — 5 reference agents, 24h windows, 50% threshold.
// ─────────────────────────────────────────────────────────────────────────────

/// Reference agents on Arc testnet. Names are display-only (logs); the address
/// is what market-api stores + dedupes on. Edit KEEPER_TRACE_AGENTS to override.
const REFERENCE_AGENTS: ReadonlyArray<{ name: string; address: string }> = [
  { name: "Oracle", address: "0xd04d955c9989982e76cfb6287affd97acbe0ae2f" },
  { name: "Mirror", address: "0x24018ec27dbc3f5805d19b7d6f89d83eba7ef85a" },
  { name: "Sage", address: "0x2344d1fcb82c1dfe9d3de49ddfdd2878bbfbdff0" },
  { name: "Hermes", address: "0xce78b7f1016aff9db58de3d986e8cd36262bcf90" },
  { name: "Augur", address: "0x1ffd8313bb45ccdfdf151e194f2bc8e8293206af" },
];

type TraceAgent = { name: string; address: string };

type TraceMarketRow = {
  id: string;
  targetAgent: string;
  thresholdBps: number;
  phase: number;
  opensAt: number;
  closesAt: number;
};

type TraceCreateResponse = {
  id: string;
  targetAgent: string;
  thresholdBps: number;
  windowHours: number;
  opensAt: number;
  closesAt: number;
  phase: number;
  /// Present when market-api deduped against an existing open market.
  deduped?: boolean;
};

async function listOpenTraceMarkets(marketApiURL: string): Promise<TraceMarketRow[]> {
  const res = await fetch(`${marketApiURL}/trace-markets?status=open`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET /trace-markets ${res.status}`);
  const json = (await res.json()) as { traceMarkets?: TraceMarketRow[] };
  return Array.isArray(json.traceMarkets) ? json.traceMarkets : [];
}

async function createTraceMarket(
  marketApiURL: string,
  agent: TraceAgent,
  thresholdBps: number,
  windowHours: number,
): Promise<TraceCreateResponse> {
  // market-api derives opensAt + closesAt server-side from `now`; the schema
  // only accepts targetAgent + thresholdBps + windowHours (see /trace-markets
  // POST handler in apps/market-api/src/app.ts).
  const body = { targetAgent: agent.address, thresholdBps, windowHours };
  const res = await fetch(`${marketApiURL}/trace-markets`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /trace-markets ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TraceCreateResponse;
}

function parseTraceAgents(raw: string | undefined): TraceAgent[] {
  if (!raw || raw.trim() === "") return [...REFERENCE_AGENTS];
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  if (fromEnv.length === 0) return [...REFERENCE_AGENTS];
  // Preserve display names where we recognise the address; fall back to a
  // shortened hex label so logs stay readable for ad-hoc overrides.
  const byAddr = new Map(REFERENCE_AGENTS.map((a) => [a.address.toLowerCase(), a.name]));
  return fromEnv.map((addr) => ({
    name: byAddr.get(addr) ?? `${addr.slice(0, 8)}…`,
    address: addr,
  }));
}

function main() {
  const marketApiURL = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";
  const pollSeconds = Number(process.env["KEEPER_POLL_SECONDS"] ?? "60");
  const timeframesRaw = process.env["KEEPER_TIMEFRAMES"] ?? DEFAULT_TIMEFRAMES;
  const subsidyPerSide = Number(process.env["KEEPER_LIQUIDITY_SUBSIDY_USDC"] ?? "0.2");
  const dryRun = process.env["KEEPER_DRY_RUN"] === "true";
  const label = process.env["KEEPER_LABEL"] ?? "forum-keeper";

  // Trace loop config. Default ON — the trace arena is one of the two demo
  // surfaces we need populated tomorrow. Disable with KEEPER_TRACE_ENABLED=false.
  const traceEnabled = (process.env["KEEPER_TRACE_ENABLED"] ?? "true") !== "false";
  const traceAgents = parseTraceAgents(process.env["KEEPER_TRACE_AGENTS"]);
  const traceThresholdBps = Number(process.env["KEEPER_TRACE_THRESHOLD_BPS"] ?? "5000");
  const traceWindowSeconds = Number(process.env["KEEPER_TRACE_WINDOW_SECONDS"] ?? "86400");

  const timeframes = timeframesRaw
    .split(",")
    .map((t) => parseTimeframe(t))
    .filter((t): t is Timeframe => t !== null);

  if (timeframes.length === 0) {
    throw new Error(`KEEPER_TIMEFRAMES parsed to empty list from "${timeframesRaw}"`);
  }
  if (!Number.isFinite(pollSeconds) || pollSeconds < 10) {
    throw new Error(`KEEPER_POLL_SECONDS must be >= 10 (got "${pollSeconds}")`);
  }
  if (!Number.isFinite(subsidyPerSide) || subsidyPerSide <= 0) {
    throw new Error(`KEEPER_LIQUIDITY_SUBSIDY_USDC must be > 0 (got "${subsidyPerSide}")`);
  }

  // market-api enforces 100..=9900 on thresholdBps and 6..=720 on windowHours.
  // Validate here so a typo fails loudly at boot rather than on every tick.
  if (traceEnabled) {
    if (!Number.isFinite(traceThresholdBps) || traceThresholdBps < 100 || traceThresholdBps > 9_900) {
      throw new Error(`KEEPER_TRACE_THRESHOLD_BPS must be 100..=9900 (got "${traceThresholdBps}")`);
    }
    if (!Number.isFinite(traceWindowSeconds) || traceWindowSeconds < 3600) {
      throw new Error(`KEEPER_TRACE_WINDOW_SECONDS must be >= 3600 (got "${traceWindowSeconds}")`);
    }
    if (traceWindowSeconds % 3600 !== 0) {
      throw new Error(`KEEPER_TRACE_WINDOW_SECONDS must be a whole number of hours (got "${traceWindowSeconds}")`);
    }
    if (traceAgents.length === 0) {
      throw new Error(`KEEPER_TRACE_AGENTS parsed to empty list`);
    }
  }
  const traceWindowHours = Math.floor(traceWindowSeconds / 3600);
  if (traceEnabled && (traceWindowHours < 6 || traceWindowHours > 720)) {
    throw new Error(`KEEPER_TRACE_WINDOW_SECONDS → windowHours must be 6..=720 (got "${traceWindowHours}")`);
  }

  // LMSR subsidy seeds both outcomes from one pot, so we double the per-side
  // figure for the on-chain `subsidyUsdc6` argument. 5 per side → 10 USDC total.
  const subsidyTotalBaseUnits = String(Math.floor(subsidyPerSide * 2 * 1_000_000));

  console.log(`[${label}] online`);
  console.log(`  market-api:           ${marketApiURL}`);
  console.log(`  poll:                 every ${pollSeconds}s`);
  console.log(`  pairs:                ${PAIR_CONFIGS.map((p) => `${p.display} (${p.sourceLabel})`).join(", ")}`);
  console.log(`  timeframes:           ${timeframes.map((t) => t.label).join(", ")}`);
  console.log(`  subsidy per side:     ${subsidyPerSide} USDC`);
  console.log(`  on-chain subsidy:     ${subsidyTotalBaseUnits} base units (both sides)`);
  console.log(`  dry-run:              ${dryRun}`);
  console.log(`  trace enabled:        ${traceEnabled}`);
  if (traceEnabled) {
    console.log(`  trace agents:         ${traceAgents.map((a) => a.name).join(", ")}`);
    console.log(`  trace threshold:      ${traceThresholdBps} bps (${(traceThresholdBps / 100).toFixed(0)}%)`);
    console.log(`  trace window:         ${traceWindowHours}h`);
  }

  // Startup balance probe. One full multi-pair spawn cycle needs
  // `subsidyTotalBaseUnits` × `timeframes.length` × `PAIR_CONFIGS.length` of
  // USDC, plus a few cents of ARC for gas. We don't gate startup on this —
  // operators sometimes top up mid-run — but we do surface it so a depleted
  // treasury isn't silently mistaken for a code bug. Demo prep doc says
  // "keep >= 50 USDC".
  void (async () => {
    const subsidyPerMarket = BigInt(subsidyTotalBaseUnits);
    const fullCycle = subsidyPerMarket * BigInt(timeframes.length) * BigInt(PAIR_CONFIGS.length);
    const treasury = await readTreasuryUsdc(marketApiURL);
    if (treasury === null) {
      console.log(`[${label}] WARN treasury balance unknown · /protocol/stats unreachable at startup`);
      return;
    }
    const treasuryUsdc = Number(treasury) / 1_000_000;
    const cycleUsdc = Number(fullCycle) / 1_000_000;
    if (treasury < fullCycle) {
      const msg = `[${label}] WARN treasury balance LOW · ${treasuryUsdc.toFixed(2)} USDC available · need >=${cycleUsdc.toFixed(2)} USDC for full cycle · creates will fail mid-loop`;
      console.log(msg);
      console.error(msg);
    } else {
      console.log(`[${label}] treasury balance OK · ${treasuryUsdc.toFixed(2)} USDC available · full cycle needs ${cycleUsdc.toFixed(2)} USDC`);
    }
  })();

  /// One-pair timeframe-coverage tick. Identical logic across pairs — just
  /// fetcher and labels differ — so we run this once per PAIR_CONFIGS entry.
  const tickPair = async (pair: PairConfig) => {
    let openMarkets: MarketRow[];
    try {
      openMarkets = await listOpenMarkets(marketApiURL);
    } catch (err) {
      console.log(`[${label}] /markets fetch failed: ${(err as Error).message}`);
      return;
    }

    const missing: Timeframe[] = [];
    for (const tf of timeframes) {
      const covered = openMarkets.some((m) => matchesTimeframe(m, pair.code, tf));
      if (covered) continue;
      missing.push(tf);
    }

    if (missing.length === 0) {
      const ownPair = openMarkets.filter((m) => m.pair?.toUpperCase() === pair.code).length;
      console.log(`[${label}] ${pair.display} all ${timeframes.length} timeframes covered (${ownPair} open)`);
      return;
    }

    console.log(`[${label}] ${pair.display} need to spawn ${missing.length} timeframe(s): ${missing.map((t) => t.label).join(", ")}`);

    // Snapshot reference rate ONCE per tick — cheaper than N HTTP hits and
    // keeps every market spawned this tick aligned to the same reference
    // point. If the snapshot fails we skip the whole tick rather than create
    // markets with stale data; the next tick (pollSeconds later) will retry.
    let rate: number;
    try {
      rate = await pair.fetchRate();
    } catch (err) {
      console.log(`[${label}] ${pair.sourceLabel} rate fetch failed for ${pair.display}, skipping tick: ${(err as Error).message}`);
      return;
    }
    console.log(`[${label}] ${pair.sourceLabel} ${pair.display} snapshot: ${displayRate(rate)}`);

    for (let i = 0; i < missing.length; i++) {
      const tf = missing[i]!;
      if (dryRun) {
        console.log(`[${label}]   (dry-run) would create ${pair.display} ${tf.label} @ ${displayRate(rate)}`);
        continue;
      }
      // 500ms breather between successive creates so back-to-back POSTs don't
      // pile up behind the market-api chain-mutex (each create runs approve +
      // createMarket + waitForReceipt under withChainLock). Without this, a
      // hot loop can saturate the queue and trip ChainLockTimeout on later
      // timeframes. Skip the sleep before the first one — no point waiting
      // for ourselves.
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const result = await createMarket(marketApiURL, pair, tf, rate, subsidyTotalBaseUnits);
        if ("skipped" in result) {
          console.log(`[${label}]   ${pair.display} ${tf.label}: already exists (409, raced)`);
          continue;
        }
        if (result.deduped) {
          console.log(
            `[${label}]   ${pair.display} ${tf.label}: deduped by market-api id=${result.marketId.slice(0, 10)}…`,
          );
          continue;
        }
        const closesAtUnix = Math.floor(Date.now() / 1000) + tf.seconds;
        console.log(
          `[${label}]   created ${pair.display} ${tf.label} id=${result.marketId.slice(0, 10)}… spot=${displayRate(rate)} closes=${formatMarketCloseLabel(closesAtUnix)}`,
        );
      } catch (err) {
        // Surface to BOTH stdout (out.log) AND stderr (err.log) so operators
        // grepping either stream catch failures. Keep going on the next
        // timeframe — one bad slot shouldn't strand the rest of the tick.
        const e = err as Error;
        const msg = `[${label}] FAILED create ${pair.display} ${tf.label}: ${e.message.slice(0, 300)}`;
        console.log(msg);
        console.error(msg);
        if (e.stack) console.error(e.stack);
      }
    }
  };

  const tickTrace = async () => {
    if (!traceEnabled) return;

    let openTrace: TraceMarketRow[];
    try {
      openTrace = await listOpenTraceMarkets(marketApiURL);
    } catch (err) {
      console.log(`[${label}] trace · /trace-markets fetch failed: ${(err as Error).message}`);
      return;
    }

    // Index by lowercased target address. An agent counts as "covered" when at
    // least one OPEN trace market targets them at the configured threshold —
    // we don't want to spawn a fresh 24h market while last hour's is still live.
    const coveredAgents = new Set(
      openTrace
        .filter((m) => m.phase === 0 && m.thresholdBps === traceThresholdBps)
        .map((m) => m.targetAgent.toLowerCase()),
    );

    const missing = traceAgents.filter((a) => !coveredAgents.has(a.address.toLowerCase()));

    if (missing.length === 0) {
      console.log(
        `[${label}] trace · all ${traceAgents.length} agents covered (${openTrace.length} open trace markets)`,
      );
      return;
    }

    console.log(
      `[${label}] trace · need to spawn ${missing.length} agent(s): ${missing.map((a) => a.name).join(", ")}`,
    );

    for (let i = 0; i < missing.length; i++) {
      const agent = missing[i]!;
      if (dryRun) {
        console.log(
          `[${label}]   (dry-run) trace · would create for ${agent.name} threshold=${(traceThresholdBps / 100).toFixed(0)}% window=${traceWindowHours}h`,
        );
        continue;
      }
      // Same 500ms backpressure rationale as the EUR/USD loop above.
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const result = await createTraceMarket(marketApiURL, agent, traceThresholdBps, traceWindowHours);
        if (result.deduped) {
          console.log(`[${label}]   trace · ${agent.name}: already exists (deduped)`);
          continue;
        }
        console.log(
          `[${label}] trace · created for ${agent.name} id=${result.id.slice(0, 10)}… threshold=${(traceThresholdBps / 100).toFixed(0)}% window=${traceWindowHours}h`,
        );
      } catch (err) {
        const e = err as Error;
        const msg = `[${label}] FAILED create trace ${agent.name}: ${e.message.slice(0, 300)}`;
        console.log(msg);
        console.error(msg);
        if (e.stack) console.error(e.stack);
      }
    }
  };

  // Run all loops every tick. Sequentially (not Promise.all) so the logs from
  // each pair + the trace pass don't interleave — easier to scan, and avoids
  // hammering market-api's chain mutex with concurrent createMarket calls.
  const tick = async () => {
    for (const pair of PAIR_CONFIGS) {
      await tickPair(pair);
    }
    await tickTrace();
  };

  // Re-entrancy guard. setInterval fires on a strict cadence and DOES NOT wait
  // for the previous callback to settle. A cold-start tick can run for >60s
  // because each createMarket waits for approve + create + receipt under the
  // market-api chain mutex (~10-25s each on Arc Testnet). Without this guard
  // tick N+1 fires while tick N is still posting to /markets, both pile up
  // behind withChainLock, and the second one eventually trips the 75s mutex
  // timeout → 503 — which to the operator looks like the keeper "silently
  // stopped" mid-cycle. The guard makes ticks strictly serial, so logs from
  // one tick can never interleave with the next.
  let tickInFlight = false;
  const safeTick = async () => {
    if (tickInFlight) {
      console.log(`[${label}] previous tick still in flight — skipping this beat`);
      return;
    }
    tickInFlight = true;
    try {
      await tick();
    } catch (err) {
      const e = err as Error;
      const msg = `[${label}] tick crashed: ${e.message}`;
      console.log(msg);
      console.error(msg);
      if (e.stack) console.error(e.stack);
    } finally {
      tickInFlight = false;
    }
  };

  void safeTick();
  setInterval(safeTick, pollSeconds * 1000);
}

try {
  main();
} catch (err) {
  console.error(`[forum-keeper] fatal: ${(err as Error).message}`);
  process.exit(1);
}
