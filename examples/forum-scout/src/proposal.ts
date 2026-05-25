import OpenAI from "openai";
import type { FeedItem } from "./rss.js";

/// Asks an LLM to decide whether an RSS headline is significant enough to warrant
/// a new FORUM prediction market, and if so, what the market should look like.
///
/// Strict-JSON contract. The model is told the FORUM domain (EUR/USD binary
/// prediction markets on Arc Testnet), gets the headline + description, and
/// returns either a "skip" verdict or a fully-formed market proposal.

const MAX_OUTPUT_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the news scout for FORUM, an AI-agent prediction market on Arc Network.
FORUM lists BINARY markets on EUR/USD spot — questions of the form:
"Will EUR/USD <comparator> <strike> at <closes_at_iso>?"

Your job: read a macro/FX news headline. Decide whether it's important enough that
agents and traders on FORUM would want a fresh market about EUR/USD's near-term
direction in response. Output STRICT JSON only — no markdown, no commentary.

Rules:
- Only propose a market if the headline is SIGNIFICANT: rate decisions, surprise
  inflation prints, ECB/Fed speeches with policy implications, geopolitical
  shocks. Skip procedural news, executive appointments, anniversary posts.
- The strike should be near today's spot (assume EUR/USD ≈ 1.17 unless context
  suggests otherwise). Pick a round level: 1.10, 1.15, 1.17, 1.18, 1.20.
- comparator: "GTE" if you think the news pushes EUR up; "LTE" if down.
- close_minutes: how long until the market should close. MIN 360 (6h), TYPICAL
  1440 (24h), MAX 10080 (1 week). Long windows are required so judges and
  human bettors have time to participate before resolution.
- confidence: 0.0-1.0 — how confident you are this is a worthwhile market.

Output shape:
{
  "create_market": true | false,
  "question": "Will EUR/USD ≥ 1.18 at 2026-05-15T15:00:00.000Z?",
  "strike_wad": "1180000000000000000",
  "comparator": "GTE" | "LTE",
  "close_minutes": 1440,
  "confidence": 0.78,
  "reasoning": "<= 200 chars why this matters"
}

If create_market is false, set question to "" and confidence to 0.`;

export type Proposal =
  | { createMarket: false; reasoning: string; confidence: number }
  | {
      createMarket: true;
      question: string;
      strikeWad: string;
      comparator: "GTE" | "LTE";
      closeMinutes: number;
      confidence: number;
      reasoning: string;
    };

export type LLMConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
};

/// Run one proposal check against the LLM. Returns the parsed Proposal or throws
/// on malformed JSON / API failure.
export async function evaluateHeadline(
  cfg: LLMConfig,
  item: FeedItem,
): Promise<Proposal> {
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  const userPrompt = [
    `Headline: ${item.title}`,
    `Published: ${item.pubDate}`,
    item.description ? `Summary: ${item.description.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.chat.completions.create(
    {
      model: cfg.model,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    },
    { timeout: cfg.timeoutMs ?? 30_000 },
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("LLM returned no content");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const createMarket = parsed["create_market"] === true;
  const confidence = Number(parsed["confidence"] ?? 0);
  const reasoning =
    typeof parsed["reasoning"] === "string" ? parsed["reasoning"].slice(0, 500) : "(no reasoning)";

  if (!createMarket) {
    return { createMarket: false, reasoning, confidence };
  }

  const question = typeof parsed["question"] === "string" ? parsed["question"] : "";
  const strikeWad = typeof parsed["strike_wad"] === "string" ? parsed["strike_wad"] : "";
  const comparator = parsed["comparator"];
  const closeMinutes = Number(parsed["close_minutes"] ?? 0);

  if (!question || !/^\d+$/.test(strikeWad)) {
    throw new Error(`LLM produced create_market=true but invalid fields: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  if (comparator !== "GTE" && comparator !== "LTE") {
    throw new Error(`bad comparator: ${JSON.stringify(comparator)}`);
  }
  // 360 min (6h) lower bound matches the user-confirmed product spec
  // ("6 jam minimum, 24h, 1 week, 1 month"). 10 080 min = 1 week upper.
  // The LLM occasionally proposed 60-90 min windows which closed before
  // any human could see them — markets list page showed 0 open markets.
  if (closeMinutes < 360 || closeMinutes > 10_080) {
    throw new Error(`close_minutes out of range (need 360-10080): ${closeMinutes}`);
  }

  return {
    createMarket: true,
    question,
    strikeWad,
    comparator,
    closeMinutes,
    confidence,
    reasoning,
  };
}
