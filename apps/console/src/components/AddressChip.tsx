"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { truncAddress, arcscanAddress } from "@/lib/format";

type Props = {
  address: string;
  label?: string | null;
  /// "default" — terse `0xabcd…1234`. "explorer" — same + arrow-out icon, opens arcscan.
  variant?: "default" | "explorer";
};

/// Address chip: monospace `0xabcd…1234`, click-to-copy, hover shows full in title.
/// Screen reader gets a labelled action.
export function AddressChip({ address, label, variant = "default" }: Props) {
  const [copied, setCopied] = useState(false);
  const display = label ? label : truncAddress(address);
  const full = address;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // ignore — older browsers / insecure contexts
    }
  };

  if (variant === "explorer") {
    return (
      <a
        href={arcscanAddress(address)}
        target="_blank"
        rel="noreferrer"
        className="mono inline-flex items-center gap-1 text-[var(--color-aureus-ink)] hover:text-[var(--color-bone)] transition-colors"
        title={full}
      >
        {display}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={full}
      aria-label={`Ethereum address ${display}, copy`}
      className="mono inline-flex items-center gap-1 text-[var(--color-aureus-ink)] hover:text-[var(--color-bone)] transition-colors"
    >
      <span>{display}</span>
      {copied ? (
        <Check size={12} weight="bold" className="text-[var(--color-outcome-yes)]" />
      ) : (
        <Copy size={12} weight="regular" className="opacity-50" />
      )}
    </button>
  );
}
