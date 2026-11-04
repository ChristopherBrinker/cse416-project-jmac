// Copies the Evaluation ABI from the Foundry build into every consumer.
//   bun contracts/script/sync-abi.ts          write the ABIs
//   bun contracts/script/sync-abi.ts --check  fail if any consumer is out of date
// Run `forge build` in contracts/ first. Comparison is on parsed JSON, so formatting is free.
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const root = new URL("../../", import.meta.url);
const artifact = new URL("contracts/out/Evaluation.sol/Evaluation.json", root);

// The worker only loads what it calls, so its ABI stays a reviewable subset.
const WORKER_ENTRIES = new Set([
  "claimPayment",
  "commitResult",
  "jobs",
  "revealResult",
  "CommitComplete",
  "JobComplete",
  "REVEAL_WINDOW",
]);

interface AbiEntry {
  name?: string;
}

const { abi } = JSON.parse(await readFile(artifact, "utf-8")) as {
  abi: AbiEntry[];
};

const targets: [string, unknown][] = [
  ["apps/web/public/abi.json", { abi }],
  ["packages/scheduler/abi.json", { abi }],
  [
    "workers/jmac_worker/evaluation_abi.json",
    abi.filter((entry) => entry.name && WORKER_ENTRIES.has(entry.name)),
  ],
];

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const [path, expected] of targets) {
  const url = new URL(path, root);
  if (check) {
    const current: unknown = JSON.parse(await readFile(url, "utf-8"));
    if (!isDeepStrictEqual(current, expected)) {
      stale.push(path);
    }
  } else {
    await writeFile(url, `${JSON.stringify(expected, null, 2)}\n`);
  }
}

if (stale.length > 0) {
  process.stderr.write(
    `ABI out of date: ${stale.join(", ")}\nRun forge build, then bun contracts/script/sync-abi.ts\n`
  );
  process.exit(1);
}
