import { mkdir, open, readFile } from "node:fs/promises";
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

  async start(name: string, command: string[], cwd: string, env = process.env) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const log = await open(
      path.join(this.directory, `${name}.log`),
      "w",
      0o600
    );
    try {
      const child = Bun.spawn(command, {
        cwd,
        env,
        stdout: log.fd,
        stderr: log.fd,
      });
      this.children.push({ name, process: child, stopped: false });
      return child;
    } finally {
      await log.close();
    }
  }

  assertRunning() {
    for (const child of this.children) {
      if (!child.stopped && child.process.exitCode !== null) {
        throw new Error(
          `${child.name} exited (${child.process.exitCode}); see ${this.directory}`
        );
      }
    }
  }

  async run(name: string, command: string[], cwd: string, env = process.env) {
    const child = await this.start(name, command, cwd, env);
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    try {
      const code = await child.exited;
      const tracked = this.children.find((entry) => entry.process === child);
      if (tracked) {
        tracked.stopped = true;
      }
      if (code !== 0) {
        throw new Error(
          `${name} failed (${code}); see ${path.join(this.directory, `${name}.log`)}`
        );
      }
      return await readFile(path.join(this.directory, `${name}.log`), "utf-8");
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

export async function waitFor<T>(
  label: string,
  check: () => Promise<T | undefined>,
  processes: Processes,
  timeout = 90_000
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    processes.assertRunning();
    const result = await check();
    if (result !== undefined) {
      return result;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}; see ${processes.directory}`);
}
