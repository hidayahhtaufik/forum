/// /protocol/compliance — Institutional audit trail page.
///
/// Renders every resolved market with its full attestation chain:
///   market → close timestamp → ECB date used → rate → dataHash →
///   resolver signer → on-chain tx → arcscan link.
///
/// Matches the "compliance-ready architecture" + "deterministic finality"
/// language from Circle's prediction-market blueprint:
///   https://www.arc.io/blog/build-institutional-grade-prediction-markets-on-arc-arc-blueprints

import Link from "next/link";
import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { fetchAuditTrail } from "@/lib/api";
import { arcscanTx, truncHash, truncAddress, relativeTime } from "@/lib/format";
import type { Metadata } from "next";
import { formatUnits } from "viem";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audit trail · Compliance",
  description:
    "Institutional audit trail — every FORUM market resolution attested against the ECB reference rate, signed EIP-712, settled on-chain on Arc.",
};

function labelPair(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}/${code.slice(3)}`;
}

function outcomeLabel(o: 0 | 1 | 2): string {
  return o === 1 ? "YES" : o === 0 ? "NO" : "VOID";
}

function formatStrike(strikeWad: string): string {
  try {
    return Number(formatUnits(BigInt(strikeWad), 18)).toFixed(4);
  } catch {
    return strikeWad;
  }
}

export default async function CompliancePage() {
  const trail = await fetchAuditTrail(100);
  const rows = trail?.rows ?? [];
  const commitments = trail?.commitments ?? null;

  return (
    <IslandLayout>
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "clamp(40px, 6vw, 72px) clamp(20px, 4vw, 56px) clamp(48px, 6vw, 80px)",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Link
            href="/protocol/stats"
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              color: "var(--color-bone-dim)",
              textDecoration: "none",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            ← Protocol stats
          </Link>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 700,
              margin: 0,
              color: "var(--color-bone)",
              lineHeight: 1.1,
            }}
          >
            🛡️ Compliance & audit trail
          </h1>
          <p
            className="mono"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-bone-dim)",
              margin: 0,
              maxWidth: "62ch",
              lineHeight: 1.6,
            }}
          >
            Every FORUM resolution is signed EIP-712, attested against the ECB
            reference rate via Frankfurter, hashed deterministically, and
            settled on Arc. {rows.length} resolution
            {rows.length === 1 ? "" : "s"} on record.
          </p>
        </header>

        {commitments && (
          <section
            aria-label="Public commitments"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            <CommitmentCard
              title="Deterministic finality"
              body={commitments.deterministicFinality}
              tone="lavender"
            />
            <CommitmentCard
              title="Attested source"
              body={commitments.attestedSource}
              tone="mint"
            />
            <CommitmentCard
              title="Signed resolution"
              body={commitments.signedResolution}
              tone="sky"
            />
            <CommitmentCard
              title="Auditability"
              body={commitments.auditability}
              tone="peach"
            />
          </section>
        )}

        <section
          className="mono"
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            paddingBottom: 14,
            borderBottom: "1px solid var(--color-line)",
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-bone-dim)",
          }}
        >
          <span>Attested resolutions</span>
          <span>
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
        </section>

        {rows.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              borderRadius: 18,
              border: "1.5px dashed var(--color-border)",
              background: "var(--color-raised)",
              textAlign: "center",
              color: "var(--color-bone-dim)",
              fontSize: "var(--text-sm)",
            }}
          >
            No resolved markets yet. Audit rows appear here once the resolver
            attests the first market against the ECB reference rate.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r) => (
              <AuditRow key={r.marketId} row={r} />
            ))}
          </div>
        )}

        <Footer />
      </main>
    </IslandLayout>
  );
}

function CommitmentCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "lavender" | "mint" | "sky" | "peach";
}) {
  const tint =
    tone === "lavender"
      ? "var(--color-pastel-lavender)"
      : tone === "mint"
        ? "var(--color-pastel-mint)"
        : tone === "sky"
          ? "var(--color-pastel-sky)"
          : "var(--color-pastel-peach)";
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 14,
        border: "1px solid var(--color-line)",
        background: `color-mix(in oklch, ${tint} 22%, var(--color-surface))`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-bone-dim)",
        }}
      >
        ✓ {title}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-bone)", lineHeight: 1.55 }}>
        {body}
      </div>
    </div>
  );
}

function AuditRow({
  row,
}: {
  row: import("@/lib/api").AuditTrailRow;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.6fr) 1fr",
        gap: 24,
        padding: "16px 18px",
        borderRadius: 14,
        border: "1px solid var(--color-line)",
        background: "var(--color-surface)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <Link
          href={`/markets/${row.marketId}`}
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--color-bone)",
            textDecoration: "none",
            lineHeight: 1.35,
          }}
        >
          {row.question}
        </Link>
        <div
          className="mono"
          style={{ fontSize: "var(--text-2xs)", color: "var(--color-bone-dim)" }}
        >
          {labelPair(row.pair)} · strike {row.comparator}{" "}
          {formatStrike(row.strikeWad)} · created by {row.createdBy}
        </div>
      </div>
      <div
        className="mono"
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          rowGap: 4,
          columnGap: 12,
          fontSize: "var(--text-2xs)",
          color: "var(--color-bone-dim)",
          alignContent: "start",
        }}
      >
        <span>outcome</span>
        <span
          style={{
            color:
              row.outcome === 1
                ? "var(--color-pastel-mint)"
                : row.outcome === 0
                  ? "var(--color-pastel-peach)"
                  : "var(--color-bone-faint)",
            fontWeight: 600,
          }}
        >
          {outcomeLabel(row.outcome)}
        </span>
        {row.ecbDate && row.ecbRate ? (
          <>
            <span>ECB</span>
            <span style={{ color: "var(--color-bone)" }}>
              {row.ecbDate} · {row.ecbRate}
            </span>
          </>
        ) : null}
        <span>signer</span>
        <span style={{ color: "var(--color-bone)" }}>{truncAddress(row.signer)}</span>
        <span>data hash</span>
        <span style={{ color: "var(--color-bone)" }}>{truncHash(row.dataHash)}</span>
        <span>resolved</span>
        <span>{relativeTime(row.resolvedAt)}</span>
        <span>tx</span>
        <a
          href={arcscanTx(row.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--color-bone)",
            textDecoration: "none",
          }}
        >
          {truncHash(row.txHash)} <ArrowSquareOut size={11} weight="bold" />
        </a>
      </div>
    </div>
  );
}
