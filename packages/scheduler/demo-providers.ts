/*
  DEMO-ONLY provider simulator. It stands in for two `jmac_worker` processes
  when the Python worker (uv + model download) is not available, so the web
  flow can be demonstrated end to end on a local Anvil chain.

  It does NOT run a model or read the benchmark. It submits a fixed, labelled
  score vector through the real contract lifecycle (commit -> reveal -> claim)
  using the same commitment encoding as the worker:
  keccak256(abi.encode(bool[] scores)).

  Keys come from a local, git-ignored env file and must be Anvil development
  keys holding disposable test funds. Never use a real wallet here.

  Modes (DEMO_RESULT_MODE):
    DEMO_SCORES (default "1,1,0") sets the reported per-item correctness.

  agree     both providers reveal the same vector  -> JobComplete, then claims
    disagree  provider B flips one item             -> JobFailed (refundable)
    silent    nobody commits                         -> expires after COMMIT_WINDOW
*/
import { readFile } from "node:fs/promises";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const HEARTBEAT_INTERVAL_MS = 15_000;
const POLLING_INTERVAL_MS = 1000;
// Per-item correctness the simulated providers report, e.g. "1,1,0" for a
// three-item benchmark. Match the benchmark's item count.
const DEFAULT_DEMO_SCORES = "1,1,0";

type Mode = "agree" | "disagree" | "silent";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in packages/scheduler/.env.demo.local`);
  }
  return value;
};

const parseMode = (value: string | undefined): Mode => {
  if (value === "disagree" || value === "silent") {
    return value;
  }
  return "agree";
};

const runAfter = async (
  previous: Promise<void>,
  task: () => Promise<void>
): Promise<void> => {
  try {
    await previous;
  } catch {
    // The previous send's own caller reports its failure
  }
  await task();
};

const parseScores = (value: string): boolean[] =>
  value.split(",").map((item) => item.trim() === "1");

const encodeCommit = (scores: readonly boolean[]): Hex =>
  keccak256(encodeAbiParameters([{ type: "bool[]" }], [[...scores]]));

interface SimulatedProvider {
  label: "A" | "B";
  providerId: Id<"providers">;
  secret: string;
  account: ReturnType<typeof privateKeyToAccount>;
  scores: boolean[];
}

// Demo settings first, then the scheduler's shared CONVEX_URL/NET_URL/etc.
config({ path: ".env.demo.local", quiet: true });
config({ quiet: true });

async function main() {
  const mode = parseMode(process.env.DEMO_RESULT_MODE);
  const demoScores = parseScores(
    process.env.DEMO_SCORES ?? DEFAULT_DEMO_SCORES
  );
  const contractAddress = requireEnv("CONTRACT_ADDRESS") as Address;
  const rpcUrl = requireEnv("NET_URL");
  const convex = new ConvexHttpClient(requireEnv("CONVEX_URL"));
  const { abi } = JSON.parse(await readFile("./abi.json", "utf-8")) as {
    abi: Abi;
  };

  const providers: SimulatedProvider[] = (["A", "B"] as const).map((label) => ({
    label,
    providerId: requireEnv(`DEMO_PROVIDER_${label}_ID`) as Id<"providers">,
    secret: requireEnv(`DEMO_PROVIDER_${label}_SECRET`),
    account: privateKeyToAccount(
      requireEnv(`DEMO_PROVIDER_${label}_KEY`) as Hex
    ),
    scores:
      mode === "disagree" && label === "B"
        ? demoScores.map((score, index) => (index === 0 ? !score : score))
        : demoScores,
  }));

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(rpcUrl),
    pollingInterval: POLLING_INTERVAL_MS,
  });
  const sendNow = async (
    provider: SimulatedProvider,
    functionName: "commitResult" | "revealResult" | "claimPayment",
    args: readonly unknown[]
  ) => {
    const walletClient = createWalletClient({
      account: provider.account,
      chain: foundry,
      transport: http(rpcUrl),
    });
    const { request } = await publicClient.simulateContract({
      account: provider.account,
      address: contractAddress,
      abi,
      functionName,
      args,
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[provider ${provider.label}] ${functionName} ${hash}`);
  };

  // Event batches for different jobs run concurrently; chain sends so two
  // transactions from one provider account never pick the same nonce. A
  // failed send is logged by its caller and does not block later ones.
  let sendQueue: Promise<void> = Promise.resolve();
  const send = (
    provider: SimulatedProvider,
    functionName: "commitResult" | "revealResult" | "claimPayment",
    args: readonly unknown[]
  ): Promise<void> => {
    const queued = runAfter(sendQueue, () =>
      sendNow(provider, functionName, args)
    );
    sendQueue = queued;
    return queued;
  };

  const heartbeat = async () => {
    await Promise.all(
      providers.map(async (provider) => {
        const result = await convex.mutation(api.provider.heartbeat, {
          providerId: provider.providerId,
          secret: provider.secret,
        });
        if (!result.success) {
          console.log(`[provider ${provider.label}] heartbeat`, result.error);
        }
      })
    );
  };
  await heartbeat();
  setInterval(async () => {
    try {
      await heartbeat();
    } catch (error) {
      console.log("heartbeat", error);
    }
  }, HEARTBEAT_INTERVAL_MS);

  const assignedTo = new Map<string, SimulatedProvider[]>();
  const ours = (address: string) =>
    providers.find(
      (provider) =>
        provider.account.address.toLowerCase() === address.toLowerCase()
    );

  publicClient.watchContractEvent({
    address: contractAddress,
    abi,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { eventName, args } = log as unknown as {
          eventName: string;
          args: Record<string, unknown>;
        };
        const jobId = String(args.jobId);
        try {
          if (eventName === "ProvidersAssigned") {
            const assigned = [
              ours(String(args.addressA)),
              ours(String(args.addressB)),
            ].filter(
              (provider): provider is SimulatedProvider =>
                provider !== undefined
            );
            assignedTo.set(jobId, assigned);
            console.log(`[demo:${mode}] job ${jobId} assigned`);
            if (mode !== "silent") {
              for (const provider of assigned) {
                await send(provider, "commitResult", [
                  jobId,
                  encodeCommit(provider.scores),
                ]);
              }
            }
          } else if (eventName === "CommitComplete") {
            for (const provider of assignedTo.get(jobId) ?? []) {
              await send(provider, "revealResult", [
                jobId,
                [...provider.scores],
              ]);
            }
          } else if (eventName === "JobComplete") {
            for (const provider of assignedTo.get(jobId) ?? []) {
              await send(provider, "claimPayment", [jobId]);
            }
          }
        } catch (error) {
          console.log(`[demo] ${eventName} ${jobId} failed`, error);
        }
      }
    },
  });
  console.log(
    `Demo providers running in "${mode}" mode for ${providers
      .map((provider) => `${provider.label}=${provider.account.address}`)
      .join(", ")}`
  );
}

const run = async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
// oxlint-disable-next-line no-void -- CommonJS entrypoint has no top-level await
void run();
