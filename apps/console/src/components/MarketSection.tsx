"use client";

import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Market, Bet } from "@/lib/api";
import { SectionLabel } from "./SectionLabel";
import { OutcomeBadge } from "./OutcomeBadge";
import { formatUsdc, formatStrikeWad, relativeTime, wadToNumber } from "@/lib/format";

type Props = {
  market: Market | null;
  bets: Bet[];
};

/// Single live market detail: question + outcomes + metadata + single-line area chart.
/// The chart shows YES probability over time, derived from cumulative shares.
export function MarketSection({ market, bets }: Props) {
  if (!market) {
    return (
      <section
        style={{
          padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <SectionLabel>The market</SectionLabel>
        <p className="mono" style={{ color: "var(--color-bone-faint)", margin: 0 }}>
          no open market right now. first market opens 2026-05-15.
        </p>
      </section>
    );
  }

  // LMSR price for YES at q_yes, q_no: e^(qY/b) / (e^(qY/b) + e^(qN/b)).
  // Use Math.exp on Numbers — wad values are < 100 in practice for v0.1.
  const qYes = wadToNumber(market.qYesWad);
  const qNo = wadToNumber(market.qNoWad);
  const bWad = wadToNumber(market.bWad);
  const yesProb = useMemo(() => {
    if (bWad === 0) return 0.5;
    const eYes = Math.exp(qYes / bWad);
    const eNo = Math.exp(qNo / bWad);
    return eYes / (eYes + eNo);
  }, [qYes, qNo, bWad]);

  const noProb = 1 - yesProb;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // Build a synthetic time series from the historical bets in this market.
  // We replay each bet to derive the YES probability at that point.
  const series = useMemo(() => {
    const marketBets = bets
      .filter((b) => b.marketId === market.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (marketBets.length === 0) {
      return [
        { ts: market.createdAt, prob: 0.5 },
        { ts: Math.floor(Date.now() / 1000), prob: yesProb },
      ];
    }
    let cumYes = 0;
    let cumNo = 0;
    const points: { ts: number; prob: number }[] = [{ ts: market.createdAt, prob: 0.5 }];
    for (const b of marketBets) {
      const dShares = wadToNumber(b.sharesWad);
      if (b.outcome === 1) cumYes += dShares;
      else cumNo += dShares;
      const eY = Math.exp(cumYes / bWad);
      const eN = Math.exp(cumNo / bWad);
      points.push({ ts: b.createdAt, prob: eY / (eY + eN) });
    }
    // Append current as the rightmost point.
    points.push({ ts: Math.floor(Date.now() / 1000), prob: yesProb });
    return points;
  }, [bets, market.id, market.createdAt, bWad, yesProb]);

  const totalVolume = bets
    .filter((b) => b.marketId === market.id)
    .reduce((acc, b) => acc + BigInt(b.costUsdc) + BigInt(b.feeUsdc), 0n);

  const closesInSec = market.closesAt - Math.floor(Date.now() / 1000);
  const closesIn =
    closesInSec <= 0
      ? "closed"
      : closesInSec < 3600
        ? `${Math.floor(closesInSec / 60)}m`
        : closesInSec < 86400
          ? `${Math.floor(closesInSec / 3600)}h`
          : `${Math.floor(closesInSec / 86400)}d`;

  return (
    <section
      style={{
        padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <SectionLabel>The market</SectionLabel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 6fr) minmax(0, 6fr)",
          gap: "clamp(24px, 4vw, 56px)",
          alignItems: "center",
        }}
        className="market-grid"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(20px, 2.6vw, 28px)",
              fontWeight: 500,
              lineHeight: 1.3,
              color: "var(--color-bone)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {market.question}
          </h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <OutcomeBadge outcome={1} pct={pct(yesProb)} size="md" />
            <OutcomeBadge outcome={0} pct={pct(noProb)} size="md" />
          </div>

          <dl
            className="mono"
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--color-bone-dim)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 16,
              rowGap: 6,
            }}
          >
            <dt style={dt}>strike</dt>
            <dd style={dd}>{market.comparator} {formatStrikeWad(market.strikeWad)}</dd>
            <dt style={dt}>closes</dt>
            <dd style={dd}>in {closesIn}</dd>
            <dt style={dt}>bets</dt>
            <dd style={dd}>{bets.filter((b) => b.marketId === market.id).length}</dd>
            <dt style={dt}>volume</dt>
            <dd style={dd}>{formatUsdc(totalVolume)} USDC</dd>
            <dt style={dt}>subsidy</dt>
            <dd style={dd}>{formatUsdc(BigInt(market.collateralEscrowed))} USDC</dd>
          </dl>
        </div>

        <div
          style={{
            height: 220,
            backgroundColor: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            padding: "12px 12px 8px",
            position: "relative",
          }}
        >
          <div
            className="mono"
            style={{
              position: "absolute",
              top: 12,
              left: 16,
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-bone-faint)",
              zIndex: 1,
            }}
          >
            YES probability
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(68% 0.16 145)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="oklch(68% 0.16 145)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="ts"
                type="number"
                domain={["dataMin", "dataMax"]}
                hide
              />
              <YAxis
                domain={[0, 1]}
                hide
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]!.payload as { ts: number; prob: number };
                  return (
                    <div
                      className="mono"
                      style={{
                        backgroundColor: "var(--color-ground)",
                        border: "1px solid var(--color-border)",
                        padding: "6px 10px",
                        fontSize: "var(--text-2xs)",
                        color: "var(--color-bone)",
                      }}
                    >
                      <div>{(p.prob * 100).toFixed(1)}%</div>
                      <div style={{ color: "var(--color-bone-faint)" }}>
                        {new Date(p.ts * 1000).toLocaleTimeString()}
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="prob"
                stroke="oklch(68% 0.16 145)"
                strokeWidth={1.5}
                fill="url(#yesFill)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .market-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

const dt: React.CSSProperties = {
  color: "var(--color-bone-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "var(--text-2xs)",
  margin: 0,
};

const dd: React.CSSProperties = {
  margin: 0,
  color: "var(--color-bone)",
};
