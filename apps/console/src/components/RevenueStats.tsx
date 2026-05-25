import type { ProtocolStats } from "@/lib/api";
import { formatUsdc, arcscanAddress, truncAddress } from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

/// Hero-strip revenue banner. Surfaces FORUM's economic model — every bet
/// settled pays a 2% protocol fee that pools at the treasury wallet. This
/// is the moat: as agents trade more, the protocol accrues real revenue.
/// Mounted on landing so the first thing a judge sees is "this protocol
/// already has revenue, not just a promise".

type Props = {
  stats: ProtocolStats;
};

export function RevenueStats({ stats }: Props) {
  const treasuryBalance = BigInt(stats.treasuryBalance);
  const totalFees = BigInt(stats.totalFeesAccrued);
  const totalVolume = BigInt(stats.totalVolume);

  return (
    <section
      style={{
        padding: "clamp(36px, 5vw, 56px) clamp(20px, 4vw, 56px)",
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          padding: "clamp(24px, 4vw, 36px)",
          background: "color-mix(in oklch, var(--color-honos-gold) 4%, var(--color-raised))",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              className="mono"
              style={{
                fontSize: "var(--text-2xs)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--color-honos-gold)",
              }}
            >
              ● Protocol economics · live
            </span>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "clamp(20px, 2.6vw, 28px)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--color-bone)",
              }}
            >
              Every bet pays a 2% fee. The treasury keeps the score.
            </h2>
          </div>
          <a
            href={arcscanAddress(stats.treasuryAddress)}
            target="_blank"
            rel="noreferrer"
            className="link mono inline-flex items-center gap-1"
            style={{ fontSize: "var(--text-xs)" }}
            title="Treasury wallet on Arcscan"
          >
            treasury {truncAddress(stats.treasuryAddress)}
            <ArrowSquareOut size={11} />
          </a>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 24,
          }}
        >
          <StatCell
            label="Treasury balance"
            value={`${formatUsdc(treasuryBalance)} USDC`}
            note="on-chain · pays gas + retains fees"
            accent="gold"
          />
          <StatCell
            label="Total fees accrued"
            value={`${formatUsdc(totalFees)} USDC`}
            note="2% of every settled bet"
            accent="yes"
          />
          <StatCell
            label="Total volume"
            value={`${formatUsdc(totalVolume)} USDC`}
            note={`${stats.betCount} bets · ${stats.agentCount} addresses`}
          />
          <StatCell
            label="Markets"
            value={`${stats.marketsTotal}`}
            note={`${stats.marketsOpen} live · ${stats.marketsResolved} resolved`}
          />
        </div>

        <footer
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.06em",
            color: "var(--color-bone-faint)",
            lineHeight: 1.6,
          }}
        >
          Fees split 1% protocol / 1% creator at v0.2. v0.1: all fees pool in the
          treasury wallet, fund gas costs, and the surplus is the protocol's
          revenue. Every figure above is reconstructable from on-chain state —
          click the treasury address to verify against Arcscan.
        </footer>
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  note,
  accent = "bone",
}: {
  label: string;
  value: string;
  note: string;
  accent?: "bone" | "gold" | "yes";
}) {
  const valueColor =
    accent === "gold"
      ? "var(--color-honos-gold)"
      : accent === "yes"
        ? "var(--color-outcome-yes)"
        : "var(--color-bone)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: "clamp(20px, 2.2vw, 26px)",
          fontWeight: 600,
          color: valueColor,
          letterSpacing: "-0.005em",
        }}
      >
        {value}
      </span>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.04em",
          color: "var(--color-bone-dim)",
        }}
      >
        {note}
      </span>
    </div>
  );
}
