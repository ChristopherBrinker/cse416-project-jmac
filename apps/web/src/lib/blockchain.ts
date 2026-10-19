"use client";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

export const createBlockchainClient = async (key: `0x${string}`) => {
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(process.env.NEXT_PUBLIC_NET_URL),
  });
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(),
  });

  const abiRes = await fetch("/abi.json");
  const abiHolder = await abiRes.json();
  const abi = abiHolder["abi"];

  return { publicClient, walletClient, account, abi };
};

export type BlockchainClient = Awaited<
  ReturnType<typeof createBlockchainClient>
>;
