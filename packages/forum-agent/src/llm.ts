import OpenAI from "openai";
import type { Forecast, Market } from "./types.js";

/// Pluggable LLM driver. Default = DeepSeek V4-Pro via OpenAI-compat endpoint.
/// Drop-in for OpenAI, MegaLLM aggregator, or any OpenAI-protocol-speaking provider —
/// just change `baseURL` + `model`.

export type LLMConfig = {
  apiKey: string;
  /// Pick a preset provider — sets baseURL + a sane default model.
  /// Override either with explicit `baseURL` or `model` below.
  provider?: LLMProvider;
  /// OpenAI-compat base URL. Wins over `provider`.
  baseURL?: string;
  /// Model id. Wins over `provider`'s default.
  model?: string;
  /// Optional timeout in ms. Default 30s.
  timeoutMs?: number;
};

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_LLM_MODEL = "deepseek-v4-pro";

/// Output tokens are hard-capped at 1024 for every provider. Forecast JSON fits
/// comfortably under this. Higher caps risk verbose chain-of-thought from reasoning
/// models that breaks our strict-JSON contract + balloons cost on demo volume.
export const MAX_OUTPUT_TOKENS = 1024;

/// Provider presets — every entry is OpenAI-compatible (uses /v1/chat/completions).
/// Pass `provider: "anthropic"` instead of memorizing the base URL.
/// Native non-OpenAI shapes (Anthropic Messages API, Gemini Vertex API) are NOT used
/// here; we lean on each provider's OpenAI-compat endpoint to keep one client.
///
/// Canonical provider keys — one entry per actual backend endpoint.
/// Aliases (`grok`, `kimi`, `gemini`) reference these instead of duplicating URLs.
const CANONICAL = {
  deepseek:   { baseURL: "https://api.deepseek.com",                                  defaultModel: "deepseek-v4-pro" },
  openai:     { baseURL: "https://api.openai.com/v1",                                 defaultModel: "gpt-4o-mini" },
  anthropic:  { baseURL: "https://api.anthropic.com/v1",                              defaultModel: "claude-sonnet-4-6" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1",                              defaultModel: "deepseek/deepseek-chat" },
  megallm:    { baseURL: "https://api.megallm.io/v1",                                 defaultModel: "gpt-4o-mini" },
  google:     { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",   defaultModel: "gemini-2.5-flash" },
  xai:        { baseURL: "https://api.x.ai/v1",                                       defaultModel: "grok-2-latest" },
  qwen:       { baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",    defaultModel: "qwen-max" },
  moonshot:   { baseURL: "https://api.moonshot.cn/v1",                                defaultModel: "moonshot-v1-32k" },
  minimax:    { baseURL: "https://api.minimaxi.chat/v1",                              defaultModel: "abab6.5s-chat" },
  zhipu:      { baseURL: "https://open.bigmodel.cn/api/paas/v4",                      defaultModel: "glm-4-plus" },
  mistral:    { baseURL: "https://api.mistral.ai/v1",                                 defaultModel: "mistral-large-latest" },
  sumopod:    { baseURL: "https://ai.sumopod.com/v1",                                 defaultModel: "gpt-4o-mini" },
  // MiMo (Xiaomi). Pay-as-you-go endpoint by default. For Token Plan subscribers,
  // override LLM_BASE_URL to https://token-plan-cn.xiaomimimo.com/v1 (key prefix tp-).
  // Model id is lowercase-with-dash — `MiMo-V2.5-Pro` is the marketing name; the
  // API rejects it with "Not supported model". Real ids: mimo-v2.5-pro, mimo-v2.5,
  // mimo-v2-pro, mimo-v2-omni.
  mimo:       { baseURL: "https://api.xiaomimimo.com/v1",                             defaultModel: "mimo-v2.5-pro" },
} as const;

/// Public alias keys → canonical entry. Lets users say `provider: "grok"` or
/// `provider: "kimi"` without us shipping two identical baseURL records.
export const PROVIDERS = {
  ...CANONICAL,
  grok:   CANONICAL.xai,        // xAI Grok shares the xai endpoint
  kimi:   CANONICAL.moonshot,   // Kimi is Moonshot's consumer brand
  gemini: CANONICAL.google,     // Gemini is Google's model family on this endpoint
} as const;

export type LLMProvider = keyof typeof PROVIDERS;

const FORUM_SYSTEM_PROMPT = `You are an FX trading agent on FORUM, a prediction-market venue
for EURC/USDC on Arc Network. Your job is to estimate the probability that a given market
question resolves YES at the stated close time, given any context provided.

Output STRICT JSON only — no markdown, no commentary, no code fences. Use this exact shape:
{
  "outcome": "YES" | "NO",                 // your recommended position
  "probability": <number 0..1>,            // your estimate of P(YES) regardless of recommendation
  "confidence": <number 0..1>,             // confidence in your forecast itself
  "rationale": "<short reason, <= 200 chars>",
  "suggestedSizeUsdc": "<decimal string, e.g. 0.50>"
}

Rules:
- NEVER bet > 1.00 USDC per market in v0.1.
- If confidence < 0.60, set "suggestedSizeUsdc" to "0" and explain why.
- "outcome" should align with whichever side has > 0.50 probability under your estimate.
- Be skeptical of crowd consensus; the market price already reflects it.
`;

/// LLMDriver wraps the OpenAI SDK with FORUM-specific helpers. Stateless across calls.
export class LLMDriver {
  readonly client: OpenAI;
  readonly model: string;
  readonly timeoutMs: number;

  constructor(cfg: LLMConfig) {
    const preset = cfg.provider ? PROVIDERS[cfg.provider] : null;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL ?? preset?.baseURL ?? DEFAULT_LLM_BASE_URL,
    });
    this.model = cfg.model ?? preset?.defaultModel ?? DEFAULT_LLM_MODEL;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  /// Run a forecast against the FORUM system prompt. Returns a parsed `Forecast`.
  /// Throws on malformed JSON or unparseable response.
  async forecast(market: Market, ctx?: { peerSignals?: Record<string, unknown>[]; signal?: AbortSignal }): Promise<Forecast> {
    const userPrompt = renderMarketUserPrompt(market, ctx?.peerSignals);

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: FORUM_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      },
      {
        timeout: this.timeoutMs,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      },
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("LLM returned no content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`LLM returned non-JSON: ${raw.slice(0, 200)}`);
    }

    return validateForecast(parsed);
  }
}

export function renderMarketUserPrompt(market: Market, peerSignals?: Record<string, unknown>[]): string {
  const strike = (BigInt(market.strikeWad) * 100n) / 10n ** 18n;
  const lines = [
    `Market id: ${market.id}`,
    `Question: ${market.question}`,
    `Pair: ${market.pair}`,
    `Comparator + Strike: ${market.comparator} ${Number(strike) / 100}`,
    `Closes at (unix): ${market.closesAt}`,
    `Outstanding YES shares (WAD): ${market.qYesWad}`,
    `Outstanding NO shares (WAD): ${market.qNoWad}`,
    `Collateral escrowed (USDC base units): ${market.collateralEscrowed}`,
  ];
  if (peerSignals?.length) {
    lines.push("", "Peer signals (filtered by reputation):", JSON.stringify(peerSignals, null, 2));
  }
  return lines.join("\n");
}

/// Validate + narrow the LLM's JSON response into a Forecast. Tolerates aliases like
/// "yes"/"YES" + accepts numeric strings for probabilities (some models emit them).
export function validateForecast(input: unknown): Forecast {
  if (typeof input !== "object" || input === null) {
    throw new Error("forecast: not an object");
  }
  const o = input as Record<string, unknown>;

  const outcomeRaw = typeof o["outcome"] === "string" ? o["outcome"].toUpperCase() : "";
  if (outcomeRaw !== "YES" && outcomeRaw !== "NO") {
    throw new Error(`forecast: outcome must be "YES" or "NO", got ${JSON.stringify(o["outcome"])}`);
  }

  const probability = coerceUnitFloat(o["probability"], "probability");
  const confidence = coerceUnitFloat(o["confidence"], "confidence");

  const rationale =
    typeof o["rationale"] === "string" ? o["rationale"].slice(0, 500) : "(no rationale)";

  const sizeRaw = o["suggestedSizeUsdc"] ?? o["suggested_size_usdc"];
  const size = typeof sizeRaw === "string" ? sizeRaw : typeof sizeRaw === "number" ? String(sizeRaw) : "0";
  if (!/^\d+(\.\d+)?$/.test(size)) {
    throw new Error(`forecast: suggestedSizeUsdc must be decimal string, got ${JSON.stringify(sizeRaw)}`);
  }

  return {
    outcome: outcomeRaw,
    probability,
    confidence,
    rationale,
    suggestedSizeUsdc: size,
  };
}

function coerceUnitFloat(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`forecast: ${field} must be 0..1, got ${JSON.stringify(v)}`);
  }
  return n;
}
