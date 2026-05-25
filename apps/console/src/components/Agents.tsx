import type { AgentStat } from "@/lib/api";
import { knownAgent } from "@/lib/api";
import { SectionLabel } from "./SectionLabel";
import { AddressChip } from "./AddressChip";
import { AgentSprite } from "./AgentSprite";
import { spriteForAddress } from "@/lib/agent-sprites";
import { formatUsdc, relativeTime } from "@/lib/format";

type Props = { agents: AgentStat[] };

/// Rare card usage: two agent profile tiles. The ONLY place on the landing where
/// cards are the correct affordance — these are discrete objects (agents) with
/// equivalent visual weight + identity.
export function Agents({ agents }: Props) {
  const top = agents.slice(0, 4);
  if (top.length === 0) {
    return (
      <section
        style={{
          padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <SectionLabel>Agents</SectionLabel>
        <p
          className="mono"
          style={{
            color: "var(--color-bone-faint)",
            fontSize: "var(--text-sm)",
            margin: 0,
            textAlign: "center",
            padding: "32px 0",
          }}
        >
          no agents registered yet.
        </p>
      </section>
    );
  }
  return (
    <section
      style={{
        padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <SectionLabel>Agents</SectionLabel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        {top.map((a) => {
          const meta = knownAgent(a.address);
          const spriteName = spriteForAddress(a.address);
          return (
            <article
              key={a.address}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 4,
                padding: "20px 22px",
                backgroundColor: "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {spriteName && <AgentSprite name={spriteName} size={48} address={a.address} />}
                  <h3
                    className="mono"
                    style={{
                      margin: 0,
                      fontSize: "var(--text-base)",
                      fontWeight: 500,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--color-bone)",
                    }}
                  >
                    {a.label ?? "agent"}
                  </h3>
                </div>
                <AddressChip address={a.address} variant="explorer" />
              </header>

              <p
                className="mono"
                style={{
                  margin: 0,
                  fontSize: "var(--text-2xs)",
                  letterSpacing: "0.04em",
                  color: "var(--color-bone-faint)",
                  textTransform: "uppercase",
                }}
              >
                {meta?.strategy ?? "—"}
              </p>

              <dl
                className="mono"
                style={{
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  columnGap: 16,
                  rowGap: 4,
                  fontSize: "var(--text-xs)",
                }}
              >
                <dt style={dt}>volume</dt>
                <dd style={dd}>{formatUsdc(a.totalVolumeUsdc)} USDC</dd>
                <dt style={dt}>bets</dt>
                <dd style={dd}>{a.betCount}</dd>
                <dt style={dt}>last</dt>
                <dd style={dd}>{a.lastBetTs ? relativeTime(a.lastBetTs) : "—"}</dd>
              </dl>
            </article>
          );
        })}
      </div>
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
