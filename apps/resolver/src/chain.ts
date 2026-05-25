/// Minimal Resolver + ForexMarket ABI subset. Just the methods the resolver needs.

export const ResolverAbi = [
  {
    type: "function",
    name: "admin",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "resolutionDigest",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "resolve",
    inputs: [
      { name: "market", type: "address" },
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "marketId", type: "bytes32" },
          { name: "winningOutcome", type: "uint8" },
          { name: "dataHash", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
          { name: "validBefore", type: "uint64" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const ForexMarketAbi = [
  {
    type: "function",
    name: "phase",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "closesAt",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
] as const;

export const FORUM_RESOLVER_DOMAIN = {
  name: "FORUM Resolver",
  version: "1",
} as const;

// P2-C-001: validBefore added to Resolution struct to prevent stale-sig replay.
// Typehash on-chain: keccak256("Resolution(bytes32 marketId,uint8 winningOutcome,bytes32 dataHash,uint64 timestamp,uint64 validBefore)")
export const RESOLUTION_TYPES = {
  Resolution: [
    { name: "marketId", type: "bytes32" },
    { name: "winningOutcome", type: "uint8" },
    { name: "dataHash", type: "bytes32" },
    { name: "timestamp", type: "uint64" },
    { name: "validBefore", type: "uint64" },
  ],
} as const;
