"use client";

import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  TransactionReceiptNotFoundError,
  UserRejectedRequestError,
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
} from "viem";
import type {
  Abi,
  Account,
  Address,
  Chain,
  Hash,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";
import { foundry } from "viem/chains";

export const contractAddress = process.env
  .NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const rpcUrl = process.env.NEXT_PUBLIC_NET_URL ?? "http://127.0.0.1:8545";

/**
 * The only supported network: a local Anvil chain (chain ID 31337) reached
 * through the configured RPC URL. Wallets use this definition when asked to
 * add or switch to the network.
 */
export const evaluationChain = defineChain({
  ...foundry,
  name: "JMAC Local (Anvil)",
  rpcUrls: { default: { http: [rpcUrl] } },
});

const ADDRESS_PATTERN = /^0x[\da-fA-F]{40}$/u;
const EMPTY_COMMIT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ON_CHAIN_STATUSES = ["open", "complete", "failed", "refunded"] as const;
const RECEIPT_TIMEOUT_MS = 120_000;

export type OnChainJobStatus = (typeof ON_CHAIN_STATUSES)[number];

export interface OnChainProvider {
  address: Address;
  providerId: string;
  assigned: boolean;
  committed: boolean;
  commit: Hex | undefined;
  revealed: boolean;
  claimed: boolean;
  /**
   * Revealed keyed digest of the provider's ordered predictions; undefined
   * before the reveal. Predictions themselves never reach the chain.
   */
  outputDigest: Hex | undefined;
  /** Revealed number of correct items (0 before the reveal). */
  correctCount: number;
}

export interface OnChainJob {
  funded: boolean;
  creator: Address;
  price: bigint;
  status: OnChainJobStatus;
  providers: readonly [OnChainProvider, OnChainProvider];
  /** keccak256(abi.encode(benchmark SHA-256, model ID)), fixed at assignment. */
  specHash: Hex;
  /** Benchmark item count fixed at assignment and bound into each commitment. */
  itemCount: number;
  /** Unix seconds; commits close here and reveals close REVEAL_WINDOW later. */
  commitDeadline: number;
  revealDeadline: number;
  /** Timestamp of the pending (next) block, used for deadline checks. */
  chainTime: number;
}

export interface BlockchainWallet {
  address: Address;
  walletClient: WalletClient<Transport, Chain, Account>;
}

interface BlockchainReader {
  publicClient: PublicClient;
  abi: Abi;
  revealWindow: number;
}

let readerPromise: Promise<BlockchainReader> | undefined;

const loadBlockchainReader = async (): Promise<BlockchainReader> => {
  if (
    !process.env.NEXT_PUBLIC_NET_URL ||
    !ADDRESS_PATTERN.test(contractAddress ?? "")
  ) {
    throw new Error(
      "The evaluation contract is not configured. Set NEXT_PUBLIC_NET_URL and NEXT_PUBLIC_CONTRACT_ADDRESS."
    );
  }
  const publicClient = createPublicClient({
    chain: evaluationChain,
    transport: http(rpcUrl),
  });
  const abiRes = await fetch("/abi.json");
  if (!abiRes.ok) {
    throw new Error(
      "Could not load the evaluation contract. Please try again."
    );
  }
  const abiHolder: { abi: Abi } = await abiRes.json();
  const { abi } = abiHolder;
  if (!Array.isArray(abi)) {
    throw new TypeError("The evaluation contract ABI is invalid.");
  }
  const revealWindow = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "REVEAL_WINDOW",
  });
  if (typeof revealWindow !== "bigint") {
    throw new TypeError("Could not read the contract's reveal window.");
  }
  return { publicClient, abi, revealWindow: Number(revealWindow) };
};

const getBlockchainReader = async (): Promise<BlockchainReader> => {
  readerPromise ??= loadBlockchainReader();
  try {
    return await readerPromise;
  } catch (error) {
    // Allow a later call to retry after a configuration or network failure
    readerPromise = undefined;
    throw error;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseProvider = (value: unknown): OnChainProvider => {
  if (
    !isRecord(value) ||
    typeof value.addr !== "string" ||
    typeof value.id !== "string" ||
    typeof value.commit !== "string" ||
    typeof value.flag !== "boolean" ||
    typeof value.revealed !== "boolean" ||
    typeof value.claimed !== "boolean" ||
    typeof value.outputDigest !== "string" ||
    typeof value.correctCount !== "bigint"
  ) {
    throw new TypeError(
      "Could not read this job's providers from the contract."
    );
  }
  const committed = value.commit !== EMPTY_COMMIT;
  return {
    address: value.addr as Address,
    providerId: value.id,
    assigned: value.flag,
    committed,
    commit: committed ? (value.commit as Hex) : undefined,
    revealed: value.revealed,
    claimed: value.claimed,
    outputDigest:
      value.revealed && value.outputDigest !== EMPTY_COMMIT
        ? (value.outputDigest as Hex)
        : undefined,
    correctCount: Number(value.correctCount),
  };
};

const isStatusIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < ON_CHAIN_STATUSES.length;

/** Reads a job's escrow, assignment, commit/reveal, and claim state. */
export const getOnChainJob = async (jobId: string): Promise<OnChainJob> => {
  const { publicClient, abi, revealWindow } = await getBlockchainReader();
  const [job, block] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "jobs",
      args: [jobId],
    }),
    // Anvil mines on demand, so "latest" can be stale. The pending block is
    // stamped like the next real block, which is where a refund would run.
    publicClient.getBlock({ blockTag: "pending" }),
  ]);
  if (!Array.isArray(job) || job.length < 10) {
    throw new TypeError("Could not read this job from the contract.");
  }
  const [
    creator,
    ,
    price,
    providerA,
    providerB,
    funded,
    status,
    deadline,
    specHash,
    itemCount,
  ] = job as unknown[];
  if (
    typeof creator !== "string" ||
    typeof price !== "bigint" ||
    typeof funded !== "boolean" ||
    typeof deadline !== "bigint" ||
    typeof specHash !== "string" ||
    typeof itemCount !== "bigint" ||
    !isStatusIndex(status)
  ) {
    throw new TypeError("Could not read this job from the contract.");
  }
  const commitDeadline = Number(deadline);
  return {
    funded,
    creator: creator as Address,
    price,
    status: ON_CHAIN_STATUSES[status],
    providers: [parseProvider(providerA), parseProvider(providerB)],
    specHash: specHash as Hex,
    itemCount: Number(itemCount),
    commitDeadline,
    revealDeadline: commitDeadline + revealWindow,
    chainTime: Number(block.timestamp),
  };
};

export const createBrowserWallet = (
  walletClient: WalletClient<Transport, Chain, Account>
): BlockchainWallet => ({
  address: walletClient.account.address,
  walletClient,
});

export const isSameAddress = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * True only when the transaction succeeded and this contract emitted
 * JobComplete for this job with exactly this digest and count, so a recorded
 * hash in our database cannot vouch for a different result.
 */
export const verifyJobCompletion = async (
  hash: Hash,
  jobId: string,
  outputDigest: Hex,
  correctCount: number
): Promise<boolean> => {
  const { publicClient, abi } = await getBlockchainReader();
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    return false;
  }
  return receipt.logs.some((log) => {
    if (!isSameAddress(log.address, contractAddress)) {
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
        args.outputDigest === outputDigest &&
        args.correctCount === BigInt(correctCount)
      );
    } catch {
      return false;
    }
  });
};

type JobContractFunction = "fundJob" | "refund";

/**
 * Simulates a job-scoped contract call (so reverts such as "Job not
 * refundable" surface before the wallet prompt), then asks the browser wallet
 * to sign and submit it. Returns the transaction hash.
 */
export const writeJobTransaction = async (
  wallet: BlockchainWallet,
  functionName: JobContractFunction,
  jobId: string,
  value?: bigint
): Promise<Hash> => {
  const { publicClient, abi } = await getBlockchainReader();
  const { request } = await publicClient.simulateContract({
    account: wallet.walletClient.account,
    address: contractAddress,
    abi,
    functionName,
    args: [jobId],
    value,
    // Simulate as the next block so deadline checks match the real tx
    blockTag: "pending",
  });
  return wallet.walletClient.writeContract(request);
};

/** Resolves to true when the transaction is mined without reverting. */
export const waitForTransactionSuccess = async (
  hash: Hash
): Promise<boolean> => {
  const { publicClient } = await getBlockchainReader();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  return receipt.status === "success";
};

export type TransactionOutcome = "success" | "reverted" | "unknown";

/**
 * Looks up a previously submitted transaction without waiting. "unknown"
 * means it is still pending or the chain has never seen it (for example
 * after an Anvil restart).
 */
export const getTransactionOutcome = async (
  hash: Hash
): Promise<TransactionOutcome> => {
  const { publicClient } = await getBlockchainReader();
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return receipt.status === "success" ? "success" : "reverted";
  } catch (error) {
    if (
      error instanceof BaseError &&
      error.walk((cause) => cause instanceof TransactionReceiptNotFoundError)
    ) {
      return "unknown";
    }
    throw error;
  }
};

/** Turns wallet and contract errors into a message a user can act on. */
export const describeWalletError = (error: unknown): string => {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet. Nothing was signed or sent.";
    }
    if (error.walk((cause) => cause instanceof ChainMismatchError)) {
      return `Your wallet is on a different network. Switch to ${evaluationChain.name} (chain ${evaluationChain.id}) and try again.`;
    }
    const revert = error.walk(
      (cause) => cause instanceof ContractFunctionRevertedError
    );
    if (revert instanceof ContractFunctionRevertedError && revert.reason) {
      return `The contract rejected this transaction: ${revert.reason}.`;
    }
    return error.shortMessage;
  }
  if (isRecord(error) && error.code === 4001) {
    return "You rejected the request in your wallet. Nothing was signed or sent.";
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
};
