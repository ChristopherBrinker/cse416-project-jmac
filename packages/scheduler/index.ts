import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

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

import { specHash } from "./spec";

interface SolidityEvent {
  eventName: string;
  args: any;
}

interface struct_provider {
  addr: string;
  id: string;
  commit: string;
  outputDigest: string;
  flag: boolean;
  revealed: boolean;
  claimed: boolean;
  correctCount: bigint;
}
const CHAIN_READ_ATTEMPTS = 3;
const CHAIN_READ_RETRY_MS = 2000;
const CHAIN_READ_FAILED = "Chain read failed";

type struct_job = [
  // creatorAddr
  string,
  // id
  string,
  // price
  bigint,
  // providerA
  struct_provider,
  // providerB
  struct_provider,
  // flag
  boolean,
  // status
  number,
  // commitDeadline
  bigint,
  // specHash
  string,
  // itemCount
  bigint,
];

const JOB_STATUS_COMPLETE = 1;
const JOB_STATUS_REFUNDED = 3;

// The accepted score is derived only from the agreed on-chain count, never from mutable records.
const percentScore = (correctCount: bigint, itemCount: bigint): number =>
  (Number(correctCount) / Number(itemCount)) * 100;

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
            let status = "failed";
            let score: number | undefined;

            try {
              const job = (await publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi,
                functionName: "jobs",
                args: [id],
              })) as struct_job;

              const providerA = job[3];
              const providerB = job[4];

              const wasAssigned = providerA.flag && providerB.flag;
              if (wasAssigned) {
                const EMPTY_COMMIT =
                  "0x0000000000000000000000000000000000000000000000000000000000000000";
                const providerACommitted = providerA.commit !== EMPTY_COMMIT;
                const providerBCommitted = providerB.commit !== EMPTY_COMMIT;
                if (providerACommitted && providerBCommitted) {
                  if (providerA.revealed && providerB.revealed) {
                    if (job[6] === JOB_STATUS_COMPLETE) {
                      status = "succeeded";
                      endStateA = "succeeded";
                      endStateB = "succeeded";
                      score = percentScore(providerA.correctCount, job[9]);
                    } else {
                      status = "failed";
                      endStateA = "disagreement";
                      endStateB = "disagreement";
                    }
                  } else {
                    endStateA = providerA.revealed
                      ? "submitted"
                      : "reveal_timeout";
                    endStateB = providerB.revealed
                      ? "submitted"
                      : "reveal_timeout";
                  }
                } else {
                  endStateA = providerACommitted
                    ? "submitted"
                    : "commit_timeout";
                  endStateB = providerBCommitted
                    ? "submitted"
                    : "commit_timeout";
                }
              } else {
                endStateA = "assignment_failed";
                endStateB = "assignment_failed";
              }
            } catch {
              console.log(`Failed to get job ${id} from blockchain`);
              return;
            }

            try {
              const statusResult = await convexClient.mutation(
                api.job.setStatus,
                {
                  jobId: id,
                  status,
                  score,
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
              console.log(`Updated ${id} status`);
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

  // Returns undefined if the RPC keeps failing; the caller retries the whole assignment.
  async function readCreatorWallet(jobId: Id<"jobs">) {
    for (let attempt = 1; attempt <= CHAIN_READ_ATTEMPTS; attempt += 1) {
      try {
        const [creatorWallet] = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi,
          functionName: "jobs",
          args: [jobId],
        })) as struct_job;
        return creatorWallet;
      } catch (error) {
        console.log(`Reading job ${jobId} failed (attempt ${attempt}):`, error);
        await sleep(CHAIN_READ_RETRY_MS);
      }
    }
  }

  async function assignProviders(
    jobId: Id<"jobs">,
    price: bigint,
    jobFunded_tx: string,
    retry: boolean
  ) {
    // The contract refuses the creator as a provider, so exclude its wallet before Convex
    // records an assignment that could never reach the chain. Convex is untouched if this
    // read fails, so the job stays "created" and the caller retries as a first attempt.
    const creatorWallet = await readCreatorWallet(jobId);
    if (!creatorWallet) {
      return { success: false, error: CHAIN_READ_FAILED } as const;
    }
    const providerAssignment = await convexClient.mutation(
      api.job.assignProviders,
      {
        jobId,
        price,
        jobFunded_tx,
        retry,
        creatorWallet,
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
    const { providers, spec } = providerAssignment;
    if (!spec?.itemCount) {
      console.log(`Missing evaluation spec for ${jobId}`);
      return providerAssignment;
    }

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
        specHash(spec.contentHash, spec.modelId),
        BigInt(spec.itemCount),
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

            const result = await assignProviders(
              jobId,
              price,
              log.transactionHash,
              false
            );
            // "Providers unavailable" leaves the job funded in Convex; a failed chain read
            // leaves it untouched. Both are retried once a minute later.
            const retryable =
              !result.success &&
              (result.error === "Providers unavailable" ||
                result.error === CHAIN_READ_FAILED);
            if (retryable) {
              const alreadyFunded = result.error === "Providers unavailable";
              setTimeout(async () => {
                try {
                  await assignProviders(
                    jobId,
                    price,
                    log.transactionHash,
                    alreadyFunded
                  );
                } catch {
                  /* */
                }
              }, 1000 * 60);
            }
          } else if (decoded.eventName === "JobFailed") {
            const jobId = decoded.args.jobId as Id<"jobs">;

            const job = (await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi,
              functionName: "jobs",
              args: [jobId],
            })) as struct_job;

            if (job[6] === JOB_STATUS_REFUNDED) {
              continue;
            }

            const statusResult = await convexClient.mutation(
              api.job.setStatus,
              {
                jobId,
                status: "failed",
                endStateA: "disagreement",
                endStateB: "disagreement",
                tx: log.transactionHash,
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
            const score = percentScore(
              decoded.args.correctCount as bigint,
              decoded.args.itemCount as bigint
            );

            const statusResult = await convexClient.mutation(
              api.job.setStatus,
              {
                jobId,
                status: "succeeded",
                score,
                endStateA: "succeeded",
                endStateB: "succeeded",
                tx: log.transactionHash,
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
