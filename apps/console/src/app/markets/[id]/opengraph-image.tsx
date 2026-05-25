/// Per-market OpenGraph card. Renders the actual market question + current
/// YES/NO odds as a 1200×630 PNG. When someone drops a /markets/<id> URL in
/// Discord or Twitter, this is what they see — far better unfurl than a
/// plain-text snippet.

import { ImageResponse } from "next/og";
import { fetchMarkets } from "@/lib/api";

export const alt = "FORUM market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CORAL = "#ED8466";
const BONE = "#FAF8F3";
const INK = "#0E5A6F";
const SKY = "#BBE5EF";
const SUN = "#F4D29A";
const PEACH = "#F2B591";
const GOLD = "#E0A65C";
const TEXT_DEEP = "#1A1814";
const YES_GREEN = "#3A8C5A";
const NO_RED = "#C26451";

export default async function MarketOG({ params }: { params: { id: string } }) {
  const markets = await fetchMarkets();
  const market = markets.find((m) => m.id.toLowerCase() === params.id.toLowerCase());

  // Compute current YES probability from LMSR shares (q_yes / (q_yes + q_no))
  let yesPct = 50;
  let noPct = 50;
  if (market) {
    const qYes = BigInt(market.qYesWad);
    const qNo = BigInt(market.qNoWad);
    const total = qYes + qNo;
    if (total > 0n) {
      yesPct = Number((qYes * 10_000n) / total) / 100;
      noPct = 100 - yesPct;
    }
  }

  const question = market?.question ?? "Forex prediction market on Arc";
  const collateral = market?.collateral ?? "USDC";
  const phase = market?.phase ?? 0;
  const phaseLabel =
    phase === 2 ? "RESOLVED" : phase === 1 ? "CLOSED" : "OPEN";
  const phaseTone = phase === 2 ? INK : phase === 1 ? GOLD : YES_GREEN;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(160deg, ${SKY} 0%, ${SUN} 70%, ${PEACH} 100%)`,
          padding: "56px 72px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Top strip */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: CORAL,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MiniCrab />
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: INK,
                textTransform: "uppercase",
              }}
            >
              FORUM · Arena
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Pill label={phaseLabel} bg={phaseTone} />
            <Pill label={collateral} bg={INK} />
          </div>
        </div>

        {/* Question */}
        <div
          style={{
            display: "flex",
            marginTop: 56,
            fontSize: question.length > 80 ? 44 : 56,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.015em",
            color: TEXT_DEEP,
            maxWidth: 1056,
          }}
        >
          {question}
        </div>

        {/* YES / NO bar */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", color: TEXT_DEEP, fontSize: 22, fontWeight: 600, letterSpacing: "0.06em" }}>
            <div style={{ display: "flex" }}>YES · {yesPct.toFixed(1)}%</div>
            <div style={{ display: "flex" }}>{noPct.toFixed(1)}% · NO</div>
          </div>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 38,
              borderRadius: 999,
              overflow: "hidden",
              border: `3px solid ${TEXT_DEEP}`,
              background: BONE,
            }}
          >
            <div
              style={{
                width: `${yesPct}%`,
                background: YES_GREEN,
                display: "flex",
              }}
            />
            <div
              style={{
                width: `${noPct}%`,
                background: NO_RED,
                display: "flex",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: INK,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            <div style={{ display: "flex" }}>
              forum.auranode.xyz/markets/{params.id.slice(0, 10)}…
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Pill label="LMSR" bg={GOLD} small />
              <Pill label="Arc Testnet" bg={INK} small />
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Pill({ label, bg, small }: { label: string; bg: string; small?: boolean }) {
  return (
    <div
      style={{
        padding: small ? "6px 14px" : "8px 18px",
        borderRadius: 999,
        background: bg,
        color: BONE,
        fontSize: small ? 16 : 18,
        fontWeight: 700,
        letterSpacing: "0.12em",
        display: "flex",
        alignItems: "center",
      }}
    >
      {label}
    </div>
  );
}

function MiniCrab() {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40">
      <circle cx="9.5" cy="17" r="3.6" fill={BONE} />
      <circle cx="30.5" cy="17" r="3.6" fill={BONE} />
      <ellipse cx="20" cy="23" rx="9" ry="6.5" fill={BONE} />
      <circle cx="15.6" cy="11" r="2.2" fill={BONE} />
      <circle cx="24.4" cy="11" r="2.2" fill={BONE} />
      <circle cx="15.6" cy="11" r="1" fill={TEXT_DEEP} />
      <circle cx="24.4" cy="11" r="1" fill={TEXT_DEEP} />
    </svg>
  );
}
