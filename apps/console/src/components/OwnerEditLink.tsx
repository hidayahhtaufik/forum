"use client";

/// OwnerEditLink — surfaces an "Edit persona" link on /agents/[id]
/// only when the signed-in user's trader address matches the agent's
/// owner_identity. Default agents (no owner) get nothing.

import Link from "next/link";
import { useTrader } from "@/lib/useTrader";
import { PencilSimple } from "@phosphor-icons/react";

export function OwnerEditLink({
  agentAddress,
  ownerIdentity,
}: {
  agentAddress: string;
  ownerIdentity: string | null;
}) {
  const { trader } = useTrader();
  if (!ownerIdentity) return null;
  if (!trader?.address) return null;
  if (trader.address.toLowerCase() !== ownerIdentity.toLowerCase()) return null;
  return (
    <Link
      href={`/agents/${agentAddress}/edit`}
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 999,
        background: "color-mix(in oklch, var(--color-honos-gold) 16%, transparent)",
        color: "var(--color-honos-gold)",
        border: "1px solid color-mix(in oklch, var(--color-honos-gold) 40%, transparent)",
        textDecoration: "none",
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.08em",
      }}
    >
      <PencilSimple size={11} weight="fill" />
      Edit persona
    </Link>
  );
}
