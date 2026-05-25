#!/usr/bin/env tsx
/// FORUM translator agent (M11)
///
/// Reads non-English macro feeds (BoJ Japanese, ECB German press, PBOC
/// Mandarin) and proposes English-language USD prediction markets via
/// market-api.
///
/// Why it matters: non-English central bank statements move USD/EUR
/// FX with a 5-15 min information lag for English-only traders. The
/// translator captures that lag as latency arbitrage and creates new
/// markets nobody else has.
///
/// Architecture mirrors forum-scout but the LLM prompt does two extra
/// jobs: translate + assess market-worthiness in one shot. Source URL
/// + original language + translated headline land in markets.created_by
/// for provenance.
///
/// Env required (read from process.env, NOT auto-loaded):
///   TRANSLATOR_LLM_API_KEY       required
///   TRANSLATOR_LLM_BASE_URL      defaults to LLM_BASE_URL (global)
///   TRANSLATOR_LLM_MODEL         defaults to "mimo-v2.5-pro"
///   TRANSLATOR_POLL_SECONDS      defaults to 900 (15 min)
///   TRANSLATOR_MIN_CONFIDENCE    defaults to 0.65
///   TRANSLATOR_SUBSIDY_USDC      defaults to "0.5"
///   TRANSLATOR_DRY_RUN           "true" = log only, never POST
///   TRANSLATOR_MAX_ITEMS_PER_TICK defaults 3 — LLM calls per tick cap
///   TRANSLATOR_FEEDS             comma-separated; defaults to BoJ JP + ECB DE
///   MARKET_API_URL               defaults http://127.0.0.1:8403

import OpenAI from "openai";

type FeedItem = {
  title: string;
  link: string;
  pubDate: string;
  pubUnix: number;
  description: string;
  source: string;
  lang: "ja" | "de" | "zh" | "auto";
};

type TranslatorVerdict =
  | {
      createMarket: true;
      translatedTitle: string;
      sourceTitle: string;
      sourceLang: string;
      question: string;
      strikeWad: string;
      comparator: "GT" | "GTE" | "LT" | "LTE";
      closeMinutes: number;
      confidence: number;
      reasoning: string;
    }
  | { createMarket: false; reasoning: string; confidence: number };

/// Curated default non-English macro feeds. Override via env. These are
/// chosen because their releases reliably move USD/EUR/JPY/CNY FX —
/// short, structured, central-bank-grade.
const DEFAULT_FEEDS: { url: string; tag: string; lang: FeedItem["lang"] }[] = [
  // Bank of Japan press releases (Japanese)
  { url: "https://www.boj.or.jp/whatsnew/info_release.xml", tag: "boj-jp", lang: "ja" },
  // ECB press releases (German edition) — different framing than EN page
  { url: "https://www.ecb.europa.eu/rss/press_de.html", tag: "ecb-de", lang: "de" },
];

const ITEM_RE = /<item[\s>][\s\S]*?<\/item>/gi;
const TITLE_RE = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/title>/i;
const LINK_RE = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/link>/i;
const DATE_RE = /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/pubDate>/i;
const DESC_RE = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:]]>)?<\/description>/i;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchFeed(
  url: string,
  source: string,
  lang: FeedItem["lang"],
): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "user-agent": "FORUM-translator/0.1 (+https://forum.auranode.xyz)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`feed ${url}: ${res.status}`);
  const xml = await res.text();
  const items: FeedItem[] = [];
  for (const block of xml.match(ITEM_RE) ?? []) {
    const t = block.match(TITLE_RE)?.[1] ?? "";
    const l = block.match(LINK_RE)?.[1] ?? "";
    const d = block.match(DATE_RE)?.[1] ?? "";
    const desc = block.match(DESC_RE)?.[1] ?? "";
    const title = decode(t);
    const link = decode(l);
    const pubDate = decode(d);
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate,
      pubUnix: Math.floor(new Date(pubDate).getTime() / 1000),
      description: decode(stripTags(desc)),
      source,
      lang,
    });
  }
  return items;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const SYSTEM_PROMPT = `You are FORUM's translator agent. You read central-bank press releases in non-English languages (Japanese, German, Mandarin) and decide whether they warrant a new English-language USD or EUR prediction market on the FORUM protocol.

Your output is strictly JSON:
{
  "createMarket": boolean,
  "translatedTitle": "english translation of the headline (max 120 chars)",
  "sourceTitle": "original-language headline (kept verbatim)",
  "sourceLang": "ja" | "de" | "zh",
  "question": "binary yes/no market question (e.g. 'Will EUR/USD close >= 1.10 on 2026-05-25?')",
  "strikeWad": "decimal-string strike (e.g. '1.10' for EUR/USD)",
  "comparator": "GT" | "GTE" | "LT" | "LTE",
  "closeMinutes": number (60..720 — how soon the market should close),
  "confidence": number (0..1 — your confidence this market is worth creating),
  "reasoning": "1-2 sentences in English: why this signal moves FX + why now"
}

Rules:
- ONLY propose a market if the signal is FX-relevant: rate decisions, policy speeches, intervention signals, inflation prints, balance-of-payments shifts. Skip generic announcements.
- Translate the title accurately — no editorializing.
- Keep questions specific and binary. Use round strikes (1.05, 1.10, 1.15 for EUR/USD; 150, 155, 160 for USD/JPY).
- closeMinutes should match the signal's expected information half-life — rate decisions = 240-720, speeches = 60-180.
- If unsure, set createMarket: false with reasoning explaining the skip.
`;

async function evaluate(opts: {
  apiKey: string;
  baseURL: string;
  model: string;
  item: FeedItem;
}): Promise<TranslatorVerdict> {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  const userMessage = `Source: ${opts.item.source} (${opts.item.lang})
Original title: ${opts.item.title}
Description: ${opts.item.description.slice(0, 600)}
Published: ${opts.item.pubDate}

Assess + translate.`;
  const resp = await client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 600,
  });
  const text = resp.choices[0]?.message.content ?? "{}";
  try {
    return JSON.parse(text) as TranslatorVerdict;
  } catch {
    return { createMarket: false, reasoning: "LLM returned malformed JSON", confidence: 0 };
  }
}

async function createMarket(args: {
  marketApiURL: string;
  verdict: Extract<TranslatorVerdict, { createMarket: true }>;
  subsidyUsdc: string;
  createdBy: string;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const closesAt = now + args.verdict.closeMinutes * 60;
  const subsidyBaseUnits = String(Math.floor(Number(args.subsidyUsdc) * 1_000_000));

  // Strike encoding — match forum-scout / market-api convention: 18-decimal wad.
  const strikeNumber = Number(args.verdict.strikeWad);
  if (!Number.isFinite(strikeNumber) || strikeNumber <= 0) {
    throw new Error(`bad strike: ${args.verdict.strikeWad}`);
  }
  const strikeWad = BigInt(Math.round(strikeNumber * 1e18)).toString();

  const body = {
    question: args.verdict.question,
    pair: "EURUSD",
    strikeWad,
    comparator: args.verdict.comparator,
    bWad: "100000000000000000000",
    opensAt: now,
    closesAt,
    subsidyUsdc: subsidyBaseUnits,
    createdBy: args.createdBy,
  };

  const res = await fetch(`${args.marketApiURL}/markets`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST /markets ${res.status} ${txt.slice(0, 300)}`);
  }
  await res.json().catch(() => null);
}

/// Headers for admin-gated market-api endpoints. Translator autonomously
/// creates markets when a news cycle warrants it — same admin-secret
/// pattern scout + keeper use. Throws early on missing env so misconfig
/// surfaces at boot rather than at first market candidate.
function adminHeaders(): Record<string, string> {
  const secret = process.env["RUNNER_AUTH_SECRET"];
  if (!secret) {
    throw new Error("RUNNER_AUTH_SECRET missing — translator cannot create markets without it");
  }
  return {
    "Content-Type": "application/json",
    "x-runner-secret": secret,
  };
}

function main(): void {
  const apiKey = requireEnv("TRANSLATOR_LLM_API_KEY");
  const baseURL =
    process.env["TRANSLATOR_LLM_BASE_URL"]
    ?? process.env["LLM_BASE_URL"]
    ?? "https://token-plan-cn.xiaomimimo.com/v1";
  const model = process.env["TRANSLATOR_LLM_MODEL"] ?? "mimo-v2.5-pro";
  const pollSec = Number(process.env["TRANSLATOR_POLL_SECONDS"] ?? "900");
  const minConf = Number(process.env["TRANSLATOR_MIN_CONFIDENCE"] ?? "0.65");
  const subsidyUsdc = process.env["TRANSLATOR_SUBSIDY_USDC"] ?? "0.5";
  const dryRun = process.env["TRANSLATOR_DRY_RUN"] === "true";
  const maxItems = Number(process.env["TRANSLATOR_MAX_ITEMS_PER_TICK"] ?? "3");
  const marketApiURL = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";

  // Optional feed override.
  const customFeeds = process.env["TRANSLATOR_FEEDS"];
  const feeds: typeof DEFAULT_FEEDS = customFeeds
    ? customFeeds.split(",").map((u, i) => ({
        url: u.trim(),
        tag: `custom-${i}`,
        lang: "auto" as const,
      }))
    : DEFAULT_FEEDS;

  console.log(`[translator] online`);
  console.log(`  llm:         ${model} via ${baseURL}`);
  console.log(`  feeds:       ${feeds.length}`);
  for (const f of feeds) console.log(`    · ${f.tag} (${f.lang}) ${f.url}`);
  console.log(`  poll:        every ${pollSec}s`);
  console.log(`  min conf:    ${minConf}`);
  console.log(`  subsidy:     ${subsidyUsdc} USDC`);
  console.log(`  dry-run:     ${dryRun}`);
  console.log(`  market-api:  ${marketApiURL}`);

  const seen = new Set<string>();

  const tick = async () => {
    for (const f of feeds) {
      let items: FeedItem[];
      try {
        items = await fetchFeed(f.url, f.tag, f.lang);
      } catch (err) {
        console.log(`[translator] feed error (${f.tag}): ${(err as Error).message}`);
        continue;
      }
      const fresh = items
        .filter((it) => !seen.has(it.link))
        .sort((a, b) => (b.pubUnix || 0) - (a.pubUnix || 0))
        .slice(0, maxItems);

      if (fresh.length === 0) {
        console.log(`[translator] ${f.tag}: no new items`);
        continue;
      }
      console.log(`[translator] ${f.tag}: ${fresh.length} new headlines`);

      for (const item of fresh) {
        seen.add(item.link);
        let verdict: TranslatorVerdict;
        try {
          verdict = await evaluate({ apiKey, baseURL, model, item });
        } catch (err) {
          console.log(`[translator]   ✗ LLM error: ${(err as Error).message.slice(0, 200)}`);
          continue;
        }

        const short = item.title.length > 70 ? item.title.slice(0, 67) + "…" : item.title;
        if (!verdict.createMarket) {
          console.log(`[translator]   ⨯ skip "${short}" — ${verdict.reasoning.slice(0, 100)}`);
          continue;
        }
        if (verdict.confidence < minConf) {
          console.log(
            `[translator]   ⨯ low-conf (${verdict.confidence.toFixed(2)}) "${short}"`,
          );
          continue;
        }

        console.log(
          `[translator]   ✓ translate "${verdict.translatedTitle}" — ${verdict.question} conf=${verdict.confidence.toFixed(2)}`,
        );
        console.log(`[translator]     source: ${item.lang} "${verdict.sourceTitle}"`);

        if (dryRun) {
          console.log(`[translator]     (dry-run) would POST /markets`);
          continue;
        }

        const tag = `scout:translator:${f.tag}`;
        try {
          await createMarket({ marketApiURL, verdict, subsidyUsdc, createdBy: tag });
          console.log(`[translator]     → market created (createdBy=${tag})`);
        } catch (err) {
          console.log(`[translator]     ✗ create failed: ${(err as Error).message.slice(0, 200)}`);
        }
      }
    }
  };

  void tick();
  setInterval(tick, pollSec * 1000);
}

try {
  main();
} catch (err) {
  console.error(`[translator] fatal: ${(err as Error).message}`);
  process.exit(1);
}
