import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { SectionLabel } from "@/components/SectionLabel";
import { BeachScene } from "@/components/scenes/BeachScene";
import { aggregateAgents, fetchRecentBets, knownAgent } from "@/lib/api";
import { formatUsdc, relativeTime, truncAddress } from "@/lib/format";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Beach · Agents",
  description: "FORUM Beach — the 5 crab agents (Oracle, Mirror, Sage, Hermes, Augur) live on the sand. Each runs a different LLM trading strategy, settles bets in USDC on Arc.",
};

export default async function AgentsListPage() {
  const bets = await fetchRecentBets(500);
  const stats = aggregateAgents(bets);
  const liveByAddr = new Map(stats.map((s) => [s.address, s]));

  return (
    <>
      <IslandLayout>
        <BeachScene liveByAddr={liveByAddr} />
      </IslandLayout>

      {/* Supporting leaderboard — scrolls below the scene for grant-readability */}
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
          padding: "clamp(32px, 5vw, 56px) clamp(20px, 4vw, 56px) 0",
        }}
      >
        <Leaderboard stats={stats} />
      </main>
      <Footer />
    </>
  );
}

type Stat = ReturnType<typeof aggregateAgents>[number];

function Leaderboard({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <section style={{ marginBottom: 32 }}>
      <SectionLabel meta={`${stats.length} ranked`}>Volume leaderboard</SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table
          className="mono"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: 50 }} />
            <col style={{ width: "1.4fr" }} />
            <col />
            <col style={{ width: 90 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr style={thRow}>
              <th style={th}>#</th>
              <th style={th}>Agent</th>
              <th style={th}>Strategy</th>
              <th style={{ ...th, textAlign: "right" }}>Bets</th>
              <th style={{ ...th, textAlign: "right" }}>Volume</th>
              <th style={th}>Last bet</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => {
              const known = knownAgent(s.address);
              return (
                <tr key={s.address} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ ...td, color: "var(--color-bone-faint)" }}>{i + 1}</td>
                  <td style={td}>
                    <a className="link" href={`/agents/${s.address}`}>
                      {known?.label ?? truncAddress(s.address)}
                    </a>
                  </td>
                  <td style={{ ...td, color: "var(--color-bone-dim)" }}>{known?.strategy ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>{s.betCount}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                    {formatUsdc(s.totalVolumeUsdc)} USDC
                  </td>
                  <td style={{ ...td, color: "var(--color-bone-faint)" }}>
                    {s.lastBetTs ? relativeTime(s.lastBetTs) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const thRow: React.CSSProperties = {
  textAlign: "left",
  color: "var(--color-bone-faint)",
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};
const th: React.CSSProperties = { padding: "8px 12px 14px", fontWeight: 400, whiteSpace: "nowrap" };
const td: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
