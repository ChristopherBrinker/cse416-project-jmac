import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Processes, waitFor } from "./processes";

let directory: string;
let processes: Processes;
const cwd = process.cwd();
const idleCommand = [process.execPath, "-e", "setInterval(() => {}, 1000)"];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "jmac-e2e-processes-"));
  processes = new Processes(directory);
});

afterEach(async () => {
  await processes.stop();
  await rm(directory, { recursive: true, force: true });
});

test("command stdout remains parseable when stderr contains a warning", async () => {
  const output = await processes.run(
    "settings",
    [
      process.execPath,
      "-e",
      'process.stdout.write(JSON.stringify({ok: true})); process.stderr.write("warning on stderr\\n");',
    ],
    cwd
  );
  expect(JSON.parse(output)).toEqual({ ok: true });
  const stderr = await readFile(path.join(directory, "settings.log"), "utf-8");
  expect(stderr).toBe("warning on stderr\n");
  const stdout = await readFile(
    path.join(directory, "settings.stdout.log"),
    "utf-8"
  );
  expect(stdout).toBe(output);
  expect(() => processes.assertRunning()).not.toThrow();
});

test("long-running service logs retain both stdout and stderr", async () => {
  const child = await processes.start(
    "service",
    [
      process.execPath,
      "-e",
      'process.stdout.write("service output\\n"); process.stderr.write("service warning\\n");',
    ],
    cwd
  );
  await child.exited;
  const log = await readFile(path.join(directory, "service.log"), "utf-8");
  expect(log).toContain("service output\n");
  expect(log).toContain("service warning\n");
});

test("unexpected signal termination fails liveness checks immediately", async () => {
  const child = await processes.start("worker", idleCommand, cwd);
  child.kill("SIGKILL");
  await child.exited;
  expect(() => processes.assertRunning()).toThrow("worker exited (SIGKILL)");
});

test("unexpected numeric service exit codes remain detectable", async () => {
  const child = await processes.start(
    "worker",
    [process.execPath, "-e", "process.exit(7)"],
    cwd
  );
  await child.exited;
  expect(() => processes.assertRunning()).toThrow("worker exited (7)");
});

test("intentional service shutdown does not fail liveness checks", async () => {
  await processes.start("worker", idleCommand, cwd);
  await processes.stop("worker");
  expect(() => processes.assertRunning()).not.toThrow();
});

test("command timeouts report the deadline and finish tracking the killed child", async () => {
  await expect(
    processes.run("stalled", idleCommand, cwd, process.env, 20)
  ).rejects.toThrow("stalled timed out after 0.02s");
  expect(() => processes.assertRunning()).not.toThrow();
});

test("poll deadlines reject even while the check remains pending", async () => {
  const controller = new AbortController();
  try {
    const polling = waitFor(
      "stalled API",
      async () => {
        await sleep(10_000, undefined, { signal: controller.signal });
        return true;
      },
      processes,
      20
    );
    const watchdog = sleep(2000, "helper did not enforce its deadline", {
      signal: controller.signal,
    });
    await expect(Promise.race([polling, watchdog])).rejects.toThrow(
      "Timed out waiting for stalled API"
    );
  } finally {
    controller.abort();
  }
});

test("polling retries incomplete checks and returns the eventual value", async () => {
  let attempts = 0;
  const result = await waitFor(
    "ready service",
    async () => {
      attempts += 1;
      return attempts === 2 ? "ready" : undefined;
    },
    processes,
    2000
  );
  expect(result).toBe("ready");
  expect(attempts).toBe(2);
});

test("polling preserves callback errors instead of reporting a timeout", async () => {
  await expect(
    waitFor(
      "service",
      async () => {
        throw new Error("upstream failure");
      },
      processes
    )
  ).rejects.toThrow("upstream failure");
});
