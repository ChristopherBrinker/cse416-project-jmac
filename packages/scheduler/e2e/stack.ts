import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseTransaction,
  toFunctionSelector,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { Processes, waitFor } from "./processes";

export const root = path.resolve(import.meta.dirname, "../../..");
const scheduler = path.join(root, "packages/scheduler");
const workers = path.join(root, "workers");
const mnemonic = "test test test test test test test test test test test junk";
export const accounts = [0, 1, 2, 3].map((addressIndex) =>
  mnemonicToAccount(mnemonic, { addressIndex })
);

async function freePort(): Promise<number> {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a loopback port");
  }
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}

export interface User {
  client: ConvexHttpClient;
  token: string;
}
export type Provider = User & {
  id: Id<"providers">;
  secret: string;
  account: (typeof accounts)[number];
  results: string;
};

export class Stack {
  concurrentCommitEstimates = false;
  private readonly pendingCommits = new Set<string>();
  readonly processes: Processes;
  readonly python = path.resolve(
    process.env.E2E_PYTHON ?? path.join(workers, ".venv/bin/python")
  );
  readonly cache = path.resolve(
    process.env.E2E_MODEL_CACHE ?? path.join(workers, ".cache/huggingface")
  );
  private rpcProxy?: Bun.Server<undefined>;
  private schedulerSubscribed = false;
  readonly backendKey = randomBytes(32).toString("hex");
  url = "";
  site = "";
  rpc = "";
  contract: `0x${string}` = "0x0000000000000000000000000000000000000000";
  adminKey = "";
  modelId!: Id<"models">;
  creator!: User;
  providers: Provider[] = [];

  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    this.processes = new Processes(path.join(directory, "logs"));
  }

  get chain() {
    return createPublicClient({
      chain: foundry,
      transport: http(this.rpc),
      cacheTime: 0,
    });
  }

  get clock() {
    return createTestClient({
      mode: "anvil",
      chain: foundry,
      transport: http(this.rpc),
    });
  }

  wallet(account = accounts[1]) {
    return createWalletClient({
      account,
      chain: foundry,
      transport: http(this.rpc),
    });
  }

  async command(name: string, args: string[]) {
    const backend = path.join(this.directory, "backend");
    const cli = path.resolve(scheduler, "node_modules/convex/bin/main.js");
    return await this.processes.run(
      name,
      ["bun", cli, ...args, "--env-file", path.join(backend, ".env.e2e")],
      backend
    );
  }

  async start() {
    const binary = path.resolve(
      process.env.E2E_CONVEX_BINARY ??
        path.join(root, ".cache/e2e/bin/convex-local-backend")
    );
    if (!(await Bun.file(binary).exists())) {
      throw new Error(
        "Missing Convex backend binary. See docs/testing/evaluation-e2e.md for setup."
      );
    }
    await this.processes.run(
      "worker-preflight",
      [
        this.python,
        "-c",
        "import torch, transformers, convex, web3; from jmac_worker.inference import LocalModelRunner; from pathlib import Path; import sys; LocalModelRunner(Path(sys.argv[1]), offline=True)",
        this.cache,
      ],
      workers
    );
    const rpcPort = await freePort();
    const apiPort = await freePort();
    const sitePort = await freePort();
    this.rpc = `http://127.0.0.1:${rpcPort}`;
    this.url = `http://127.0.0.1:${apiPort}`;
    this.site = `http://127.0.0.1:${sitePort}`;
    const secret = randomBytes(32).toString("hex");
    const generatedKey = await this.processes.run(
      "keygen",
      [
        binary,
        "keygen",
        "admin-key",
        "--instance-name",
        "jmac-e2e",
        "--instance-secret",
        secret,
      ],
      this.directory
    );
    this.adminKey = generatedKey.trim();
    await this.processes.start(
      "convex",
      [
        binary,
        "--interface",
        "127.0.0.1",
        "--port",
        String(apiPort),
        "--site-proxy-port",
        String(sitePort),
        "--instance-name",
        "jmac-e2e",
        "--instance-secret",
        secret,
        "--disable-beacon",
        "--local-storage",
        path.join(this.directory, "storage"),
        path.join(this.directory, "backend.sqlite3"),
      ],
      this.directory
    );
    await this.processes.start(
      "anvil",
      ["anvil", "--host", "127.0.0.1", "--port", String(rpcPort), "--silent"],
      this.directory
    );
    await waitFor(
      "local services",
      async () => {
        try {
          const response = await fetch(`${this.url}/version`, {
            signal: AbortSignal.timeout(2000),
          });
          return response.ok && (await this.chain.getChainId()) === foundry.id
            ? true
            : undefined;
        } catch {
          // The services have not finished binding their ports yet.
        }
      },
      this.processes
    );
    await this.processes.run(
      "forge-build",
      ["forge", "build"],
      path.join(root, "contracts")
    );
    const artifact = await Bun.file(
      path.join(root, "contracts/out/Evaluation.sol/Evaluation.json")
    ).json();
    const deploy = await this.wallet(accounts[0]).deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [accounts[0].address],
    });
    const receipt = await this.chain.waitForTransactionReceipt({
      hash: deploy,
    });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error("Contract deployment failed");
    }
    this.contract = receipt.contractAddress;
    const backend = path.join(this.directory, "backend");
    await mkdir(backend);
    await cp(
      path.join(root, "packages/backend/convex"),
      path.join(backend, "convex"),
      {
        recursive: true,
      }
    );
    await cp(
      path.join(root, "packages/backend/package.json"),
      path.join(backend, "package.json")
    );
    await symlink(
      path.join(root, "packages/backend/node_modules"),
      path.join(backend, "node_modules"),
      "dir"
    );
    await writeFile(
      path.join(backend, ".env.e2e"),
      `CONVEX_SELF_HOSTED_URL=${this.url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${this.adminKey}\n`,
      { mode: 0o600 }
    );
    for (const [name, value] of Object.entries({
      SITE_URL: this.site,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BACKEND_CONVEX_KEY: this.backendKey,
      CHAIN_ID: "31337",
      CONTRACT_ADDRESS: this.contract,
    })) {
      await this.command(`env-${name}`, ["env", "set", name, value]);
    }
    await this.command("deploy", ["dev", "--once", "--typecheck", "disable"]);
    const settings = JSON.parse(
      await this.processes.run(
        "settings",
        [
          this.python,
          "-c",
          "import json; from jmac_worker.specification import supported_settings; print(json.dumps(supported_settings()))",
        ],
        workers
      )
    );
    const modelOutput = await this.command("seed-model", [
      "run",
      "admin:addModel",
      JSON.stringify({
        name: settings.model,
        revision: settings.model_revision,
        settings: JSON.stringify(settings),
      }),
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
    ]);
    this.modelId = JSON.parse(modelOutput);
    this.creator = await this.signup("creator");
    for (const index of [2, 3]) {
      this.providers.push(await this.registerProvider(index));
    }
    // Observe the actual filter installation before funding any jobs.
    this.rpcProxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const body = await request.text();
        const rpcRequest = JSON.parse(body);
        if (rpcRequest.method === "eth_sendRawTransaction") {
          const raw = rpcRequest.params[0];
          const transaction = parseTransaction(raw);
          if (
            transaction.data?.startsWith(
              toFunctionSelector("commitResult(string,bytes32)")
            )
          ) {
            // Force both real workers to estimate/sign before either commit is
            // mined. The second mined commit needs extra gas for CommitComplete.
            this.pendingCommits.add(raw);
            await waitFor(
              "both workers' signed commits",
              async () => (this.pendingCommits.size === 2 ? true : undefined),
              this.processes,
              8000
            );
            this.concurrentCommitEstimates = true;
          }
        }
        const response = await fetch(this.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const result = await response.text();
        const decoded = JSON.parse(result);
        if (
          decoded.error ||
          (rpcRequest.method === "eth_getTransactionReceipt" &&
            decoded.result?.status === "0x0")
        ) {
          await appendFile(
            path.join(this.directory, "logs/rpc-errors.log"),
            `${JSON.stringify({
              method: rpcRequest.method,
              error: decoded.error,
              receipt: decoded.result,
            })}\n`,
            { mode: 0o600 }
          );
        }
        if (rpcRequest.method === "eth_newFilter" && decoded.result) {
          this.schedulerSubscribed = true;
        }
        return new Response(result, {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await this.processes.start("scheduler", ["bun", "index.ts"], scheduler, {
      ...process.env,
      CONVEX_URL: this.url,
      BACKEND_CONVEX_KEY: this.backendKey,
      CONTRACT_ADDRESS: this.contract,
      NET_URL: `http://127.0.0.1:${this.rpcProxy.port}`,
      BACKEND_WALLET_PRIVATE_KEY: accounts[0].getHdKey().privateKey
        ? `0x${Buffer.from(accounts[0].getHdKey().privateKey!).toString("hex")}`
        : "",
    });
    // Wait for the real scheduler to install its RPC event filter before funding.
    await waitFor(
      "scheduler event subscription",
      async () => (this.schedulerSubscribed ? true : undefined),
      this.processes
    );
  }

  async stop() {
    await this.processes.stop();
    await this.rpcProxy?.stop(true);
  }

  async signup(name: string): Promise<User> {
    const response = await fetch(`${this.site}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.site },
      body: JSON.stringify({
        name,
        email: `${name}@example.com`,
        password: "jmac-e2e-password-416",
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Sign-up failed (${response.status}): ${await response.text()}`
      );
    }
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const tokenResponse = await fetch(`${this.site}/api/auth/convex/token`, {
      headers: { Cookie: cookie },
    });
    const body = await tokenResponse.json();
    if (!tokenResponse.ok || typeof body.token !== "string") {
      throw new Error("Could not obtain a Convex auth token");
    }
    const client = new ConvexHttpClient(this.url);
    client.setAuth(body.token);
    return { client, token: body.token };
  }

  async registerProvider(index: number): Promise<Provider> {
    const user = await this.signup(`provider-${index}`);
    const account = accounts[index];
    const challenge = await user.client.mutation(
      api.provider.createWalletChallenge,
      { walletAddress: account.address }
    );
    if (!challenge.success || !challenge.message || !challenge.challengeId) {
      throw new Error("Provider wallet challenge failed");
    }
    const signature = await account.signMessage({ message: challenge.message });
    const registration = await user.client.mutation(api.provider.register, {
      challengeId: challenge.challengeId,
      signature,
    });
    if (
      !registration.success ||
      !registration.providerId ||
      !registration.secret
    ) {
      throw new Error("Provider registration failed");
    }
    const id = registration.providerId;
    await this.command(`approve-${index}`, [
      "run",
      "admin:approveProvider",
      JSON.stringify({ providerId: id }),
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
    ]);
    const capacity = await user.client.mutation(api.provider.setMaxJobs, {
      providerId: id,
      newMaxJobs: 1n,
    });
    const support = await user.client.mutation(api.provider.addModelSupport, {
      providerId: id,
      modelId: this.modelId,
    });
    if (!capacity.success || !support.success) {
      throw new Error("Provider setup failed");
    }
    const results = path.join(this.directory, `results-${index}`);
    await mkdir(results, { mode: 0o700 });
    return { ...user, id, secret: registration.secret, account, results };
  }

  async startWorkers() {
    for (const provider of this.providers) {
      const key = provider.account.getHdKey().privateKey;
      if (!key) {
        throw new Error("Missing Anvil test key");
      }
      await this.processes.start(
        provider.id,
        [
          this.python,
          path.join(scheduler, "e2e/trace_worker.py"),
          "--cache-dir",
          this.cache,
          "--offline",
          "--execute-jobs",
          "--commit-results",
        ],
        workers,
        {
          ...process.env,
          CONVEX_URL: this.url,
          CONVEX_HTTP_URL: this.site,
          PYTHONPATH: workers,
          E2E_WORKER_TRACE: path.join(
            this.directory,
            `logs/${provider.id}-settlement.log`
          ),
          JMAC_PROVIDER_ID: provider.id,
          JMAC_PROVIDER_SECRET: provider.secret,
          JMAC_MODEL_ID: this.modelId,
          JMAC_RESULTS_DIRECTORY: provider.results,
          JMAC_RPC_URL: `http://127.0.0.1:${this.rpcProxy!.port}`,
          JMAC_CHAIN_ID: "31337",
          JMAC_CONTRACT_ADDRESS: this.contract,
          JMAC_WALLET_ADDRESS: provider.account.address,
          JMAC_WALLET_PRIVATE_KEY: `0x${Buffer.from(key).toString("hex")}`,
          JMAC_HEARTBEAT_INTERVAL_SECONDS: "1",
        }
      );
    }
    await waitFor(
      "both workers ready",
      async () => {
        const ready = await Promise.all(
          this.providers.map(async (provider) => {
            const page = await provider.client.query(
              api.provider.getUserProviders,
              { paginationOpts: { numItems: 10, cursor: null } }
            );
            return page.page.some(
              (row) => row._id === provider.id && row.status === "ready"
            );
          })
        );
        return ready.every(Boolean) ? true : undefined;
      },
      this.processes
    );
  }
}

export async function createStack() {
  const parent = path.join(root, ".cache/e2e");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, "run-"));
  await writeFile(
    path.join(directory, "README.txt"),
    "Private disposable E2E state and logs. Delete this directory after debugging.\n",
    { mode: 0o600 }
  );
  return new Stack(directory);
}
