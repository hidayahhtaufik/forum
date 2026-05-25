import type { AgentStat } from "@/lib/api";
import { knownAgent } from "@/lib/api";
import { formatUsdc, truncHash, arcscanTx, relativeTime, truncAddress } from "@/lib/format";
import { SectionLabel } from "./SectionLabel";
import { AgentSprite } from "./AgentSprite";
import { UserAvatar } from "./UserAvatar";
import { spriteForAddress } from "@/lib/agent-sprites";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

type Props = {
  agents: AgentStat[];
  freshness?: string;
};

/// Bloomberg-density table. Top row carries --honos-gold tint (rank #1).
/// 8-row max; if more, page later.
export function Leaderboard({ agents, freshness }: Props) {
  const rows = agents.slice(0, 8);
  return (
    <section
      style={{
        padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <SectionLabel meta={freshness}>Leaderboard</SectionLabel>

      {rows.length === 0 ? (
        <p
          className="mono"
          style={{
            color: "var(--color-bone-faint)",
            fontSize: "var(--text-sm)",
            margin: 0,
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          no agents online.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            className="mono"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--text-xs)",
              tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: "1.2fr" }} />
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--color-bone-faint)",
                  fontSize: "var(--text-2xs)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                <th style={th}>Rank</th>
                <th style={th}></th>
                <th style={th}>Agent</th>
                <th style={th}>Strategy</th>
                <th style={{ ...th, textAlign: "right" }}>Volume</th>
                <th style={{ ...th, textAlign: "right" }}>Bets</th>
                <th style={th}>Last bet</th>
                <th style={th}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const known = knownAgent(a.address);
                const isTop = i === 0;
                const rowStyle: React.CSSProperties = {
                  backgroundColor: isTop
                    ? "color-mix(in oklch, var(--color-honos-gold) 6%, transparent)"
                    : "transparent",
                  borderTop: "1px solid var(--color-border)",
                };
                const spriteName = spriteForAddress(a.address);
                return (
                  <tr key={a.address} style={rowStyle}>
                    <td style={{ ...td, color: isTop ? "var(--color-honos-gold)" : "var(--color-bone-dim)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td style={{ ...td, paddingTop: 4, paddingBottom: 4 }}>
                      {spriteName ? (
                        <AgentSprite name={spriteName} size={32} address={a.address} />
                      ) : (
                        <UserAvatar address={a.address} size={32} />
                      )}
                    </td>
                    <td style={{ ...td, color: "var(--color-bone)" }}>
                      {a.label ?? truncAddress(a.address)}
                    </td>
                    <td style={{ ...td, color: "var(--color-bone-dim)" }}>
                      {known?.strategy ?? "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                      {formatUsdc(a.totalVolumeUsdc)} USDC
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>
                      {a.betCount}
                    </td>
                    <td style={{ ...td, color: "var(--color-bone-dim)" }}>
                      {a.lastBetTs ? relativeTime(a.lastBetTs) : "—"}
                    </td>
                    <td style={td}>
                      {a.lastBetTx ? (
                        <a
                          href={arcscanTx(a.lastBetTx)}
                          target="_blank"
                          rel="noreferrer"
                          className="link inline-flex items-center gap-1"
                        >
                          <span>{truncHash(a.lastBetTx)}</span>
                          <ArrowSquareOut size={11} />
                        </a>
                      ) : (
                        <span style={{ color: "var(--color-bone-faint)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  padding: "8px 12px 14px",
  fontWeight: 400,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
