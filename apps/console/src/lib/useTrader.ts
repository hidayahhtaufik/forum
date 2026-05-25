"use client";

import { useEffect, useState, useCallback } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { deriveIdentity, issueTrader, fetchTrader, type TraderInfo } from "./trader";

/// React hook that wires Dynamic login → server-issued FORUM trader wallet.
///
/// On every login state change:
///   1. Derive a stable identity string from Dynamic context (email or wallet addr).
///   2. POST /traders/issue — idempotent; returns the existing wallet or mints one.
///   3. Poll the balance every 6s + refresh on demand.
///
/// Returns null when the user is not yet authenticated.
export function useTrader() {
  const { user, primaryWallet } = useDynamicContext();
  const [trader, setTrader] = useState<TraderInfo | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive the identity string from Dynamic state. Memoized through deps.
  const identity = deriveIdentity({
    email: user?.email ?? null,
    walletAddress: primaryWallet?.address ?? null,
  });

  // Issue (or fetch) on identity change.
  useEffect(() => {
    if (!identity) {
      setTrader(null);
      return;
    }
    let cancelled = false;
    setIssuing(true);
    setError(null);
    (async () => {
      try {
        // Pass the connected Dynamic wallet so the server binds it as the
        // only EOA allowed to authorize privileged trader operations. See
        // apps/market-api/src/lib/auth.ts for the gate.
        const ownerWallet = primaryWallet?.address?.toLowerCase();
        const issued = await issueTrader(identity, ownerWallet);
        if (cancelled) return;
        const info = await fetchTrader(issued.address);
        if (cancelled) return;
        setTrader(info);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setIssuing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Manual refresh (after faucet/bet).
  const refresh = useCallback(async () => {
    if (!trader) return;
    try {
      const info = await fetchTrader(trader.address);
      if (info) setTrader(info);
    } catch {
      // non-fatal — keep prior balance on transient network error
    }
  }, [trader]);

  // Lightweight balance poll. Cheap on Arc — single eth_call.
  useEffect(() => {
    if (!trader) return;
    const interval = setInterval(() => {
      void refresh();
    }, 4_000);
    return () => clearInterval(interval);
  }, [trader, refresh]);

  return { trader, identity, issuing, error, refresh } as const;
}
