import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { encodeAbiParameters, keccak256, parseAbi, zeroHash } from "viem";
import type { Hex } from "viem";

import { specHash } from "../spec";
import { waitFor } from "./processes";
import { accounts, createStack, root } from "./stack";
import type { Stack } from "./stack";

const abi = parseAbi([
  "function jobs(string) view returns (address creatorAddr, string id, uint256 price, (address addr, string id, bytes32 commit, bytes32 outputDigest, bool flag, bool revealed, bool claimed, uint256 correctCount) providerA, (address addr, string id, bytes32 commit, bytes32 outputDigest, bool flag, bool revealed, bool claimed, uint256 correctCount) providerB, bool flag, uint8 status, uint256 commitDeadline, bytes32 specHash, uint256 itemCount)",
  "function fundJob(string jobId) payable",
  "function refund(string jobId)",
  "function resultCommitment(string jobId, address provider, bytes32 outputDigest, uint256 correctCount, bytes32 salt) view returns (bytes32)",
  "function commitResult(string jobId, bytes32 commitment)",
  "function revealResult(string jobId, bytes32 outputDigest, uint256 correctCount, bytes32 salt)",
  "function claimPayment(string jobId)",
  "function REVEAL_WINDOW() view returns (uint256)",
]);

let stack: Stack;
let benchmarkId: Id<"benchmarks">;
let benchmarkBytes: string;
const evidence: { scenario: string; jobId: string; status: number }[] = [];
const state = async (jobId: string) =>
  await stack.chain.readContract({
    address: stack.contract,
    abi,
    functionName: "jobs",
    args: [jobId],
  });

beforeAll(async () => {
  stack = await createStack();
  process.stderr.write(`E2E artifacts: ${stack.directory}\n`);
  const stopOnInterrupt = async () => {
    await stack.stop();
    process.exit(130);
  };
  process.once("SIGINT", stopOnInterrupt);
  process.once("SIGTERM", stopOnInterrupt);
  await stack.start();
  benchmarkBytes = await readFile(
    path.join(root, "workers/examples/benchmark.json"),
    "utf-8"
  );
  const upload = await fetch(`${stack.site}/benchmark/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stack.creator.token}`,
      "Content-Type": "application/json",
    },
    body: benchmarkBytes,
  });
  if (!upload.ok) {
    throw new Error(
      `Benchmark upload failed (${upload.status}): ${await upload.text()}`
    );
  }
  const body = await upload.json();
  benchmarkId = body.benchmarkId;
  await stack.startWorkers();
}, 240_000);

afterAll(async () => {
  if (stack) {
    await stack.stop();
    await writeFile(
      path.join(stack.directory, "evidence.json"),
      JSON.stringify(
        { contract: stack.contract, scenarios: evidence },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }
});

async function createFundedJob() {
  const created = await stack.creator.client.mutation(api.job.createJob, {
    benchmarkId,
    modelId: stack.modelId,
  });
  if (!created.success || !created.jobId || !created.price) {
    throw new Error(`Job creation failed: ${created.error}`);
  }
  const hash = await stack.wallet().writeContract({
    address: stack.contract,
    abi,
    functionName: "fundJob",
    args: [created.jobId],
    value: created.price,
  });
  const receipt = await stack.chain.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  await waitFor(
    "scheduler assignment",
    async () => {
      const job = await state(created.jobId!);
      return job[3].flag && job[4].flag ? job : undefined;
    },
    stack.processes
  );
  return { id: created.jobId, price: created.price, hash };
}

async function backendJob(id: Id<"jobs">) {
  const jobs = await stack.creator.client.query(api.job.getUserJobs, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  return jobs.page.find((job) => job._id === id);
}

async function assertReleased() {
  for (const provider of stack.providers) {
    const active = await provider.client.query(api.job.getJobsForProvider, {
      providerId: provider.id,
      secret: provider.secret,
    });
    expect(active).toEqual([]);
    const providers = await provider.client.query(
      api.provider.getUserProviders,
      { paginationOpts: { numItems: 10, cursor: null } }
    );
    expect(
      providers.page.find((row) => row._id === provider.id)?.currentJobs
    ).toBe(0n);
  }
}

async function refund(id: string, price: bigint) {
  await expect(
    stack.chain.simulateContract({
      account: accounts[2],
      address: stack.contract,
      abi,
      functionName: "refund",
      args: [id],
    })
  ).rejects.toThrow();
  const before = await stack.chain.getBalance({ address: accounts[1].address });
  const hash = await stack.wallet().writeContract({
    address: stack.contract,
    abi,
    functionName: "refund",
    args: [id],
  });
  const receipt = await stack.chain.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  const after = await stack.chain.getBalance({ address: accounts[1].address });
  expect(after - before + receipt.gasUsed * receipt.effectiveGasPrice).toBe(
    price
  );
  const job = await state(id);
  expect(job[6]).toBe(3);
  expect(job[3].claimed).toBe(false);
  expect(job[4].claimed).toBe(false);
  expect(await stack.chain.getBalance({ address: stack.contract })).toBe(0n);
  await expect(
    stack.chain.simulateContract({
      account: accounts[1],
      address: stack.contract,
      abi,
      functionName: "refund",
      args: [id],
    })
  ).rejects.toThrow();
  await expect(
    stack.chain.simulateContract({
      account: accounts[2],
      address: stack.contract,
      abi,
      functionName: "claimPayment",
      args: [id],
    })
  ).rejects.toThrow();
}

async function scriptProvidersReady() {
  for (const provider of stack.providers) {
    const result = await provider.client.mutation(api.provider.setStatus, {
      providerId: provider.id,
      secret: provider.secret,
      newStatus: "ready",
    });
    expect(result.success).toBe(true);
    const heartbeat = await provider.client.mutation(api.provider.heartbeat, {
      providerId: provider.id,
      secret: provider.secret,
    });
    expect(heartbeat.success).toBe(true);
  }
}

async function commitScripted(id: string, digests: Hex[]) {
  const salts = [0, 1].map(
    () => `0x${randomBytes(32).toString("hex")}` as const
  );
  for (const [index, provider] of stack.providers
    .slice(0, digests.length)
    .entries()) {
    const commitment = await stack.chain.readContract({
      address: stack.contract,
      abi,
      functionName: "resultCommitment",
      args: [id, provider.account.address, digests[index], 2n, salts[index]],
    });
    const hash = await stack.wallet(provider.account).writeContract({
      address: stack.contract,
      abi,
      functionName: "commitResult",
      args: [id, commitment],
    });
    const receipt = await stack.chain.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  }
  return salts;
}

async function advancePast(timestamp: bigint) {
  await stack.clock.setNextBlockTimestamp({ timestamp: timestamp + 1n });
  await stack.clock.mine({ blocks: 1 });
}

test("real workers evaluate the uploaded benchmark, settle matching results, and both receive payment", async () => {
  const job = await createFundedJob();
  const completed = await waitFor(
    "worker commits, reveals and payments",
    async () => {
      const current = await state(job.id);
      return current[6] === 1 && current[3].claimed && current[4].claimed
        ? current
        : undefined;
    },
    stack.processes,
    180_000
  );
  expect(completed[0].toLowerCase()).toBe(accounts[1].address.toLowerCase());
  expect(stack.concurrentCommitEstimates).toBe(true);
  expect(completed[2]).toBe(job.price);
  expect(completed[3].id).toBe(stack.providers[0].id);
  expect(completed[4].id).toBe(stack.providers[1].id);
  expect(completed[3].revealed && completed[4].revealed).toBe(true);
  expect(completed[9]).toBe(3n);
  const contentHash = createHash("sha256").update(benchmarkBytes).digest("hex");
  expect(completed[8]).toBe(specHash(contentHash, stack.modelId));
  const results = [];
  for (const provider of stack.providers) {
    const files = await readdir(provider.results);
    const documents = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map(
          async (name) =>
            await Bun.file(path.join(provider.results, name)).json()
        )
    );
    const result = documents.find(
      (document) =>
        document.schema_version === "3.0.0" &&
        document.assignment?.job_id === job.id
    );
    expect(result).toBeDefined();
    expect(result.benchmark.content_hash).toBe(contentHash);
    expect(result.inference).toBeDefined();
    expect(result.total).toBe(3);
    expect(result.predictions).toHaveLength(3);
    const answers = JSON.parse(benchmarkBytes).items.map(
      (item: { correct_choice: number }) => item.correct_choice
    );
    const correct = result.predictions.filter(
      (prediction: number, index: number) => prediction === answers[index]
    ).length;
    expect(result.correct).toBe(correct);
    const digest = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "string" }, { type: "uint256[]" }],
        [
          `0x${result.benchmark.output_key}` as const,
          job.id,
          result.predictions.map(BigInt),
        ]
      )
    );
    expect(digest).toBe(completed[3].outputDigest);
    expect(BigInt(correct)).toBe(completed[3].correctCount);
    results.push(result);
  }
  expect(results[0].predictions).toEqual(results[1].predictions);
  const backend = await waitFor(
    "scheduler success synchronization",
    async () => {
      const current = await backendJob(job.id);
      return current?.status === "succeeded" ? current : undefined;
    },
    stack.processes
  );
  expect(backend.score).toBe((Number(completed[3].correctCount) / 3) * 100);
  expect(backend.jobFunded_tx).toBe(job.hash);
  expect(backend.jobComplete_tx).toMatch(/^0x[\da-f]{64}$/u);
  expect(completed[3].outputDigest).toBe(completed[4].outputDigest);
  expect(await stack.chain.getBalance({ address: stack.contract })).toBe(0n);
  await assertReleased();
  await expect(
    stack.chain.simulateContract({
      account: accounts[2],
      address: stack.contract,
      abi,
      functionName: "claimPayment",
      args: [job.id],
    })
  ).rejects.toThrow();
  evidence.push({
    scenario: "real-worker-success",
    jobId: job.id,
    status: completed[6],
  });
  // Negative cases use controlled transactions; no model output is modified.
  for (const provider of stack.providers) {
    await stack.processes.stop(provider.id);
  }
});

test("conflicting provider outputs fail the job and refund the creator exactly once", async () => {
  for (const provider of stack.providers) {
    await stack.processes.stop(provider.id);
  }
  await scriptProvidersReady();
  const job = await createFundedJob();
  const digests = [keccak256("0x01"), keccak256("0x02")];
  const salts = await commitScripted(job.id, digests);
  for (const [index, provider] of stack.providers.entries()) {
    const hash = await stack.wallet(provider.account).writeContract({
      address: stack.contract,
      abi,
      functionName: "revealResult",
      args: [job.id, digests[index], 2n, salts[index]],
    });
    const receipt = await stack.chain.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  }
  const failed = await state(job.id);
  expect(failed[6]).toBe(2);
  const backend = await waitFor(
    "scheduler disagreement synchronization",
    async () => {
      const current = await backendJob(job.id);
      return current?.status === "failed" ? current : undefined;
    },
    stack.processes
  );
  expect(backend.failureReason).toBe("Providers disagreed on results");
  expect(backend.score).toBeUndefined();
  await assertReleased();
  await refund(job.id, job.price);
  evidence.push({ scenario: "disagreement-refund", jobId: job.id, status: 3 });
});

test("a missing commit prevents early refunds and permits a refund after the commit deadline", async () => {
  await scriptProvidersReady();
  const job = await createFundedJob();
  await commitScripted(job.id, [keccak256("0x01")]);
  const assigned = await state(job.id);
  expect(assigned[3].commit).not.toBe(zeroHash);
  expect(assigned[4].commit).toBe(zeroHash);
  await expect(
    stack.chain.simulateContract({
      account: accounts[1],
      address: stack.contract,
      abi,
      functionName: "refund",
      args: [job.id],
    })
  ).rejects.toThrow();
  await advancePast(assigned[7]);
  await refund(job.id, job.price);
  evidence.push({
    scenario: "commit-timeout-refund",
    jobId: job.id,
    status: 3,
  });
});

test("both commits extend refund eligibility to the reveal deadline", async () => {
  // The scheduler cleans timeout capacity on its wall-clock sweep, so use spare
  // capacity for this last case; chain time travel does not advance Convex time.
  for (const provider of stack.providers) {
    await provider.client.mutation(api.provider.setStatus, {
      providerId: provider.id,
      secret: provider.secret,
      newStatus: "offline",
    });
    const capacity = await provider.client.mutation(api.provider.setMaxJobs, {
      providerId: provider.id,
      newMaxJobs: 2n,
    });
    expect(capacity.success).toBe(true);
  }
  await scriptProvidersReady();
  const job = await createFundedJob();
  await commitScripted(job.id, [keccak256("0x01"), keccak256("0x01")]);
  const assigned = await state(job.id);
  const revealWindow = await stack.chain.readContract({
    address: stack.contract,
    abi,
    functionName: "REVEAL_WINDOW",
  });
  await advancePast(assigned[7]);
  await expect(
    stack.chain.simulateContract({
      account: accounts[1],
      address: stack.contract,
      abi,
      functionName: "refund",
      args: [job.id],
    })
  ).rejects.toThrow();
  await advancePast(assigned[7] + revealWindow);
  await refund(job.id, job.price);
  evidence.push({
    scenario: "reveal-timeout-refund",
    jobId: job.id,
    status: 3,
  });
});
