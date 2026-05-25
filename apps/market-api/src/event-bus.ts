/// In-process pub/sub bus for FORUM realtime events.
///
/// Fires when market-api accepts a write — POST /markets, POST /bets,
/// POST /resolution-notify. SSE handler subscribes here and pushes JSON
/// frames to connected browsers. Avoids polling.
///
/// Design notes:
///   - Single shared EventEmitter (Node built-in). No external pubsub dep.
///   - All events typed via discriminated union so callers can `switch (event.type)`.
///   - No replay buffer in v0.1; new SSE clients only see future events.
///   - One emit per write — DO NOT call from indexer poll loops or we'll storm.

import { EventEmitter } from "node:events";

export type ForumEvent =
  | {
      type: "market.created";
      marketId: string;
      address: string;
      question: string;
      pair: string;
      strikeWad: string;
      comparator: "GT" | "GTE" | "LT" | "LTE";
      opensAt: number;
      closesAt: number;
      txHash: string;
      blockNumber: number;
      ts: number;
    }
  | {
      type: "bet.placed";
      marketId: string;
      agentAddress: string;
      outcome: 0 | 1;
      sharesWad: string;
      costUsdc: string;
      feeUsdc: string;
      txHash: string;
      ts: number;
    }
  | {
      type: "market.resolved";
      marketId: string;
      outcome: 0 | 1 | 2;
      source: string;
      txHash: string;
      ts: number;
    }
  | {
      type: "claim.fired";
      marketId: string;
      agentAddress: string;
      claimedUsdc: string;
      txHash: string;
      ts: number;
    }
  | {
      type: "trader.issued";
      identity: string;
      address: string;
      ts: number;
    }
  | {
      type: "faucet.dripped";
      address: string;
      amountUsdc: string;
      txHash: string;
      ts: number;
    }
  | {
      type: "trace_bet.placed";
      traceMarketId: string;
      bettor: string;
      outcome: 0 | 1;
      costUsdc: string;
      txHash: string;
      ts: number;
    };

class ForumEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Bump default listener cap — many SSE clients can subscribe at once.
    this.emitter.setMaxListeners(1000);
  }

  emit(event: ForumEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: ForumEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const bus = new ForumEventBus();
