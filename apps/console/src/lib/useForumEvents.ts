"use client";

/// React hook to subscribe to FORUM's SSE event stream. Emits a global
/// CustomEvent("forum-event") with the typed payload so any component on the
/// page can listen without prop-drilling. Polling fallback every 5s if SSE
/// disconnects.

import { useEffect } from "react";

const API = process.env.NEXT_PUBLIC_MARKET_API_URL ?? "http://127.0.0.1:8403";

export type ForumEvent =
  | { type: "ready"; ts: number }
  | { type: "market.created"; marketId: string; address: string; question: string; pair: string; opensAt: number; closesAt: number; txHash: string; blockNumber: number; ts: number }
  | { type: "bet.placed"; marketId: string; agentAddress: string; outcome: 0 | 1; sharesWad: string; costUsdc: string; feeUsdc: string; txHash: string; ts: number }
  | { type: "market.resolved"; marketId: string; outcome: 0 | 1 | 2; source: string; txHash: string; ts: number }
  | { type: "claim.fired"; marketId: string; agentAddress: string; claimedUsdc: string; txHash: string; ts: number }
  | { type: "agent.broadcast"; id: number; sender: string; envelopeType: string; marketId: string | null; bodyJson: string; sigPrefix: string; signedAt: number; ts: number };

/// Mount once near the root of any page that wants realtime updates. Returns
/// nothing — components listen via `window.addEventListener("forum-event", ...)`.
export function useForumEvents() {
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // Reconnect-retry handle. Stored so back-to-back SSE errors don't
    // stack overlapping setTimeouts (each of which would race to call
    // connectSSE and leave dangling EventSource + polling at once).
    let retryHandle: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const dispatch = (event: ForumEvent) => {
      window.dispatchEvent(new CustomEvent("forum-event", { detail: event }));
    };

    const connectSSE = () => {
      try {
        es = new EventSource(`${API}/events`);

        const handler = (type: ForumEvent["type"]) => (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            dispatch({ type, ...payload } as ForumEvent);
          } catch {
            // malformed frame — ignore
          }
        };

        es.addEventListener("ready", handler("ready"));
        es.addEventListener("market.created", handler("market.created"));
        es.addEventListener("bet.placed", handler("bet.placed"));
        es.addEventListener("market.resolved", handler("market.resolved"));
        es.addEventListener("claim.fired", handler("claim.fired"));
        es.addEventListener("agent.broadcast", handler("agent.broadcast"));

        es.onerror = () => {
          // SSE dropped — fall back to polling until next attempt
          if (es) {
            es.close();
            es = null;
          }
          if (!cancelled && !pollTimer) {
            startPolling();
          }
          // Clear any pending retry so back-to-back error events don't
          // stack overlapping connectSSE() calls.
          if (retryHandle) clearTimeout(retryHandle);
          retryHandle = setTimeout(() => {
            retryHandle = null;
            if (!cancelled) {
              stopPolling();
              connectSSE();
            }
          }, 10_000);
        };
      } catch {
        startPolling();
      }
    };

    /// Polling fallback — fetches recent bets every 5s and synthesizes
    /// bet.placed events for any new ones since the last poll. Cheaper than
    /// 1Hz polling on /markets too.
    let lastSeenBetId = 0;
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        if (cancelled) return;
        try {
          const res = await fetch(`${API}/bets/recent?limit=20`, { cache: "no-store" });
          if (!res.ok) return;
          const { bets } = (await res.json()) as {
            bets: Array<{
              id: number;
              marketId: string;
              agentAddress: string;
              outcome: 0 | 1;
              sharesWad: string;
              costUsdc: string;
              feeUsdc: string;
              marketTxHash: string;
              createdAt: number;
            }>;
          };
          for (const b of bets) {
            if (b.id > lastSeenBetId) {
              lastSeenBetId = b.id;
              dispatch({
                type: "bet.placed",
                marketId: b.marketId,
                agentAddress: b.agentAddress,
                outcome: b.outcome,
                sharesWad: b.sharesWad,
                costUsdc: b.costUsdc,
                feeUsdc: b.feeUsdc,
                txHash: b.marketTxHash,
                ts: b.createdAt,
              });
            }
          }
        } catch {
          // network blip — try again next tick
        }
      }, 5_000);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    connectSSE();

    return () => {
      cancelled = true;
      if (es) es.close();
      stopPolling();
      if (retryHandle) {
        clearTimeout(retryHandle);
        retryHandle = null;
      }
    };
  }, []);
}
