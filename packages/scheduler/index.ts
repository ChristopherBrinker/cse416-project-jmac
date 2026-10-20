import { readFile } from "node:fs/promises";

import "dotenv/config";
import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

interface SolidityEvent {
  eventName: string;
  args: any;
}

async function main() {
  if (!process.env.BACKEND_WALLET_PRIVATE_KEY) {
    throw new Error("Provide the private key of the backend wallet");
  }
  if (!process.env.CONTRACT_ADDRESS) {
    throw new Error("Provide the address of the deployed contract");
  }
  if (!process.env.CONVEX_URL) {
    throw new Error("Provide CONVEX_URL");
  }
  if (!process.env.BACKEND_CONVEX_KEY) {
    throw new Error("Provide BACKEND_CONVEX_KEY");
  }

  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

  const convexClient = new ConvexHttpClient(process.env.CONVEX_URL);
  const BACKEND_CONVEX_KEY = process.env.BACKEND_CONVEX_KEY;

  setInterval(async () => {
    try {
      const result = await convexClient.mutation(api.provider.checkHeartbeats, {
        backendKey: BACKEND_CONVEX_KEY,
      });
      if (!result.success) {
        console.log("Heartbeat check failed:", result.error);
      }
      console.log(`Heartbeat check modified ${result.modifiedCount} records`);
    } catch (error) {
      console.log("Provider heartbeat check error:", error);
    }
  }, 1000 * 60);

  setInterval(
    async () => {
      try {
        const result = await convexClient.mutation(api.job.cleanUp, {
          backendKey: BACKEND_CONVEX_KEY,
        });
        if (!result.success) {
          console.log("Job cleanup failed:", result.error);
        }
        console.log(`Job cleanup modified ${result.modifiedCount} records`);
      } catch (error) {
        console.log("Job cleanup error:", error);
      }
    },
    1000 * 60 * 10
  );

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

  publicClient.watchEvent({
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as SolidityEvent;

          if (decoded.eventName === "JobFunded") {
            const jobId = decoded.args.jobId as Id<"jobs">;
            const price = decoded.args.price as bigint;
            const providerAssignment = await convexClient.mutation(
              api.job.assignProviders,
              {
                jobId,
                price,
                backendKey: BACKEND_CONVEX_KEY,
              }
            );

            if (!providerAssignment.success) {
              console.log(
                `Failed assignment for ${jobId}:`,
                providerAssignment.error
              );
              return;
            }

            if (!providerAssignment.providers) {
              return;
            }
            const providers = providerAssignment.providers;

            const { request } = await publicClient.simulateContract({
              account,
              address: CONTRACT_ADDRESS as `0x${string}`,
              abi,
              functionName: "assignProviders",
              args: [
                jobId,
                providers[0].walletAddress,
                providers[0]._id,
                providers[1].walletAddress,
                providers[1]._id,
              ],
            });
            const hash = await walletClient.writeContract(request);
            await publicClient.waitForTransactionReceipt({ hash });
            console.log(`Successful assignment for ${jobId}. Hash: ${hash}`);
          } else {
            console.log(decoded);
          }
        } catch (error) {
          //console.log("error");
          console.log(error);
        }
      }
    },
  });
}

main();
