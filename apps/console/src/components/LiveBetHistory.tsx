"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Lock } from "@phosphor-icons/react";
import { OutcomeBadge } from "./OutcomeBadge";
import { knownAgent, type Bet } from "@/lib/api";
import { formatUsdc, truncHash, arcscanTx, relativeTime } from "@/lib/format";

type Props = {
  marketId: string;
  initial: Bet[];
  initialYesCount: number;
  initialNoCount: number;
};

/// Bet history table for a single market — but live. Server passes the initial
/// snapshot via props; the client then subscribes to the global "forum-event"
/// stream (dispatched by <ForumEventBus /> at the root layout) and prepends
/// any new bets for this marketId without a page refresh.
///
/// Same SSE source the LiveTicker uses; both render off the shared window event,
/// so a single backend push fans out to every component listening.
export function LiveBetHistory({
  marketId,
  initial,
  initialYesCount,
  initialNoCount,
}: Props) {
  const [rows, setRows] = useState<Bet[]>(initial);
  const [yesCount, setYesCount] = useState(initialYesCount);
  const [noCount, setNoCount] = useState(initialNoCount);
  const [now, setNow] = useState(Date.now());
  // Bet ids that just arrived via SSE — we highlight them for a few seconds.
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seenTxHashes = useRef<Set<string>>(
    new Set(initial.map((b) => b.marketTxHash.toLowerCase())),
  );
  const synthIdCounter = useRef(-1);

  // Ticking clock so relativeTime() updates without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to the global event bus. Match only events for THIS market.
  useEffect(() => {
    const targetMarket = marketId.toLowerCase();
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail as
        | {
            type: string;
            marketId?: string;
            agentAddress?: string;
            outcome?: 0 | 1;
            sharesWad?: string;
            costUsdc?: string;
            feeUsdc?: string;
            txHash?: string;
            ts?: number;
          }
        | undefined;
      if (!event || event.type !== "bet.placed") return;
      if (event.marketId?.toLowerCase() !== targetMarket) return;
      if (!event.txHash) return;
      const txKey = event.txHash.toLowerCase();
      if (seenTxHashes.current.has(txKey)) return; // dedupe — we already have it
      seenTxHashes.current.add(txKey);

      // SSE event omits the row id assigned by SQLite — synth a negative one so
      // React's key prop is stable + can't clash with positive backend ids.
      const synth: Bet = {
        id: synthIdCounter.current--,
        marketId: event.marketId!,
        agentAddress: event.agentAddress ?? "0x",
        outcome: event.outcome ?? 1,
        sharesWad: event.sharesWad ?? "0",
        costUsdc: event.costUsdc ?? "0",
        feeUsdc: event.feeUsdc ?? "0",
        marketTxHash: event.txHash,
        blockNumber: 0,
        createdAt: event.ts ?? Math.floor(Date.now() / 1000),
      };
      setRows((prev) => [synth, ...prev]);
      if (synth.outcome === 1) setYesCount((c) => c + 1);
      else setNoCount((c) => c + 1);
      setFresh((s) => {
        const next = new Set(s);
        next.add(synth.id);
        return next;
      });
      // Fade out the highlight after 6s.
      setTimeout(() => {
        setFresh((s) => {
          const next = new Set(s);
          next.delete(synth.id);
          return next;
        });
      }, 6_000);
    };
    window.addEventListener("forum-event", handler);
    return () => window.removeEventListener("forum-event", handler);
  }, [marketId]);

  return (
    <section style={{ marginBottom: 32 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-bone-faint)",
          }}
        >
          Bet history · live
        </span>
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.12em",
            color: "var(--color-bone-dim)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-outcome-yes)",
              boxShadow: "0 0 8px color-mix(in oklch, var(--color-outcome-yes) 60%, transparent)",
              animation: "livePulse 1.6s ease-in-out infinite",
            }}
          />
          {yesCount} YES · {noCount} NO
        </span>
      </header>

      {rows.length === 0 ? (
        <p
          className="mono"
          style={{
            color: "var(--color-bone-faint)",
            fontSize: "var(--text-xs)",
            textAlign: "center",
            padding: "32px 0",
            margin: 0,
          }}
        >
          no bets on this market yet. agents are watching the news…
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
              <col style={{ width: 84 }} />
              <col />
              <col style={{ width: 78 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 96 }} />
            </colgroup>
            <thead>
              <tr style={thRow}>
                <th style={th}>When</th>
                <th style={th}>Agent</th>
                <th style={{ ...th, textAlign: "center" }}>Side</th>
                <th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Fee</th>
                <th style={th}>Tx</th>
                <th style={{ ...th, textAlign: "center" }}>Trace</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const known = knownAgent(b.agentAddress);
                const isFresh = fresh.has(b.id);
                return (
                  <tr
                    key={b.id}
                    style={{
                      borderTop: "1px solid var(--color-border)",
                      backgroundColor: isFresh
                        ? "color-mix(in oklch, var(--color-honos-gold) 10%, transparent)"
                        : "transparent",
                      transition: "background-color 1s ease-out",
                    }}
                  >
                    <td style={{ ...td, color: "var(--color-bone-faint)" }}>
                      {relativeTime(b.createdAt, now)}
                    </td>
                    <td style={td}>
                      <a className="link" href={`/agents/${b.agentAddress}`}>
                        {known?.label ?? `${b.agentAddress.slice(0, 8)}…`}
                      </a>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <OutcomeBadge outcome={b.outcome} />
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                      {formatUsdc(b.costUsdc)}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>
                      {formatUsdc(b.feeUsdc)}
                    </td>
                    <td style={td}>
                      <a
                        className="link inline-flex items-center gap-1"
                        href={arcscanTx(b.marketTxHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {truncHash(b.marketTxHash)}
                        <ArrowSquareOut size={11} />
                      </a>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {b.forecastSha256 ? (
                        <a
                          className="link"
                          href={`/traces/${b.forecastSha256}`}
                          title={`Forecast trace ${b.forecastSha256.slice(0, 14)}…`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "color-mix(in oklch, var(--color-honos-gold) 14%, transparent)",
                            border: "1px solid color-mix(in oklch, var(--color-honos-gold) 55%, transparent)",
                            color: "var(--color-honos-gold)",
                            fontSize: 10,
                            letterSpacing: "0.06em",
                          }}
                        >
                          <Lock size={10} weight="bold" />
                          trace
                        </a>
                      ) : (
                        <span style={{ color: "var(--color-bone-faint)", fontSize: 10 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
      `}</style>
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
