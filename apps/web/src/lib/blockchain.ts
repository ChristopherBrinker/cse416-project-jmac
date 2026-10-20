"use client";

import { createPublicClient, createWalletClient, http } from "viem";
import type { Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const contractAddress = process.env
  .NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

const createBlockchainReader = async () => {
  if (
    !process.env.NEXT_PUBLIC_NET_URL ||
    !/^0x[\da-fA-F]{40}$/u.test(contractAddress ?? "")
  ) {
    throw new Error(
      "Wallet funding is not configured. Set the frontend RPC URL and contract address."
    );
  }
  const publicClient = createPublicClient({
    chain: foundry,
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

export const getJobFundingStatus = async (jobId: string): Promise<boolean> => {
  const { publicClient, abi } = await createBlockchainReader();
  const job = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "jobs",
    args: [jobId],
  });
  if (!Array.isArray(job) || typeof job.at(-1) !== "boolean") {
    throw new TypeError("Could not verify this job's funding status.");
  }
  return job.at(-1) === true;
};

export const createBlockchainClient = async (key: `0x${string}`) => {
  const { publicClient, abi } = await createBlockchainReader();
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(process.env.NEXT_PUBLIC_NET_URL),
  });
  return { publicClient, walletClient, account, abi };
};

export type BlockchainClient = Awaited<
  ReturnType<typeof createBlockchainClient>
>;
