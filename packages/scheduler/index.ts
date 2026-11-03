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

  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as `0x${string}`;

  const convexClient = new ConvexHttpClient(process.env.CONVEX_URL);
  const BACKEND_CONVEX_KEY = process.env.BACKEND_CONVEX_KEY;

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

  const COMMIT_WINDOW = Number(
    await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "COMMIT_WINDOW",
    })
  );
  const REVEAL_WINDOW = Number(
    await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "REVEAL_WINDOW",
    })
  );

  setInterval(async () => {
    try {
      const result = await convexClient.mutation(api.provider.checkHeartbeats, {
        backendKey: BACKEND_CONVEX_KEY,
      });
      if (!result.success) {
        console.log("Heartbeat check failed:", result.error);
        return;
      }
      console.log(`Heartbeat check modified ${result.modifiedCount} records`);
    } catch (error) {
      console.log("Provider heartbeat check error:", error);
    }
  }, 1000 * 60);

  setInterval(
    async () => {
      try {
        const timeout = (COMMIT_WINDOW + REVEAL_WINDOW) * 1000 + 30 * 1000;
        const result = await convexClient.query(api.job.getTimedOutJobs, {
          backendKey: BACKEND_CONVEX_KEY,
          timeout,
        });
        if (!result.success || !result.jobIds) {
          console.log("Job cleanup failed:", result.error);
          return;
        }
        console.log(`Job cleanup found ${result.jobIds.length} records`);

        await Promise.all(
          result.jobIds.map(async (id) => {
            let endStateA: string | undefined;
            let endStateB: string | undefined;

            // Determine state of each provider
            try {
              const providerStates = (await publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi,
                functionName: "getProviderStates",
                args: [id],
              })) as boolean[];

              const commitComplete = providerStates[0] && providerStates[2];
              if (commitComplete) {
                endStateA = providerStates[1] ? "submitted" : "reveal_timeout";
                endStateB = providerStates[3] ? "submitted" : "reveal_timeout";
              } else {
                endStateA = providerStates[0] ? "submitted" : "commit_timeout";
                endStateB = providerStates[2] ? "submitted" : "commit_timeout";
              }
            } catch {
              console.log(`Failed to get job ${id} from blockchain`);
            }

            try {
              const statusResult = await convexClient.mutation(
                api.job.setStatus,
                {
                  jobId: id,
                  status: "failed",
                  endStateA,
                  endStateB,
                  backendKey: BACKEND_CONVEX_KEY,
                }
              );
              if (!statusResult.success) {
                console.log(
                  `Failed to set status for ${id}:`,
                  statusResult.error
                );
                return;
              }
              console.log(`Updated ${id} status to failed`);
            } catch (error) {
              console.log(`Failed to set status for ${id}:`, error);
            }
          })
        );
      } catch (error) {
        console.log("Job cleanup error:", error);
      }
    },
    1000 * 60 * 2
  );

  async function assignProviders(
    jobId: Id<"jobs">,
    price: bigint,
    retry: boolean
  ) {
    const providerAssignment = await convexClient.mutation(
      api.job.assignProviders,
      {
        jobId,
        price,
        retry,
        backendKey: BACKEND_CONVEX_KEY,
      }
    );

    if (!providerAssignment.success) {
      console.log(`Failed assignment for ${jobId}:`, providerAssignment.error);
      return providerAssignment;
    }

    if (!providerAssignment.providers) {
      return providerAssignment;
    }
    const providers = providerAssignment.providers;

    const { request } = await publicClient.simulateContract({
      account,
      address: CONTRACT_ADDRESS,
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
    return providerAssignment;
  }

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

            const result = await assignProviders(jobId, price, false);
            if (!result.success && result.error === "Providers unavailable") {
              setTimeout(async () => {
                try {
                  await assignProviders(jobId, price, true);
                } catch {
                  /* */
                }
              }, 1000 * 60);
            }
          } else if (decoded.eventName === "JobFailed") {
            const jobId = decoded.args.jobId as Id<"jobs">;
            const statusResult = await convexClient.mutation(
              api.job.setStatus,
              {
                jobId,
                status: "failed",
                endStateA: "disagreement",
                endStateB: "disagreement",
                backendKey: BACKEND_CONVEX_KEY,
              }
            );
            if (!statusResult.success) {
              console.log(
                `Failed to set status for ${jobId}:`,
                statusResult.error
              );
              continue;
            }
            console.log(`Updated ${jobId} status to failed`);
          } else if (decoded.eventName === "JobComplete") {
            const jobId = decoded.args.jobId as Id<"jobs">;
            const scores = decoded.args.scores as boolean[];
            let correct = 0;
            for (const s of scores) {
              if (s) {
                correct++;
              }
            }
            const score = (correct / scores.length) * 100;

            const statusResult = await convexClient.mutation(
              api.job.setStatus,
              {
                jobId,
                status: "succeeded",
                score,
                endStateA: "succeeded",
                endStateB: "succeeded",
                backendKey: BACKEND_CONVEX_KEY,
              }
            );
            if (!statusResult.success) {
              console.log(
                `Failed to set status for ${jobId}:`,
                statusResult.error
              );
              continue;
            }
            console.log(
              `Updated ${jobId} status to succeeded with score ${score}`
            );
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
