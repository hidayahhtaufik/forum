/// Client-side mirror of apps/market-api/src/lib/ai-providers.ts.
/// Used by StudioForm + AI config drawers to auto-detect the provider id
/// from the user's pasted Base URL so we can show a "Detected: openai" hint
/// without a round trip. The backend re-runs the same detection at write
/// time — the client copy is purely for live UX feedback.

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

export function detectProvider(baseUrl: string | null | undefined): AiProvider {
  if (!baseUrl) return "custom";
  const lower = baseUrl.toLowerCase();
  for (const { provider, host } of PROVIDER_HOST_PATTERNS) {
    if (lower.includes(host)) return provider;
  }
  return "custom";
}

export const AI_PROVIDERS: ReadonlyArray<{ id: AiProvider; label: string; defaultBaseUrl: string; defaultModel?: string }> = [
  { id: "claude",   label: "Claude (Anthropic)", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "openai",   label: "OpenAI",             defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "gemini",   label: "Gemini (Google)",    defaultBaseUrl: "https://generativelanguage.googleapis.com" },
  { id: "deepseek", label: "DeepSeek",           defaultBaseUrl: "https://api.deepseek.com" },
  { id: "xai",      label: "xAI Grok",           defaultBaseUrl: "https://api.x.ai" },
  // Pay-as-you-go is the default for MiMo. Token Plan subscribers can paste
  // their tp-prefixed key + override to https://token-plan-cn.xiaomimimo.com/v1.
  { id: "mimo",     label: "MiMo (Xiaomi)",      defaultBaseUrl: "https://api.xiaomimimo.com/v1", defaultModel: "mimo-v2.5-pro" },
  { id: "custom",   label: "Custom (OpenAI-compatible)", defaultBaseUrl: "" },
];
