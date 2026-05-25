/// Server-safe lookup helpers for agent sprite assignment.
///
/// Lives outside the `"use client"`-marked AgentSprite.tsx so Server Components
/// (Leaderboard, Agents card, /agents/[id] page) can call `spriteForAddress()`
/// at render time without triggering Next.js' RSC client-boundary serialization
/// (which can throw `An error occurred in the Server Components render` at
/// runtime even though the build succeeds).

export type AgentName = "oracle" | "sage" | "hermes" | "augur" | "mirror";

const NAME_BY_ADDRESS: Record<string, AgentName> = {
  "0xd04d955c9989982e76cfb6287affd97acbe0ae2f": "oracle",
  "0x24018ec27dbc3f5805d19b7d6f89d83eba7ef85a": "mirror",
  "0x2344d1fcb82c1dfe9d3de49ddfdd2878bbfbdff0": "sage",
  "0xce78b7f1016aff9db58de3d986e8cd36262bcf90": "hermes",
  "0x1ffd8313bb45ccdfdf151e194f2bc8e8293206af": "augur",
};

export function spriteForAddress(address: string): AgentName | null {
  return NAME_BY_ADDRESS[address.toLowerCase()] ?? null;
}
