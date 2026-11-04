"use client";

import { createPublicClient, createWalletClient, http } from "viem";
import type {
  Abi,
  Account,
  Address,
  Chain,
  Hash,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const contractAddress = process.env
  .NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
export const evaluationChain = foundry;

const ADDRESS_PATTERN = /^0x[\da-fA-F]{40}$/u;
// Indexes into the `jobs` getter tuple, matching the Job struct in Evaluation.sol
const JOB_CREATOR_INDEX = 0;
const JOB_FLAG_INDEX = 5;
const JOB_STATUS_INDEX = 6;
const ON_CHAIN_STATUSES = ["open", "complete", "failed", "refunded"] as const;

export type OnChainJobStatus = (typeof ON_CHAIN_STATUSES)[number];
export interface OnChainJob {
  funded: boolean;
  creator: Address;
  status: OnChainJobStatus;
}

export type WalletSource = "privateKey" | "browser";
export interface BlockchainWallet {
  address: Address;
  source: WalletSource;
  walletClient: WalletClient<Transport, Chain, Account>;
}

interface BlockchainReader {
  publicClient: PublicClient;
  abi: Abi;
}

let readerPromise: Promise<BlockchainReader> | undefined;

const loadBlockchainReader = async (): Promise<BlockchainReader> => {
  if (
    !process.env.NEXT_PUBLIC_NET_URL ||
    !ADDRESS_PATTERN.test(contractAddress ?? "")
  ) {
    throw new Error(
      "Wallet funding is not configured. Set the frontend RPC URL and contract address."
    );
  }
  const publicClient = createPublicClient({
    chain: evaluationChain,
    transport: http(process.env.NEXT_PUBLIC_NET_URL),
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
  return { publicClient, abi };
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

const isOnChainStatus = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < ON_CHAIN_STATUSES.length;

export const getOnChainJob = async (jobId: string): Promise<OnChainJob> => {
  const { publicClient, abi } = await getBlockchainReader();
  const job = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "jobs",
    args: [jobId],
  });

  if (!Array.isArray(job)) {
    throw new TypeError("Could not read this job from the contract.");
  }
  const creator: unknown = job.at(JOB_CREATOR_INDEX);
  const funded: unknown = job.at(JOB_FLAG_INDEX);
  const status: unknown = job.at(JOB_STATUS_INDEX);
  if (
    typeof funded !== "boolean" ||
    typeof creator !== "string" ||
    !ADDRESS_PATTERN.test(creator) ||
    !isOnChainStatus(status)
  ) {
    throw new TypeError("Could not read this job from the contract.");
  }
  return {
    funded,
    creator: creator as Address,
    status: ON_CHAIN_STATUSES[status],
  };
};

export const getJobFundingStatus = async (jobId: string): Promise<boolean> => {
  const { funded } = await getOnChainJob(jobId);
  return funded;
};

export const createPrivateKeyWallet = async (
  key: `0x${string}`
): Promise<BlockchainWallet> => {
  // Fail fast when the frontend is not configured for the contract
  await getBlockchainReader();
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: evaluationChain,
    transport: http(process.env.NEXT_PUBLIC_NET_URL),
  });
  return { address: account.address, source: "privateKey", walletClient };
};

export const createBrowserWallet = (
  walletClient: WalletClient<Transport, Chain, Account>
): BlockchainWallet => ({
  address: walletClient.account.address,
  source: "browser",
  walletClient,
});

export const isSameAddress = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

type JobContractFunction = "fundJob" | "refund";

/** Simulates then submits a job-scoped contract call, returning its hash. */
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
  });
  return wallet.walletClient.writeContract(request);
};

/** Resolves to true when the transaction is mined without reverting. */
export const waitForTransactionSuccess = async (
  hash: Hash
): Promise<boolean> => {
  const { publicClient } = await getBlockchainReader();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.status === "success";
};
