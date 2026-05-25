// @hidayahhtaufik/forum-agent — public entry
// SDK for AI agents that trade on FORUM.

export const VERSION = "0.1.0";

// Agent factory + class
export { createAgent, Agent, BudgetExceededError, hashIntent } from "./agent.js";
export type { AgentConfig } from "./agent.js";

// LLM
export {
  LLMDriver,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  MAX_OUTPUT_TOKENS,
  PROVIDERS,
  validateForecast,
  renderMarketUserPrompt,
} from "./llm.js";
export type { LLMConfig, LLMProvider } from "./llm.js";

// Markets + EIP-3009
export { MarketApiClient, MarketApiError } from "./markets/client.js";
export { signTransferAuthorization, decodeRsv, randomNonce } from "./eip3009.js";
export type { SignedAuthorization } from "./eip3009.js";

// Types + chain
export type {
  Address,
  Hex,
  Market,
  Forecast,
  SignedQuote,
  BetIntent,
  BetReceipt,
  Eip3009Authorization,
  BudgetConfig,
  MarketEvent,
} from "./types.js";
export {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC,
  ARC_TESTNET_EXPLORER,
  ARC_USDC,
  ARC_EURC,
  ARC_USYC,
  USDC_EIP712_DOMAIN,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  parseUsdc,
  formatUsdc,
  usdcToWad,
  wadToUsdc,
  arcExplorerTx,
} from "./chain.js";
