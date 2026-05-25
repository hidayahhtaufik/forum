import { describe, it, expect } from "vitest";
import { validateForecast, renderMarketUserPrompt } from "../src/llm.js";
import type { Market } from "../src/types.js";

const mockMarket: Market = {
  id: "0x9939c3c1143745d096d38fa39c6a36c6e8fd55d6e912573e0bff839a3d594b67",
  address: "0xfFE4E3943fdd6E100959A4FDa7ce2091dde24315",
  question: "Will EUR/USD close >= 1.10 at 16:00 CET on 2026-05-15?",
  pair: "EURUSD",
  strikeWad: "1100000000000000000",
  comparator: "GTE",
  bWad: "100000000000000000000",
  qYesWad: "0",
  qNoWad: "0",
  collateralEscrowed: "5000000",
  feeAccrued: "0",
  opensAt: 1_700_000_000,
  closesAt: 1_700_200_000,
  resolvesAt: null,
  phase: 0,
  winningOutcome: null,
  createdAtBlock: 41_802_934,
  createdAtTxHash: "0xf53d7647040112ae5131be786ec4d0b3f21f8ce6983cd802b899dd1ae2137e88",
  createdAt: 1_700_000_000,
};

describe("validateForecast", () => {
  it("accepts a well-formed forecast", () => {
    const f = validateForecast({
      outcome: "YES",
      probability: 0.7,
      confidence: 0.8,
      rationale: "ECB rate-cut probability priced low",
      suggestedSizeUsdc: "0.50",
    });
    expect(f.outcome).toBe("YES");
    expect(f.probability).toBe(0.7);
    expect(f.confidence).toBe(0.8);
    expect(f.suggestedSizeUsdc).toBe("0.50");
  });

  it("accepts numeric probability as string", () => {
    const f = validateForecast({
      outcome: "no",
      probability: "0.42",
      confidence: 0.55,
      rationale: "trend down",
      suggestedSizeUsdc: 0,
    });
    expect(f.outcome).toBe("NO");
    expect(f.probability).toBeCloseTo(0.42);
    expect(f.suggestedSizeUsdc).toBe("0");
  });

  it("rejects invalid outcome", () => {
    expect(() =>
      validateForecast({
        outcome: "MAYBE",
        probability: 0.5,
        confidence: 0.5,
        rationale: "x",
        suggestedSizeUsdc: "0",
      }),
    ).toThrow(/outcome must be/);
  });

  it("rejects probability out of [0,1]", () => {
    expect(() =>
      validateForecast({
        outcome: "YES",
        probability: 1.5,
        confidence: 0.5,
        rationale: "",
        suggestedSizeUsdc: "0",
      }),
    ).toThrow(/probability/);
  });

  it("rejects malformed suggestedSizeUsdc", () => {
    expect(() =>
      validateForecast({
        outcome: "YES",
        probability: 0.6,
        confidence: 0.6,
        rationale: "",
        suggestedSizeUsdc: "1,50",
      }),
    ).toThrow(/suggestedSizeUsdc/);
  });

  it("rejects non-object input", () => {
    expect(() => validateForecast("nope")).toThrow();
    expect(() => validateForecast(null)).toThrow();
  });
});

describe("renderMarketUserPrompt", () => {
  it("includes market id + question + strike", () => {
    const prompt = renderMarketUserPrompt(mockMarket);
    expect(prompt).toContain(mockMarket.id);
    expect(prompt).toContain("Will EUR/USD close");
    expect(prompt).toContain("GTE 1.1");
  });

  it("includes peer signals when provided", () => {
    const prompt = renderMarketUserPrompt(mockMarket, [
      { from: "0xalice", leansYes: true, confidence: 0.7 },
    ]);
    expect(prompt).toContain("Peer signals");
    expect(prompt).toContain("leansYes");
  });
});
