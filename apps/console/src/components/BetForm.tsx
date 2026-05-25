"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useTrader } from "@/lib/useTrader";
import { placeTraderBet, fetchQuote, type Quote } from "@/lib/trader";
import { signerFromDynamic } from "@/lib/auth";
import { arcscanTx, truncHash } from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { X402Icon } from "./BrandIcons";

type Props = {
  marketId: string;
  marketPhase: 0 | 1 | 2;
  /** Unix seconds. When set + already past, the form disables itself so
   *  users can't trigger an on-chain `WrongPhase()` revert by clicking bet
   *  on a market that just closed during the page session. */
  closesAt?: number;
};

/// Manual bet form — Polymarket-style. Server signs intent + EIP-3009 using
/// the user's custodial trader privkey, so this works uniformly for Rabby
/// wallet logins AND Google/email logins (Dynamic Dria smart wallets). USDC
/// EIP-3009 ecrecover only ever sees the trader EOA address.
export function BetForm({ marketId, marketPhase, closesAt }: Props) {
  const router = useRouter();
  const { user, primaryWallet, setShowAuthFlow } = useDynamicContext();
  const { trader, issuing, refresh } = useTrader();

  // Local close gate — server contract reverts with WrongPhase() if a bet
  // hits a CLOSED clone (phase 1) or a market whose closesAt has passed since
  // the page server-rendered. We surface this client-side to spare users a
  // 60s "settling on-chain…" spinner that ends in a 502 error toast.
  const closed =
    marketPhase !== 0 || (closesAt != null && closesAt * 1000 < Date.now());

  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("0.50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash: string; cost: string } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Live LMSR quote — debounced 300ms while user types. Refresh when outcome flips.
  useEffect(() => {
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0 || marketPhase !== 0) {
      setQuote(null);
      return;
    }
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const q = await fetchQuote({ marketId, outcome, amountUsdc: amount });
        setQuote(q);
        setQuoteError(null);
      } catch (err) {
        setQuote(null);
        setQuoteError((err as Error).message);
      } finally {
        setQuoteLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [amount, outcome, marketId, marketPhase]);

  if (marketPhase === 2) return null;

  // Not logged in: prompt connect.
  if (!user && !primaryWallet) {
    return (
      <section style={shellStyle}>
        <span className="mono" style={labelStyle}>Place a bet</span>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-bone-dim)", lineHeight: 1.5 }}>
          Sign in with Google, email, or any EVM wallet to bet alongside the agents.
          We auto-issue a FORUM trader wallet — no chain setup needed.
        </p>
        <button onClick={() => setShowAuthFlow(true)} style={ctaPrimary}>connect or sign in</button>
      </section>
    );
  }

  if (issuing || !trader) {
    return (
      <section style={shellStyle}>
        <span className="mono" style={labelStyle}>Place a bet</span>
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-bone-dim)" }}>
          issuing trader wallet…
        </p>
      </section>
    );
  }

  const balance = Number(trader.usdcBalanceFormatted);
  const balanceOk = balance >= Number(amount || "0");

  const onSubmit = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      // Auth gate — server requires an EIP-712 sig from the connected
      // Dynamic wallet before decrypting the trader privkey + broadcasting.
      if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
        throw new Error("Connect an Ethereum wallet to authorize this bet");
      }
      const signer = await signerFromDynamic(primaryWallet);
      const result = await placeTraderBet({
        traderAddress: trader.address,
        marketId,
        outcome,
        amountUsdc: amount,
        signer,
      });
      setSuccess({ txHash: result.txHash, cost: result.costUsdc });
      await refresh();
      // Trigger Next.js server-component re-fetch so Arena scene + Participants
      // table + LiveBetHistory pick up the new bet without a full page reload.
      // Tiny delay so the indexer DB upsert has time to land before we re-query.
      setTimeout(() => router.refresh(), 700);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={shellStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="mono" style={labelStyle}>Place a bet</span>
        <h3 style={headerStyle}>Bet alongside the agents</h3>
      </div>

      <div style={miniBalanceStyle}>
        <span className="mono" style={miniBalanceLabel}>FORUM wallet</span>
        <span className="mono" style={{ color: balanceOk ? "var(--color-bone)" : "var(--color-tessera-oxblood)" }}>
          {trader.usdcBalanceFormatted} USDC
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button
          type="button"
          onClick={() => setOutcome(1)}
          style={outcome === 1 ? btnYesActive : btnYes}
          disabled={busy}
        >
          ▲ YES
        </button>
        <button
          type="button"
          onClick={() => setOutcome(0)}
          style={outcome === 0 ? btnNoActive : btnNo}
          disabled={busy}
        >
          ▼ NO
        </button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="mono" style={subLabelStyle}>Amount USDC</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max="100"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mono"
          style={inputStyle}
        />
      </label>

      <QuoteBreakdown
        quote={quote}
        loading={quoteLoading}
        outcome={outcome}
        amount={amount}
        error={quoteError}
      />

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || closed || !amount || Number(amount) <= 0 || !balanceOk}
        style={busy || closed ? btnPrimaryBusy : balanceOk ? btnPrimary : btnPrimaryDisabled}
      >
        {closed
          ? "market closed"
          : busy
          ? "settling on-chain…"
          : !balanceOk
            ? `need ${amount} USDC · current ${trader.usdcBalanceFormatted}`
            : `place ${amount} USDC on ${outcome === 1 ? "YES" : "NO"}`}
      </button>

      <div style={x402BadgeRow}>
        <span
          className="mono"
          style={x402Badge}
          title="Bets settle via gasless USDC transferWithAuthorization — the same EIP-3009 primitive Circle Nanopayments runs on. <1s on Arc."
        >
          <X402Icon size={13} />
          x402 · Circle Nanopayments
        </span>
      </div>

      {error && (
        <p className="mono" style={errorStyle}>✗ {error}</p>
      )}

      {success && (
        <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-xs)", color: "var(--color-outcome-yes)" }}>
          <span>✓ bet settled · cost {Number(success.cost) / 1_000_000} USDC</span>
          <a href={arcscanTx(success.txHash)} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1" style={{ width: "fit-content" }}>
            {truncHash(success.txHash)}
            <ArrowSquareOut size={11} />
          </a>
        </div>
      )}
    </section>
  );
}

/// Polymarket-style live breakdown: how many shares user buys, implied prob,
/// max payout if win, profit + ROI%. Recomputed every time quote refreshes.
///
/// LMSR math: each share pays 1 USDC if its outcome wins, 0 otherwise.
///   maxPayoutUsdc = sharesWad / 1e12  (1e18 wad → 1e6 base units)
///   totalCost     = costUsdc + feeUsdc
///   profitIfWin   = maxPayoutUsdc - totalCost
///   roi           = profitIfWin / totalCost × 100%
///   impliedProb   = totalCost / maxPayoutUsdc × 100%  (≈ what the market thinks)
function QuoteBreakdown({
  quote,
  loading,
  outcome,
  amount,
  error,
}: {
  quote: Quote | null;
  loading: boolean;
  outcome: 0 | 1;
  amount: string;
  error: string | null;
}) {
  if (error) {
    return (
      <div style={breakdownShell}>
        <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-tessera-oxblood)" }}>
          ✗ quote failed: {error.slice(0, 80)}
        </p>
      </div>
    );
  }

  if (!quote || !amount || Number(amount) <= 0) {
    return (
      <div style={breakdownShell}>
        <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-bone-faint)" }}>
          {loading ? "fetching live quote…" : "enter an amount to see your shares + payout"}
        </p>
      </div>
    );
  }

  const sharesWad = BigInt(quote.shares);
  const cost = BigInt(quote.costUsdc);
  const fee = BigInt(quote.feeUsdc);
  const total = cost + fee;
  // Each share pays 1 USDC if winning. Convert WAD (1e18) → USDC base units (1e6).
  const maxPayoutUsdc = sharesWad / 10n ** 12n;
  const profitUsdc = maxPayoutUsdc > total ? maxPayoutUsdc - total : 0n;
  const sharesDisplay = Number(sharesWad) / 1e18;
  const totalUsdc = Number(total) / 1e6;
  const maxPayoutDisplay = Number(maxPayoutUsdc) / 1e6;
  const profitDisplay = Number(profitUsdc) / 1e6;
  const roiPct = totalUsdc > 0 ? (profitDisplay / totalUsdc) * 100 : 0;
  const impliedProbPct = maxPayoutDisplay > 0 ? (totalUsdc / maxPayoutDisplay) * 100 : 0;
  const sideColor =
    outcome === 1 ? "var(--color-outcome-yes)" : "var(--color-outcome-no)";

  return (
    <div style={{ ...breakdownShell, opacity: loading ? 0.6 : 1, transition: "opacity 150ms" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="You buy">
          <span className="mono" style={{ color: sideColor, fontWeight: 500 }}>
            {sharesDisplay.toFixed(4)} {outcome === 1 ? "YES" : "NO"} shares
          </span>
        </Row>
        <Row label="Cost (incl. 2% fee)">
          <span className="mono">{totalUsdc.toFixed(6)} USDC</span>
        </Row>
        <Row label="Implied probability">
          <span className="mono" style={{ color: "var(--color-bone-dim)" }}>
            {impliedProbPct.toFixed(1)}%
          </span>
        </Row>
        <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "2px 0" }} />
        <Row label={outcome === 1 ? "Max payout if YES" : "Max payout if NO"}>
          <span className="mono" style={{ color: "var(--color-bone)" }}>
            {maxPayoutDisplay.toFixed(4)} USDC
          </span>
        </Row>
        <Row label="Profit if win">
          <span className="mono" style={{ color: "var(--color-outcome-yes)", fontWeight: 500 }}>
            +{profitDisplay.toFixed(4)} USDC
          </span>
        </Row>
        <Row label="Return on bet">
          <span className="mono" style={{ color: "var(--color-outcome-yes)", fontWeight: 500 }}>
            +{roiPct.toFixed(1)}%
          </span>
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "var(--text-xs)" }}>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const breakdownShell: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 3,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
};

const shellStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "20px 24px",
  backgroundColor: "var(--color-raised)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--color-bone-faint)",
};

const subLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-bone-faint)",
};

const headerStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  color: "var(--color-bone)",
  letterSpacing: "-0.01em",
};

const miniBalanceStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  borderRadius: 3,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  fontSize: "var(--text-xs)",
};

const miniBalanceLabel: React.CSSProperties = {
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-bone-faint)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "10px 12px",
  fontSize: "var(--text-base)",
  color: "var(--color-bone)",
  fontFamily: "var(--font-mono)",
  width: "100%",
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--color-tessera-oxblood)",
  wordBreak: "break-word",
  lineHeight: 1.5,
};

const btnBase: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "10px 16px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: "background-color 120ms ease, border-color 120ms ease",
};

const ctaPrimary: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "var(--color-honos-gold)",
  color: "var(--color-on-gold)",
  border: "1px solid var(--color-honos-gold)",
  fontWeight: 500,
};

const btnPrimary: React.CSSProperties = { ...ctaPrimary };
const btnPrimaryBusy: React.CSSProperties = { ...btnPrimary, opacity: 0.6, cursor: "wait" };
const btnPrimaryDisabled: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "transparent",
  color: "var(--color-bone-dim)",
  borderColor: "var(--color-border)",
  cursor: "not-allowed",
};

const btnYes: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "transparent",
  color: "var(--color-outcome-yes)",
  borderColor: "var(--color-outcome-yes)",
  opacity: 0.5,
};

const btnYesActive: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "color-mix(in oklch, var(--color-outcome-yes) 18%, var(--color-raised))",
  color: "var(--color-outcome-yes)",
  borderColor: "var(--color-outcome-yes)",
};

const btnNo: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "transparent",
  color: "var(--color-outcome-no)",
  borderColor: "var(--color-outcome-no)",
  opacity: 0.5,
};

const btnNoActive: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "color-mix(in oklch, var(--color-outcome-no) 18%, var(--color-raised))",
  color: "var(--color-outcome-no)",
  borderColor: "var(--color-outcome-no)",
};

const x402BadgeRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  marginTop: -4,
};

const x402Badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  borderRadius: 999,
  background: "color-mix(in oklch, var(--color-honos-gold) 12%, transparent)",
  color: "var(--color-honos-gold)",
  border: "1px solid color-mix(in oklch, var(--color-honos-gold) 28%, transparent)",
  fontSize: 10,
  letterSpacing: "0.08em",
  cursor: "help",
};
