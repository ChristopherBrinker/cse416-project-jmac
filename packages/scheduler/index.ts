import { readFile } from "node:fs/promises";

import "dotenv/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

async function main() {
  if (!process.env.BACKEND_WALLET_PRIVATE_KEY) {
    throw new Error("Provide the private key of the backend wallet");
  }
  if (!process.env.CONTRACT_ADDRESS) {
    throw new Error("Provide the address of the deployed contract");
  }

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(process.env.NET_URL),
  });

  const account = privateKeyToAccount(
    process.env.BACKEND_WALLET_PRIVATE_KEY as `0x${string}`
  );

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(),
  });

  const abiContents = await readFile("./abi.json", "utf-8");
  const abiHolder = JSON.parse(abiContents);
  const abi = abiHolder["abi"];

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: process.env.CONTRACT_ADDRESS as `0x${string}`,
      abi,
      functionName: "setNumber",
      args: [10n],
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    console.log(error);
  }
}

main();
setInterval(() => {
  console.log("test");
}, 10_000);
