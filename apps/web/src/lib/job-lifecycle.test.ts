/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { OnChainJob, OnChainProvider } from "./blockchain";
import {
  getJobLifecycle,
  hasTimedOut,
  isSettledOnChain,
} from "./job-lifecycle";

const COMMIT_DEADLINE = 1000;
const REVEAL_DEADLINE = 1150;

const provider = (
  overrides: Partial<OnChainProvider> = {}
): OnChainProvider => ({
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  providerId: "provider",
  assigned: true,
  committed: false,
  commit: undefined,
  revealed: false,
  claimed: false,
  outputDigest: undefined,
  correctCount: 0,
  ...overrides,
});

const chainJob = (
  overrides: Partial<OnChainJob> = {},
  providerOverrides: Partial<OnChainProvider> = {}
): OnChainJob => ({
  funded: true,
  creator: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  price: 2500n,
  status: "open",
  providers: [provider(providerOverrides), provider(providerOverrides)],
  specHash: `0x${"0".repeat(64)}`,
  itemCount: 3,
  commitDeadline: COMMIT_DEADLINE,
  revealDeadline: REVEAL_DEADLINE,
  chainTime: 900,
  ...overrides,
});

describe("getJobLifecycle", () => {
  test("unfunded job awaits funding", () => {
    expect(
      getJobLifecycle({
        convexStatus: "created",
        chainJob: chainJob({ funded: false }, { assigned: false }),
      })
    ).toEqual({ stage: "awaiting_funding", refundAvailable: false });
  });

  test("submitted funding transaction is pending until confirmed", () => {
    expect(
      getJobLifecycle({
        convexStatus: "created",
        chainJob: undefined,
        fundingTransaction: { confirmed: false },
      }).stage
    ).toBe("funding_pending");
  });

  test("funded on-chain but not yet assigned shows funding confirmed", () => {
    expect(
      getJobLifecycle({
        convexStatus: "created",
        chainJob: chainJob({}, { assigned: false }),
      }).stage
    ).toBe("funding_confirmed");
  });

  test("assigned job awaits commits until the commit deadline", () => {
    expect(
      getJobLifecycle({ convexStatus: "funded", chainJob: chainJob() })
    ).toEqual({
      stage: "evaluation_pending",
      phase: "awaiting_commits",
      phaseDeadline: COMMIT_DEADLINE,
      refundAvailable: false,
    });
  });

  test("both commits move the job to the reveal phase", () => {
    const lifecycle = getJobLifecycle({
      convexStatus: "funded",
      chainJob: chainJob({ chainTime: 1100 }, { committed: true }),
    });
    expect(lifecycle.phase).toBe("awaiting_reveals");
    expect(lifecycle.phaseDeadline).toBe(REVEAL_DEADLINE);
    expect(lifecycle.refundAvailable).toBe(false);
  });

  test("missed commit deadline expires the job and allows a refund", () => {
    expect(
      getJobLifecycle({
        convexStatus: "funded",
        chainJob: chainJob({ chainTime: COMMIT_DEADLINE + 1 }),
      })
    ).toEqual({ stage: "expired", refundAvailable: true });
  });

  test("a scheduler-failed timed-out job is labelled failed, still refundable", () => {
    expect(
      getJobLifecycle({
        convexStatus: "failed",
        chainJob: chainJob({ chainTime: COMMIT_DEADLINE + 1 }),
      })
    ).toEqual({ stage: "failed", refundAvailable: true });
  });

  test("on-chain disagreement is a refundable failure", () => {
    expect(
      getJobLifecycle({
        convexStatus: "funded",
        chainJob: chainJob({ status: "failed" }),
      })
    ).toEqual({ stage: "failed", refundAvailable: true });
  });

  test("failed job with no escrow cannot be refunded", () => {
    expect(
      getJobLifecycle({
        convexStatus: "failed",
        chainJob: chainJob({ funded: false }, { assigned: false }),
      })
    ).toEqual({ stage: "failed", refundAvailable: false });
  });

  test("failed job is not refunded while the refund transaction is pending", () => {
    expect(
      getJobLifecycle({
        convexStatus: "failed",
        chainJob: chainJob({ status: "failed" }),
        refundTransaction: { confirmed: false },
      }).stage
    ).toBe("refund_pending");
  });

  test("a confirmed refund transaction alone does not mark the job refunded", () => {
    // Only the contract's Refunded status is authoritative
    expect(
      getJobLifecycle({
        convexStatus: "failed",
        chainJob: chainJob({ status: "failed" }),
        refundTransaction: { confirmed: true },
      }).stage
    ).toBe("failed");
  });

  test("contract refunded status wins", () => {
    expect(
      getJobLifecycle({
        convexStatus: "failed",
        chainJob: chainJob({ status: "refunded" }),
      })
    ).toEqual({ stage: "refunded", refundAvailable: false });
  });

  test("completed contract status is an accepted result", () => {
    expect(
      getJobLifecycle({
        convexStatus: "funded",
        chainJob: chainJob({ status: "complete" }),
      })
    ).toEqual({ stage: "accepted", refundAvailable: false });
  });
});

describe("hasTimedOut", () => {
  test("uses the reveal deadline once both providers commit", () => {
    const committed = chainJob({ chainTime: 1100 }, { committed: true });
    expect(hasTimedOut(committed)).toBe(false);
    expect(hasTimedOut({ ...committed, chainTime: REVEAL_DEADLINE + 1 })).toBe(
      true
    );
  });
});

describe("isSettledOnChain", () => {
  test("completed job keeps polling until both providers claim", () => {
    expect(isSettledOnChain(chainJob({ status: "complete" }))).toBe(false);
    expect(
      isSettledOnChain(chainJob({ status: "complete" }, { claimed: true }))
    ).toBe(true);
  });
});
