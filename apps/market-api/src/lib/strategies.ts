/// Strategy library — the menu of pre-built trading strategies a user can
/// pick when they spawn a custom agent via POST /agents/spawn.
///
/// Each strategy maps to one of the existing reference agent personas
/// in `examples/forum-*` so the agent-loop knows how to dispatch
/// behavior for a user-spawned wallet. Adding a new strategy is a
/// matter of writing a new example agent + appending an entry here.
///
/// Default agents (Oracle / Sage / Hermes / Augur / Mirror) already
/// expose these strategies — user-spawned agents pick one of these
/// `id`s at creation time and inherit the same decision loop.

export type StrategyId =
  | "standard"
  | "conservative"
  | "contrarian"
  | "edge_weighted"
  | "copy_oracle"
  | "consensus";

export type StrategyDef = {
  id: StrategyId;
  /** Human-readable label shown in the /studio picker UI. */
  label: string;
  /** One-line description shown under the label. */
  tagline: string;
  /** Longer prose for the agent profile card after spawn. */
  description: string;
  /** Which reference agent runtime implements this strategy. */
  basedOn: "oracle" | "sage" | "hermes" | "augur" | "mirror";
  /** Default LLM model identifier. User can override in /studio. */
  defaultLlmModel: string;
  /** Default per-bet USDC cap (6-dec base units string). */
  defaultPerBetUsdc: string;
  /** Default daily-cap USDC. */
  defaultDailyCapUsdc: string;
  /** Whether this strategy uses LLM forecasting at all. Mirror = false. */
  usesLlm: boolean;
};

export const STRATEGIES: ReadonlyArray<StrategyDef> = [
  {
    id: "standard",
    label: "Standard Forecaster",
    tagline: "LLM-driven independent forecaster — read news, weigh evidence, bet.",
    description:
      "Pulls the ECB reference rate and lets the LLM forecast EUR/USD outcomes from scratch. " +
      "Sizes positions per confidence × Kelly fraction. Closest analog to Oracle.",
    basedOn: "oracle",
    defaultLlmModel: "deepseek-v4-pro",
    defaultPerBetUsdc: "0.20",
    defaultDailyCapUsdc: "5.00",
    usesLlm: true,
  },
  {
    id: "conservative",
    label: "Conservative",
    tagline: "Only bets at high confidence + clear price gap.",
    description:
      "Skips bets unless the model's confidence is ≥ 0.85 AND the implied gap from 0.5 is ≥ 0.05. " +
      "Low volume, high hit-rate. Closest analog to Sage.",
    basedOn: "sage",
    defaultLlmModel: "mimo-v2.5",
    defaultPerBetUsdc: "0.12",
    defaultDailyCapUsdc: "5.00",
    usesLlm: true,
  },
  {
    id: "contrarian",
    label: "Contrarian",
    tagline: "Fades the consensus — bet against the crowd.",
    description:
      "When |yesProb − 0.5| > 0.001 it takes the opposite side. On fresh markets it seeds a coin-flip " +
      "bet so price discovery starts. Closest analog to Hermes.",
    basedOn: "hermes",
    defaultLlmModel: "mimo-v2-pro",
    defaultPerBetUsdc: "0.10",
    defaultDailyCapUsdc: "5.00",
    usesLlm: true,
  },
  {
    id: "edge_weighted",
    label: "Edge-Weighted Aggressive",
    tagline: "Kelly-style sizing — bigger bets when the edge is wider.",
    description:
      "Computes the edge = LLM probability − market-implied probability and sizes bets as " +
      "perBet × edge × 4, capped. Aggressive into mispriced markets. Closest analog to Augur.",
    basedOn: "augur",
    defaultLlmModel: "mimo-v2-omni",
    defaultPerBetUsdc: "0.15",
    defaultDailyCapUsdc: "5.00",
    usesLlm: true,
  },
  {
    id: "copy_oracle",
    label: "Copy Oracle",
    tagline: "Mirrors Oracle's bets at a configurable size multiplier.",
    description:
      "No LLM call. Subscribes to Oracle's AXL OpinionShare messages and places a scaled bet. " +
      "Zero token cost. Closest analog to Mirror.",
    basedOn: "mirror",
    defaultLlmModel: "(rule-based, no LLM)",
    defaultPerBetUsdc: "0.10",
    defaultDailyCapUsdc: "5.00",
    usesLlm: false,
  },
  {
    id: "consensus",
    label: "Consensus Aggregator",
    tagline: "Aggregates peer forecasts and bets the majority.",
    description:
      "Listens to forecasts from peer agents for a given market, " +
      "weights each peer's vote by its declared confidence, then bets the dominant side. " +
      "Honos-weighted in v0.2.",
    basedOn: "mirror",
    defaultLlmModel: "(rule-based, no LLM)",
    defaultPerBetUsdc: "0.12",
    defaultDailyCapUsdc: "5.00",
    usesLlm: false,
  },
] as const;

export function getStrategy(id: string): StrategyDef | null {
  return STRATEGIES.find((s) => s.id === id) ?? null;
}
