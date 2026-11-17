import { mkdir, open, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export class Processes {
  private readonly children: {
    name: string;
    process: ReturnType<typeof Bun.spawn>;
    stopped: boolean;
  }[] = [];

  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async start(
    name: string,
    command: string[],
    cwd: string,
    env = process.env,
    captureStdout = false
  ) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const log = await open(
      path.join(this.directory, `${name}.log`),
      "w",
      0o600
    );
    let stdout: FileHandle | undefined;
    try {
      if (captureStdout) {
        stdout = await open(
          path.join(this.directory, `${name}.stdout.log`),
          "w",
          0o600
        );
      }
      const child = Bun.spawn(command, {
        cwd,
        env,
        stdout: stdout?.fd ?? log.fd,
        stderr: log.fd,
      });
      this.children.push({ name, process: child, stopped: false });
      return child;
    } finally {
      await Promise.all([log.close(), stdout?.close()]);
    }
  }

  assertRunning() {
    for (const child of this.children) {
      const reason = child.process.exitCode ?? child.process.signalCode;
      if (!child.stopped && reason !== null) {
        throw new Error(
          `${child.name} exited (${reason}); see ${this.directory}`
        );
      }
    }
  }

  async run(
    name: string,
    command: string[],
    cwd: string,
    env = process.env,
    timeout = 120_000
  ) {
    const child = await this.start(name, command, cwd, env, true);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    try {
      const code = await child.exited;
      const tracked = this.children.find((entry) => entry.process === child);
      if (tracked) {
        tracked.stopped = true;
      }
      if (timedOut) {
        throw new Error(
          `${name} timed out after ${timeout / 1000}s; see ${this.directory}`
        );
      }
      if (code !== 0) {
        throw new Error(
          `${name} failed (${code}); see ${path.join(this.directory, `${name}.log`)}`
        );
      }
      return await readFile(
        path.join(this.directory, `${name}.stdout.log`),
        "utf-8"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(name?: string) {
    for (const child of this.children.toReversed()) {
      if (child.stopped || (name && child.name !== name)) {
        continue;
      }
      child.stopped = true;
      child.process.kill("SIGTERM");
      const timer = setTimeout(() => child.process.kill("SIGKILL"), 10_000);
      try {
        await child.process.exited;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

async function expireAfter(
  timeout: number,
  error: Error,
  signal: AbortSignal
): Promise<never> {
  await sleep(timeout, undefined, { signal });
  throw error;
}

export async function waitFor<T>(
  label: string,
  check: () => Promise<T | undefined>,
  processes: Processes,
  timeout = 90_000
): Promise<T> {
  const deadline = Date.now() + timeout;
  const timeoutError = new Error(
    `Timed out waiting for ${label}; see ${processes.directory}`
  );
  while (Date.now() < deadline) {
    processes.assertRunning();
    const controller = new AbortController();
    let result: T | undefined;
    try {
      const pending = check();
      result = await Promise.race([
        pending,
        expireAfter(deadline - Date.now(), timeoutError, controller.signal),
      ]);
    } finally {
      controller.abort();
    }
    if (result !== undefined) {
      return result;
    }
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw timeoutError;
}
