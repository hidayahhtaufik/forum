"use client";

import { useState } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useTrader } from "@/lib/useTrader";
import { requestFaucet, withdrawFromTrader } from "@/lib/trader";
import { signerFromDynamic } from "@/lib/auth";
import { arcscanAddress, arcscanTx, truncHash } from "@/lib/format";
import { ArrowSquareOut, Copy, Check, Drop, ArrowUpRight } from "@phosphor-icons/react";
import { FundFromCrossChain } from "./FundFromCrossChain";

/// Polymarket/Kalshi-style trader wallet panel.
///
/// Shows the user their FORUM-issued EOA: address, USDC balance, faucet button
/// (one-time 1 USDC drip), and the "deposit USDC here" affordance. Works for
/// both Rabby wallet logins AND Google/email logins (Dynamic Dria smart wallets)
/// because the privkey lives server-side encrypted under TRADER_MASTER_KEY.
export function TraderPanel() {
  const { user, primaryWallet, setShowAuthFlow } = useDynamicContext();
  const { trader, issuing, error, refresh } = useTrader();
  const [copied, setCopied] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [faucetTx, setFaucetTx] = useState<string | null>(null);
  const [withdrawDest, setWithdrawDest] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null);

  if (!user && !primaryWallet) {
    return (
      <section style={shellStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="mono" style={labelStyle}>Your FORUM wallet</span>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-bone-dim)", lineHeight: 1.5 }}>
            Connect to claim a fresh FORUM trader wallet. We custody the keys; you keep the funds.
            Works with Rabby, MetaMask, or just your Google account.
          </p>
          <button onClick={() => setShowAuthFlow(true)} style={ctaStyle}>connect or sign in</button>
        </div>
      </section>
    );
  }

  if (issuing || !trader) {
    return (
      <section style={shellStyle}>
        <span className="mono" style={labelStyle}>Your FORUM wallet</span>
        <p style={{ margin: "8px 0 0", fontSize: "var(--text-xs)", color: "var(--color-bone-dim)" }}>
          {error ? `✗ ${error}` : "issuing trader wallet…"}
        </p>
      </section>
    );
  }

  const balance = Number(trader.usdcBalanceFormatted);
  const canBet = balance > 0.01;

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(trader.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard might be blocked on http:// — non-fatal
    }
  };

  const onWithdraw = async () => {
    setWithdrawBusy(true);
    setWithdrawError(null);
    setWithdrawTx(null);
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawDest)) {
        throw new Error("destination must be a valid 0x address (40 hex)");
      }
      // Auth gate — Withdraw decrypts the trader privkey + signs EIP-3009.
      // Server requires an EIP-712 proof from the connected Dynamic wallet
      // (the one bound when /traders/issue minted this row).
      if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
        throw new Error("Connect an Ethereum wallet to authorize this withdrawal");
      }
      const signer = await signerFromDynamic(primaryWallet);
      const result = await withdrawFromTrader({
        traderAddress: trader!.address,
        destinationAddress: withdrawDest,
        amountUsdc: withdrawAmount,
        signer,
      });
      setWithdrawTx(result.txHash);
      setWithdrawAmount("");
      await refresh();
    } catch (err) {
      setWithdrawError((err as Error).message);
    } finally {
      setWithdrawBusy(false);
    }
  };

  const onFaucet = async () => {
    setFaucetBusy(true);
    setFaucetError(null);
    try {
      const result = await requestFaucet(trader.address);
      setFaucetTx(result.txHash);
      await refresh();
    } catch (err) {
      setFaucetError((err as Error).message);
    } finally {
      setFaucetBusy(false);
    }
  };

  return (
    <section style={shellStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <span className="mono" style={labelStyle}>Your FORUM wallet</span>
          {user?.email && (
            <span className="mono" style={{ fontSize: "var(--text-2xs)", color: "var(--color-bone-faint)" }}>
              {user.email}
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={subLabelStyle}>address</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={arcscanAddress(trader.address)}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={addrLinkStyle}
            >
              {trader.address.slice(0, 6)}…{trader.address.slice(-4)}
              <ArrowSquareOut size={11} />
            </a>
            <button onClick={copyAddr} style={iconBtnStyle} aria-label="copy address">
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={subLabelStyle}>balance</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-2xl)",
                fontWeight: 600,
                color: canBet ? "var(--color-bone)" : "var(--color-bone-dim)",
                letterSpacing: "-0.01em",
              }}
            >
              {trader.usdcBalanceFormatted}
            </span>
            <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--color-bone-faint)" }}>USDC</span>
          </div>
        </div>

        {!trader.faucetReceived ? (
          <button onClick={onFaucet} disabled={faucetBusy} style={faucetBusy ? faucetBtnBusy : faucetBtnStyle}>
            <Drop size={13} />
            {faucetBusy ? "dripping…" : "claim 1 USDC try-out"}
          </button>
        ) : faucetTx ? (
          <a href={arcscanTx(faucetTx)} target="_blank" rel="noreferrer" className="mono" style={faucetReceiptStyle}>
            ✓ faucet dripped · {truncHash(faucetTx)}
            <ArrowSquareOut size={11} />
          </a>
        ) : (
          <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-bone-faint)" }}>
            Faucet already claimed · send USDC to your address to add more.
          </p>
        )}

        {faucetError && (
          <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-tessera-oxblood)" }}>
            ✗ {faucetError}
          </p>
        )}

        <details style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <summary className="mono" style={{ ...subLabelStyle, cursor: "pointer", listStyle: "none" }}>
            ▸ deposit more USDC
          </summary>
          <p style={{ margin: "8px 0 0", fontSize: "var(--text-2xs)", color: "var(--color-bone-dim)", lineHeight: 1.55 }}>
            Send USDC on Arc Testnet to your FORUM address above. Anything you deposit is yours to bet,
            claim, or withdraw — custodial wallet, Polymarket-style UX.
          </p>
        </details>

        <FundFromCrossChain destinationAddress={trader.address} />

        <details style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <summary className="mono" style={{ ...subLabelStyle, cursor: "pointer", listStyle: "none" }}>
            ▸ withdraw USDC
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mono" style={subLabelStyle}>destination address</span>
              <input
                type="text"
                placeholder="0x… your Rabby/MetaMask"
                value={withdrawDest}
                onChange={(e) => setWithdrawDest(e.target.value.trim())}
                disabled={withdrawBusy}
                className="mono"
                style={textInputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mono" style={subLabelStyle}>amount USDC</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  disabled={withdrawBusy}
                  className="mono"
                  style={{ ...textInputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    // P2-F-002 — TOCTOU buffer. The displayed balance may be
                    // a few seconds stale relative to the server's view at the
                    // moment of withdraw; padding the cap with a 0.001 USDC
                    // dust margin avoids "insufficient balance" reverts on
                    // borderline withdrawals. Server rejects if even that's
                    // wrong, but this dodges the common race.
                    const balanceNum = Number(trader.usdcBalanceFormatted);
                    if (!Number.isFinite(balanceNum) || balanceNum <= 0) {
                      setWithdrawAmount("0");
                      return;
                    }
                    const buffered = Math.max(0, balanceNum - 0.001);
                    setWithdrawAmount(buffered.toFixed(6));
                  }}
                  disabled={withdrawBusy}
                  style={maxBtnStyle}
                >
                  MAX
                </button>
              </div>
            </label>
            <button
              type="button"
              onClick={onWithdraw}
              disabled={withdrawBusy || !withdrawDest || !withdrawAmount || Number(withdrawAmount) <= 0}
              style={withdrawBusy ? withdrawBtnBusy : withdrawBtnStyle}
            >
              <ArrowUpRight size={13} />
              {withdrawBusy ? "withdrawing…" : `withdraw ${withdrawAmount || "0"} USDC`}
            </button>
            <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-bone-faint)", lineHeight: 1.55 }}>
              Server signs an EIP-3009 transfer from your FORUM wallet directly to the destination.
              Market-api pays the gas — 100% of your balance is withdrawable.
            </p>
            {withdrawError && (
              <p className="mono" style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--color-tessera-oxblood)", wordBreak: "break-word" }}>
                ✗ {withdrawError}
              </p>
            )}
            {withdrawTx && (
              <a href={arcscanTx(withdrawTx)} target="_blank" rel="noreferrer" className="mono" style={faucetReceiptStyle}>
                ✓ withdrawn · {truncHash(withdrawTx)}
                <ArrowSquareOut size={11} />
              </a>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

const shellStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "18px 22px",
  backgroundColor: "var(--color-raised)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
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

const ctaStyle: React.CSSProperties = {
  background: "var(--color-honos-gold)",
  color: "var(--color-on-gold)",
  border: "1px solid var(--color-honos-gold)",
  borderRadius: 4,
  padding: "10px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  letterSpacing: "0.04em",
  cursor: "pointer",
  fontWeight: 500,
};

const addrLinkStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--color-bone)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  letterSpacing: "0.02em",
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  borderRadius: 3,
  padding: "4px 6px",
  color: "var(--color-bone-dim)",
  cursor: "pointer",
  display: "inline-flex",
};

const faucetBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--color-honos-gold)",
  border: "1px solid var(--color-honos-gold)",
  borderRadius: 4,
  padding: "8px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-xs)",
  letterSpacing: "0.04em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const faucetBtnBusy: React.CSSProperties = {
  ...faucetBtnStyle,
  opacity: 0.6,
  cursor: "wait",
};

const faucetReceiptStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: "var(--text-2xs)",
  color: "var(--color-outcome-yes)",
  textDecoration: "none",
};

const textInputStyle: React.CSSProperties = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 3,
  padding: "8px 10px",
  fontSize: "var(--text-xs)",
  color: "var(--color-bone)",
  fontFamily: "var(--font-mono)",
  width: "100%",
};

const maxBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  borderRadius: 3,
  padding: "0 12px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-2xs)",
  color: "var(--color-bone-dim)",
  letterSpacing: "0.1em",
  cursor: "pointer",
};

const withdrawBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--color-bone)",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "8px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-xs)",
  letterSpacing: "0.04em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const withdrawBtnBusy: React.CSSProperties = {
  ...withdrawBtnStyle,
  opacity: 0.6,
  cursor: "wait",
};
