#!/usr/bin/env tsx
/// FORUM news scout
///
/// Polls 1-N RSS feeds (ECB press, FX news). For each NEW headline:
///   1. Send to LLM → "is this market-worthy? if yes, what's the market?"
///   2. If create_market AND confidence ≥ threshold → POST /markets to create
///      a fresh EUR/USD binary market for the agent zoo to bet on.
///
/// This is the autonomous-market-creation pillar of FORUM. The other agents
/// (Oracle/Sage/Hermes/Augur) react to whatever the scout produces — no human
/// curator in the loop. Markets exist because the world produced news.
///
/// Env (read from process.env, NOT auto-loaded — caller sources `.env` first):
///   SCOUT_LLM_API_KEY        required — same MiMo Token Plan key works
///   SCOUT_LLM_BASE_URL       defaults to LLM_BASE_URL (global)
///   SCOUT_LLM_MODEL          defaults to "mimo-v2.5-pro" (use grok-2-latest if Grok key)
///   SCOUT_FEEDS              comma-separated RSS URLs.
///                            Default: ECB press releases + Reuters FX
///   SCOUT_POLL_SECONDS       defaults to 600 (10 min between polls)
///   SCOUT_MIN_CONFIDENCE     defaults to 0.7 — must clear to create market
///   SCOUT_SUBSIDY_USDC       defaults to "0.5" — initial LMSR subsidy
///   SCOUT_LABEL              defaults to "forum-scout"
///   SCOUT_DRY_RUN            "true" = log proposals but never POST /markets
///   SCOUT_MAX_ITEMS_PER_TICK defaults to 5 — cap LLM calls per poll cycle
///   MARKET_API_URL           defaults to http://127.0.0.1:8403
///
/// Trace-market autopilot (M4):
///   SCOUT_TRACE_ENABLED      "true" enables daily trace-market creation.
///                            Defaults "false" — opt in once the leaderboard
///                            has enough signal.
///   SCOUT_TRACE_POLL_SECONDS defaults 86400 (1 day)
///   SCOUT_TRACE_TOP_N        defaults 5 — leaderboard agents covered per tick
///   SCOUT_TRACE_MIN_SETTLED  defaults 3 — minimum settled bets per agent
///   SCOUT_TRACE_THRESHOLD_BPS defaults 5000 (50% win-rate)
///   SCOUT_TRACE_WINDOW_HOURS defaults 24

import { fetchFeed, type FeedItem } from "./rss.js";
import { fetchTelegramChannel } from "./telegram.js";
import { evaluateHeadline, type Proposal } from "./proposal.js";

/// Reliable feed defaults — official central-bank press first, trusted wires
/// second. Markets created from these get a green "OFFICIAL" badge in the UI.
/// Override via SCOUT_FEEDS env (comma-separated) when you wire in better
/// sources (Reuters/Bloomberg via Grok, or paid forex news APIs).
const DEFAULT_FEEDS = [
  // Tier 1 — official central banks (highest trust)
  "https://www.ecb.europa.eu/rss/press.html",
  "https://www.federalreserve.gov/feeds/press_all.xml",
  "https://www.bankofengland.co.uk/rss/news",
  // Tier 2 — trusted financial media
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  // BIS speeches — central-bank speeches feed, central-bank-grade signal
  "https://www.bis.org/list/cbspeeches/spcty_-1/index.rss",
  // (investing.com news_forex RSS returns 404 as of 2026-05 — endpoint
  //  removed by the publisher. Replaced with BIS above.)
];

/// Public Telegram channels to watch. No API key needed — scrapes t.me/s/<name>.
/// Add macro/FX/ECB analyst channels here. Examples:
///   "forexlive", "macroalfff", "MacroEdge_T"
/// Defaults empty — opt in via SCOUT_TG_CHANNELS env.
const DEFAULT_TG_CHANNELS: string[] = [];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function main() {
  const apiKey = requireEnv("SCOUT_LLM_API_KEY");
  const baseURL =
    process.env["SCOUT_LLM_BASE_URL"] ??
    process.env["LLM_BASE_URL"] ??
    "https://token-plan-cn.xiaomimimo.com/v1";
  const model = process.env["SCOUT_LLM_MODEL"] ?? "mimo-v2.5-pro";
  const feeds = (process.env["SCOUT_FEEDS"] ?? DEFAULT_FEEDS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tgChannels = (process.env["SCOUT_TG_CHANNELS"] ?? DEFAULT_TG_CHANNELS.join(","))
    .split(",")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
  const pollSeconds = Number(process.env["SCOUT_POLL_SECONDS"] ?? "600");
  const minConfidence = Number(process.env["SCOUT_MIN_CONFIDENCE"] ?? "0.7");
  const subsidyUsdc = process.env["SCOUT_SUBSIDY_USDC"] ?? "0.5";
  const label = process.env["SCOUT_LABEL"] ?? "forum-scout";
  const dryRun = process.env["SCOUT_DRY_RUN"] === "true";
  const maxItemsPerTick = Number(process.env["SCOUT_MAX_ITEMS_PER_TICK"] ?? "5");
  const marketApiURL = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";

  console.log(`[${label}] online`);
  console.log(`  llm:           ${model} via ${baseURL}`);
  console.log(`  RSS feeds:     ${feeds.length}`);
  for (const f of feeds) console.log(`    · ${f}`);
  console.log(`  TG channels:   ${tgChannels.length}`);
  for (const c of tgChannels) console.log(`    · t.me/${c}`);
  console.log(`  poll:          every ${pollSeconds}s`);
  console.log(`  min confidence: ${minConfidence}`);
  console.log(`  subsidy:       ${subsidyUsdc} USDC`);
  console.log(`  dry-run:       ${dryRun}`);
  console.log(`  market-api:    ${marketApiURL}`);

  // Track headlines we've already evaluated this process lifetime so we don't
  // re-prompt the LLM every poll cycle. Keyed by RSS <link> (canonical URL).
  const seen = new Set<string>();

  /// One round of headline collection across all sources, deduped against the
  /// per-process `seen` set. Each source emits `FeedItem`s with the same shape.
  /// `tag` is the persisted identifier (becomes `markets.created_by` server-side)
  /// — short, lowercase, stable.
  const collectAll = async (): Promise<Array<{ source: string; tag: string; items: FeedItem[] }>> => {
    const out: Array<{ source: string; tag: string; items: FeedItem[] }> = [];
    for (const feedUrl of feeds) {
      try {
        const tag = `scout:${sourceTagForFeed(feedUrl)}`;
        out.push({ source: `rss/${shortUrl(feedUrl)}`, tag, items: await fetchFeed(feedUrl) });
      } catch (err) {
        console.log(`[${label}] feed error (${feedUrl}): ${(err as Error).message}`);
      }
    }
    for (const ch of tgChannels) {
      try {
        out.push({
          source: `tg/${ch}`,
          tag: `scout:tg:${ch.toLowerCase()}`,
          items: await fetchTelegramChannel(ch),
        });
      } catch (err) {
        console.log(`[${label}] tg error (${ch}): ${(err as Error).message}`);
      }
    }
    return out;
  };

  const tick = async () => {
    for (const { source, tag, items } of await collectAll()) {
      // Newest first, cap per source so 1 feed can't burn the whole tick's
      // LLM budget. Skip headlines we already evaluated this process lifetime.
      const fresh = items
        .filter((it) => !seen.has(it.link))
        .sort((a, b) => (b.pubUnix || 0) - (a.pubUnix || 0))
        .slice(0, maxItemsPerTick);

      if (fresh.length === 0) {
        console.log(`[${label}] ${source}: no new items`);
        continue;
      }

      console.log(`[${label}] ${source}: ${fresh.length} new headlines`);

      for (const item of fresh) {
        seen.add(item.link);
        let verdict: Proposal;
        try {
          verdict = await evaluateHeadline({ apiKey, baseURL, model }, item);
        } catch (err) {
          console.log(`[${label}]   ✗ LLM error: ${(err as Error).message.slice(0, 200)}`);
          continue;
        }

        const headlineShort = item.title.length > 80 ? item.title.slice(0, 77) + "…" : item.title;
        if (!verdict.createMarket) {
          console.log(`[${label}]   ⨯ skip: "${headlineShort}" — ${verdict.reasoning.slice(0, 100)}`);
          continue;
        }
        if (verdict.confidence < minConfidence) {
          console.log(
            `[${label}]   ⨯ low-conf (${verdict.confidence.toFixed(2)} < ${minConfidence}): "${headlineShort}"`,
          );
          continue;
        }

        console.log(`[${label}]   ✓ propose: "${verdict.question}" conf=${verdict.confidence.toFixed(2)}`);
        console.log(`[${label}]     reason: ${verdict.reasoning}`);

        if (dryRun) {
          console.log(`[${label}]     (dry-run) would POST /markets`);
          continue;
        }

        try {
          await createMarket(marketApiURL, verdict, subsidyUsdc, tag);
          console.log(`[${label}]     → market created on FORUM (source: ${tag})`);
        } catch (err) {
          console.log(`[${label}]     ✗ create failed: ${(err as Error).message.slice(0, 200)}`);
        }
      }
    }
  };

  // Fire immediately on boot, then on interval.
  void tick();
  setInterval(tick, pollSeconds * 1000);

  // M4 Trace-market autopilot — separate cadence, can run alongside the news
  // tick on the same scout process. Off by default; opt in via env.
  const traceEnabled = process.env["SCOUT_TRACE_ENABLED"] === "true";
  if (traceEnabled) {
    const tracePollSeconds = Number(process.env["SCOUT_TRACE_POLL_SECONDS"] ?? "86400");
    const traceTopN = Number(process.env["SCOUT_TRACE_TOP_N"] ?? "5");
    const traceMinSettled = Number(process.env["SCOUT_TRACE_MIN_SETTLED"] ?? "3");
    const traceThresholdBps = Number(process.env["SCOUT_TRACE_THRESHOLD_BPS"] ?? "5000");
    const traceWindowHours = Number(process.env["SCOUT_TRACE_WINDOW_HOURS"] ?? "24");

    console.log(`[${label}] trace-autopilot: on`);
    console.log(`  poll:             every ${tracePollSeconds}s`);
    console.log(`  top-N:            ${traceTopN}`);
    console.log(`  min settled:      ${traceMinSettled}`);
    console.log(`  threshold:        ${traceThresholdBps} bps (${(traceThresholdBps / 100).toFixed(0)}%)`);
    console.log(`  window:           ${traceWindowHours}h`);

    const traceTick = async () => {
      try {
        await runTraceTick({
          label,
          marketApiURL,
          dryRun,
          topN: traceTopN,
          minSettled: traceMinSettled,
          thresholdBps: traceThresholdBps,
          windowHours: traceWindowHours,
        });
      } catch (err) {
        console.log(`[${label}] trace-tick error: ${(err as Error).message.slice(0, 200)}`);
      }
    };

    void traceTick();
    setInterval(traceTick, tracePollSeconds * 1000);
  } else {
    console.log(`[${label}] trace-autopilot: off (set SCOUT_TRACE_ENABLED=true to enable)`);
  }
}

/// One round of trace-market creation:
///   1. Pull top-N from /agents/leaderboard.
///   2. Pull currently OPEN trace markets → dedup set keyed by target agent.
///   3. For each leaderboard row with ≥ minSettled bets and no open trace
///      market, POST /trace-markets with the configured threshold + window.
async function runTraceTick(opts: {
  label: string;
  marketApiURL: string;
  dryRun: boolean;
  topN: number;
  minSettled: number;
  thresholdBps: number;
  windowHours: number;
}): Promise<void> {
  const { label, marketApiURL, dryRun, topN, minSettled, thresholdBps, windowHours } = opts;

  const lbRes = await fetch(`${marketApiURL}/agents/leaderboard?limit=${topN + 5}`);
  if (!lbRes.ok) throw new Error(`leaderboard ${lbRes.status}`);
  const lbJson = (await lbRes.json()) as {
    leaderboard: Array<{ address: string; wins: number; losses: number; winRate: number | null }>;
  };

  const tmRes = await fetch(`${marketApiURL}/trace-markets?status=open`);
  if (!tmRes.ok) throw new Error(`trace-markets ${tmRes.status}`);
  const tmJson = (await tmRes.json()) as {
    traceMarkets: Array<{ targetAgent: string }>;
  };
  const covered = new Set(tmJson.traceMarkets.map((m) => m.targetAgent.toLowerCase()));

  const eligible = lbJson.leaderboard
    .filter((r) => r.wins + r.losses >= minSettled)
    .filter((r) => !covered.has(r.address.toLowerCase()))
    .slice(0, topN);

  if (eligible.length === 0) {
    console.log(`[${label}] trace-tick: no new agents to cover (covered=${covered.size})`);
    return;
  }

  console.log(`[${label}] trace-tick: ${eligible.length} agents eligible`);
  for (const row of eligible) {
    const settled = row.wins + row.losses;
    const winRatePct = row.winRate != null ? (row.winRate * 100).toFixed(0) : "—";
    console.log(
      `[${label}]   ✓ ${row.address.slice(0, 8)} settled=${settled} winRate=${winRatePct}%`,
    );
    if (dryRun) {
      console.log(`[${label}]     (dry-run) would POST /trace-markets`);
      continue;
    }
    try {
      await createTraceMarket(marketApiURL, row.address, thresholdBps, windowHours);
      console.log(`[${label}]     → trace market created`);
    } catch (err) {
      console.log(`[${label}]     ✗ create failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

async function createTraceMarket(
  marketApiURL: string,
  targetAgent: string,
  thresholdBps: number,
  windowHours: number,
): Promise<void> {
  const res = await fetch(`${marketApiURL}/trace-markets`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ targetAgent, thresholdBps, windowHours }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /trace-markets ${res.status} ${text.slice(0, 300)}`);
  }
  await res.json().catch(() => null);
}

/// Headers for admin-gated market-api endpoints. Scout creates markets and
/// trace-markets on the user's behalf, so it speaks with the runner secret
/// (same env shared with personas / keeper / rental-orchestrator). If the
/// secret is missing, the POST will 401 — log early so the operator can
/// fix the env without waiting for the first market candidate to appear.
function adminHeaders(): Record<string, string> {
  const secret = process.env["RUNNER_AUTH_SECRET"];
  if (!secret) {
    throw new Error("RUNNER_AUTH_SECRET missing — scout cannot create markets without it");
  }
  return {
    "Content-Type": "application/json",
    "x-runner-secret": secret,
  };
}

function shortUrl(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

/// Map a feed URL to a short canonical source tag. Used as `markets.created_by`
/// so the UI can render a trust badge per market. Keep these stable — they show
/// up in the DB and we don't want to rename categories later.
function sourceTagForFeed(feedUrl: string): string {
  const host = shortUrl(feedUrl).toLowerCase();
  if (host.includes("ecb.europa.eu")) return "ecb";
  if (host.includes("federalreserve.gov")) return "fed";
  if (host.includes("bankofengland.co.uk")) return "boe";
  if (host.includes("bis.org")) return "bis";
  if (host.includes("bbc.co.uk") || host.includes("bbci.co.uk")) return "bbc";
  if (host.includes("investing.com")) return "investing";
  if (host.includes("reuters.com")) return "reuters";
  // Unknown / 3rd-party feed — generic tag so UI doesn't crash on missing labels.
  return "other";
}

/// Hits POST /markets on the FORUM backend. Backend handles the on-chain
/// approve + factory.createMarket; scout pays no gas itself. `createdBy` is
/// persisted alongside the market so the UI can render a trust-source badge.
async function createMarket(
  marketApiURL: string,
  verdict: Extract<Proposal, { createMarket: true }>,
  subsidyUsdc: string,
  createdBy: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const opensAt = now;
  const closesAt = now + verdict.closeMinutes * 60;
  const subsidyBaseUnits = String(Math.floor(Number(subsidyUsdc) * 1_000_000));

  const body = {
    question: verdict.question,
    pair: "EURUSD",
    strikeWad: verdict.strikeWad,
    comparator: verdict.comparator,
    bWad: "100000000000000000000", // matches existing markets — LMSR b = 100 WAD
    opensAt,
    closesAt,
    subsidyUsdc: subsidyBaseUnits,
    createdBy,
  };

  const res = await fetch(`${marketApiURL}/markets`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /markets ${res.status} ${text.slice(0, 300)}`);
  }
  // We don't need to use the response — market-api logs the marketId + tx.
  await res.json().catch(() => null);
}

try {
  main();
} catch (err) {
  console.error(`[forum-scout] fatal: ${(err as Error).message}`);
  process.exit(1);
}
