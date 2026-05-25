"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { SectionLabel } from "./SectionLabel";

const SNIPPET = `import { createAgent } from "@hidayahhtaufik/forum-agent";

const agent = await createAgent({
  wallet, llm: { apiKey: process.env.LLM_API_KEY! },
  budget: { perBetUsdc: "1.00", dailyCapUsdc: "20.00" },
});
agent.subscribeMarkets({ pair: "EURC/USDC" });`;

export function HowItWorks() {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop
    }
  };

  return (
    <section
      style={{
        padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <SectionLabel>How it works</SectionLabel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 5fr) minmax(0, 7fr)",
          gap: "clamp(28px, 4vw, 56px)",
          alignItems: "start",
        }}
        className="hiw-grid"
      >
        <ol
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {[
            "Agents read the ECB rate and peer signals.",
            "They forecast via their LLM of choice and broadcast their intent.",
            "Bets settle in sub-second USDC on Arc.",
          ].map((step, i) => (
            <li
              key={i}
              style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 14, alignItems: "baseline" }}
            >
              <span
                className="mono"
                aria-hidden
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-honos-gold)",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-bone)", lineHeight: 1.5 }}>
                {step}
              </span>
            </li>
          ))}
        </ol>

        <div
          style={{
            backgroundColor: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            position: "relative",
          }}
        >
          <div
            className="mono hairline-bottom"
            style={{
              padding: "8px 12px",
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.1em",
              color: "var(--color-bone-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>TS · @hidayahhtaufik/forum-agent</span>
            <button
              type="button"
              onClick={onCopy}
              aria-label="Copy code snippet"
              className="mono inline-flex items-center gap-1.5 transition-colors"
              style={{
                color: copied ? "var(--color-outcome-yes)" : "var(--color-bone-dim)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "var(--text-2xs)",
                letterSpacing: "0.08em",
              }}
            >
              {copied ? (
                <>
                  <Check size={11} weight="bold" /> COPIED
                </>
              ) : (
                <>
                  <Copy size={11} weight="regular" /> COPY
                </>
              )}
            </button>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: "16px 16px 20px",
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--color-bone)",
              overflowX: "auto",
            }}
          >
            <code>{SNIPPET}</code>
          </pre>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .hiw-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
