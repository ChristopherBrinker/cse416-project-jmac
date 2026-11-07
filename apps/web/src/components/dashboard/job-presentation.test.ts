/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { OnChainJob, OnChainProvider } from "@/lib/blockchain";

import { explainFailure } from "./job-presentation";

const provider = (
  overrides: Partial<OnChainProvider> = {}
): OnChainProvider => ({
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  providerId: "provider",
  assigned: true,
  committed: true,
  commit: undefined,
  revealed: true,
  claimed: false,
  outputDigest: undefined,
  correctCount: 0,
  ...overrides,
});

const chainJob = (overrides: Partial<OnChainJob> = {}): OnChainJob => ({
  funded: true,
  creator: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  price: 2500n,
  status: "failed",
  providers: [provider(), provider()],
  specHash: `0x${"0".repeat(64)}`,
  itemCount: 3,
  commitDeadline: 1000,
  revealDeadline: 1150,
  chainTime: 900,
  ...overrides,
});

describe("explainFailure", () => {
  test("a refunded disagreement is still explained as a disagreement", () => {
    const { title, detail } = explainFailure(
      "Providers disagreed on results",
      chainJob({ status: "refunded" })
    );
    expect(title).toBe("Providers disagreed on results");
    expect(detail).toContain("not each other");
  });

  test("a refunded reveal timeout reports the missing reveal", () => {
    const { detail } = explainFailure(
      "Timed out",
      chainJob({
        status: "refunded",
        providers: [provider(), provider({ revealed: false })],
      })
    );
    expect(detail).toBe(
      "Only 1 of 2 providers revealed a result before the reveal deadline."
    );
  });

  test("makes no escrow claim without contract data", () => {
    const { detail } = explainFailure("Provider assignment failed");
    expect(detail).toContain("Escrow status is unavailable");
    expect(detail).not.toContain("holds no funds");
  });

  test("states no escrow only when the contract shows the job unfunded", () => {
    const { detail } = explainFailure(
      "Provider assignment failed",
      chainJob({
        funded: false,
        status: "open",
        providers: [
          provider({ assigned: false, committed: false, revealed: false }),
          provider({ assigned: false, committed: false, revealed: false }),
        ],
      })
    );
    expect(detail).toContain("never funded on-chain");
  });
});
