"use client";

import {
  decodeEventLog,
  encodeAbiParameters,
  isAddressEqual,
  keccak256,
} from "viem";
import type { Abi, PublicClient } from "viem";

import { contractAddress } from "./blockchain";

// Mirrors JobStatus in contracts/src/Evaluation.sol.
export const CHAIN_STATUSES = [
  "Open",
  "Complete",
  "Failed",
  "Refunded",
] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];

const ZERO_HASH = `0x${"0".repeat(64)}`;

export interface ChainProvider {
  address: `0x${string}`;
  providerId: string;
  commit: `0x${string}`;
  outputDigest: `0x${string}`;
  revealed: boolean;
  claimed: boolean;
  correctCount: bigint;
}

export interface SettlementReceipt {
  chainId: number;
  contract: `0x${string}`;
  exists: boolean;
  status: ChainStatus;
  creator: `0x${string}`;
  price: bigint;
  specHash: `0x${string}`;
  expectedSpecHash: `0x${string}` | undefined;
  itemCount: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  providers: [ChainProvider, ChainProvider] | undefined;
  accepted:
    | { outputDigest: `0x${string}`; correctCount: bigint; score: number }
    | undefined;
  // Set only when the recorded transaction really emitted this job's JobComplete.
  completionTx: `0x${string}` | undefined;
  completionTxVerified: boolean;
  refundable: boolean;
}

// Must match spec_hash in workers/jmac_worker/commitments.py and packages/scheduler/spec.ts.
export const specHash = (contentHash: string, modelId: string): `0x${string}` =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      [contentHash, modelId]
    )
  );

const asHex = (value: unknown): `0x${string}` =>
  (typeof value === "string" && value.startsWith("0x")
    ? value
    : ZERO_HASH) as `0x${string}`;

const asBigInt = (value: unknown): bigint =>
  typeof value === "bigint" ? value : 0n;

const parseProvider = (value: unknown): ChainProvider | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const provider = value as Record<string, unknown>;
  if (provider.flag !== true) {
    return undefined;
  }
  return {
    address: asHex(provider.addr),
    providerId: String(provider.id),
    commit: asHex(provider.commit),
    outputDigest: asHex(provider.outputDigest),
    revealed: provider.revealed === true,
    claimed: provider.claimed === true,
    correctCount: asBigInt(provider.correctCount),
  };
};

const findCompletion = async (
  publicClient: PublicClient,
  abi: Abi,
  jobId: string,
  hash: `0x${string}`,
  accepted: NonNullable<SettlementReceipt["accepted"]>
): Promise<boolean> => {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    return false;
  }
  return receipt.logs.some((log) => {
    if (!isAddressEqual(log.address, contractAddress)) {
      return false;
    }
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      return (
        decoded.eventName === "JobComplete" &&
        args.jobId === jobId &&
        args.outputDigest === accepted.outputDigest &&
        args.correctCount === accepted.correctCount
      );
    } catch {
      return false;
    }
  });
};

// Reads the job straight from the contract so the receipt does not depend on Convex records.
export const readSettlementReceipt = async (
  publicClient: PublicClient,
  abi: Abi,
  jobId: string,
  spec: { contentHash: string; modelId: string } | undefined,
  recordedCompletionTx: string | undefined
): Promise<SettlementReceipt> => {
  const [job, revealWindow, chainId, block] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "jobs",
      args: [jobId],
    }),
    publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "REVEAL_WINDOW",
    }),
    publicClient.getChainId(),
    publicClient.getBlock(),
  ]);
  if (!Array.isArray(job) || job.length < 10) {
    throw new TypeError("The contract returned an unexpected job record.");
  }
  const providerA = parseProvider(job[3]);
  const providerB = parseProvider(job[4]);
  const providers: SettlementReceipt["providers"] =
    providerA && providerB ? [providerA, providerB] : undefined;
  const status = CHAIN_STATUSES[Number(job[6])] ?? "Open";
  const itemCount = asBigInt(job[9]);
  const commitDeadline = asBigInt(job[7]);
  const revealDeadline = commitDeadline + asBigInt(revealWindow);

  let accepted: SettlementReceipt["accepted"];
  if (status === "Complete" && providers && itemCount > 0n) {
    const [a] = providers;
    accepted = {
      outputDigest: a.outputDigest,
      correctCount: a.correctCount,
      score: (Number(a.correctCount) / Number(itemCount)) * 100,
    };
  }

  let completionTx: `0x${string}` | undefined;
  let completionTxVerified = false;
  if (accepted && recordedCompletionTx?.startsWith("0x")) {
    completionTx = recordedCompletionTx as `0x${string}`;
    completionTxVerified = await findCompletion(
      publicClient,
      abi,
      jobId,
      completionTx,
      accepted
    );
  }

  const bothCommitted =
    providers?.every((provider) => provider.commit !== ZERO_HASH) ?? false;
  const deadline = bothCommitted ? revealDeadline : commitDeadline;
  const refundable =
    job[5] === true &&
    (status === "Failed" || (status === "Open" && block.timestamp > deadline));

  return {
    chainId,
    contract: contractAddress,
    exists: job[5] === true,
    status,
    creator: asHex(job[0]),
    price: asBigInt(job[2]),
    specHash: asHex(job[8]),
    expectedSpecHash: spec
      ? specHash(spec.contentHash, spec.modelId)
      : undefined,
    itemCount,
    commitDeadline,
    revealDeadline,
    providers,
    accepted,
    completionTx,
    completionTxVerified,
    refundable,
  };
};
