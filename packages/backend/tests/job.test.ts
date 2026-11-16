import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { modules, generateFakeIds, BACKEND_CONVEX_KEY } from "./setup-test";
import { valid_benchmark } from "./valid-benchmark";

describe("createJob", () => {
  // First test using convex needs more time
  test("succeeds when benchmark and model are valid", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "testuser";

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const res = await t.mutation(api.job.createJob, {
        benchmarkId,
        modelId,
      });
      expect(res.success).toBe(true);
      expect(res.jobId).toBeDefined();
      const jobId = res.jobId as Id<"jobs">;
      const job = await ctx.db.get("jobs", jobId);
      expect(job).not.toBe(null);
      expect(job!.price).toBe(res.price);
    });
  }, 15_000);

  test("fails when benchmark or model do not exist", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    const { fakeModelId, fakeBenchmarkId } = await generateFakeIds(t);

    await t.run(async (ctx) => {
      const userId = "testuser";

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      // Model DNE
      let res = await t.mutation(api.job.createJob, {
        benchmarkId,
        modelId: fakeModelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Model not found");

      // Benchmark DNE
      res = await t.mutation(api.job.createJob, {
        benchmarkId: fakeBenchmarkId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Benchmark not found");
    });
  });
});

describe("getUserJobs", () => {
  test("gets job belonging to user but not job belonging to another", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "testuser";

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price: 0n,
        status: "created",
        statusTime: Date.now(),
      });

      await ctx.db.insert("jobs", {
        creatorId: "differentuser",
        benchmarkId,
        modelId,
        price: 0n,
        status: "created",
        statusTime: Date.now(),
      });

      const res = await t.query(api.job.getUserJobs, {
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      });
      expect(res.page).toHaveLength(1);
    });
  });
});

describe("assignProviders", () => {
  test("succeeds when input is valid, providers not near maxJobs", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      expect(res.providers).toHaveLength(2);
      const p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(1n);
      expect(res.spec).toEqual({
        contentHash: "hash",
        modelId,
        itemCount: BigInt(valid_benchmark.items.length),
      });
    });
  });

  test("succeeds when input is valid, provider about to reach maxJobs", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 9n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      expect(res.providers).toHaveLength(2);
      expect(res.spec).toEqual({
        contentHash: "hash",
        modelId,
        itemCount: BigInt(valid_benchmark.items.length),
      });
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("succeeds when input is valid, job already funded and retry is true", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: true,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      expect(res.providers).toHaveLength(2);
      expect(res.spec).toEqual({
        contentHash: "hash",
        modelId,
        itemCount: BigInt(valid_benchmark.items.length),
      });
    });
  });

  test("fails when key is incorrect", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: "wrongkey",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid key");
    });
  });

  test("fails when job does not exist", async () => {
    const t = convexTest(schema, modules);

    const { fakeJobId } = await generateFakeIds(t);
    const price = 2500n;
    const res = await t.mutation(api.job.assignProviders, {
      jobId: fakeJobId,
      price,
      jobFunded_tx: "",
      commitDeadline: 0,
      revealDeadline: 0,
      retry: false,
      creatorWallet: "differentwallet",
      backendKey: BACKEND_CONVEX_KEY,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Job not found");
  });

  test("fails when price is incorrect", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price: 1n,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Price does not match");
    });
  });

  test("fails when job already funded and retry is false", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Job already funded");
    });
  });

  test("fails when providers are unavailable", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "offline",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "disconnected",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Providers unavailable");
    });
  });

  test("fails when providers available but one belongs to job creator", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      // Same id as creator
      let res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Providers unavailable");

      // Same wallet as creator
      await ctx.db.patch("providers", providerId, { userId: "differentuser" });
      await ctx.db.patch("jobs", jobId, { status: "created" });
      res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "1234",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Providers unavailable");
    });
  });

  test("fails when providers available but both belong to the same user", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "created",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      // Same userIds
      let res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Providers unavailable");

      // Same wallets
      await ctx.db.patch("providers", providerId2, {
        userId: "differentuser2",
        walletAddress: "1234",
      });
      await ctx.db.patch("jobs", jobId, { status: "created" });
      res = await t.mutation(api.job.assignProviders, {
        jobId,
        price,
        jobFunded_tx: "",
        commitDeadline: 0,
        revealDeadline: 0,
        retry: false,
        creatorWallet: "differentwallet",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Providers unavailable");
    });
  });
});

describe("setStatus", () => {
  test("succeeds when setting to succeeded, one provider at maxJobs", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "ready",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const jaId = await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
      await ctx.db.insert("job_assignments", {
        jobId,
        providerId: providerId2,
        modelId,
        finished: false,
      });

      const res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "succeeded",
        score: 100,
        endStateA: "succeeded",
        endStateB: "succeeded",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      const j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("succeeded");
      expect(j?.score).toBe(100);
      expect(j?.jobComplete_tx).toBe("tx");
      const ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.finished).toBe(true);
      expect(ja?.endState).toBe("succeeded");
      const p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(9n);
      const ms = await ctx.db.get("model_support", msId);
      expect(ms?.available).toBe(true);
    });
  });

  test("succeeds when setting to failed, gets correct failure reason", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "ready",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const jaId = await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
      const jaId2 = await ctx.db.insert("job_assignments", {
        jobId,
        providerId: providerId2,
        modelId,
        finished: false,
      });

      // Assignment failed
      let res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "failed",
        endStateA: "assignment_failed",
        endStateB: "assignment_failed",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      let j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("failed");
      expect(j?.score).toBeUndefined();
      expect(j?.jobFailed_tx).toBe("tx");
      expect(j?.failureReason).toBe("Provider assignment failed");
      let ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.finished).toBe(true);
      expect(ja?.endState).toBe("assignment_failed");
      let ja2 = await ctx.db.get("job_assignments", jaId2);
      expect(ja2?.finished).toBe(true);
      expect(ja2?.endState).toBe("assignment_failed");
      const p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(9n);
      const ms = await ctx.db.get("model_support", msId);
      expect(ms?.available).toBe(true);

      // A provider timed out
      await ctx.db.patch("jobs", jobId, { status: "funded" });
      await ctx.db.patch("job_assignments", jaId, { finished: false });
      await ctx.db.patch("job_assignments", jaId2, { finished: false });
      res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "failed",
        endStateA: "submitted",
        endStateB: "commit_timeout",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      j = await ctx.db.get("jobs", jobId);
      expect(j?.failureReason).toBe("Timed out");
      ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.endState).toBe("submitted");
      ja2 = await ctx.db.get("job_assignments", jaId2);
      expect(ja2?.endState).toBe("commit_timeout");

      // Providers disagreed
      await ctx.db.patch("jobs", jobId, { status: "funded" });
      await ctx.db.patch("job_assignments", jaId, { finished: false });
      await ctx.db.patch("job_assignments", jaId2, { finished: false });
      res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "failed",
        endStateA: "disagreement",
        endStateB: "disagreement",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      j = await ctx.db.get("jobs", jobId);
      expect(j?.failureReason).toBe("Providers disagreed on results");
      ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.endState).toBe("disagreement");
      ja2 = await ctx.db.get("job_assignments", jaId2);
      expect(ja2?.endState).toBe("disagreement");
    });
  });

  test("fails when key is incorrect", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "succeeded",
        score: 100,
        endStateA: "succeeded",
        endStateB: "succeeded",
        tx: "tx",
        backendKey: "wrongkey",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid key");
    });
  });

  test("fails when new status is invalid", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const jaId = await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
      await ctx.db.insert("job_assignments", {
        jobId,
        providerId: providerId2,
        modelId,
        finished: false,
      });

      const res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "funded",
        score: 100,
        endStateA: "succeeded",
        endStateB: "succeeded",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Status can only be set to 'failed' or 'succeeded'"
      );
      const j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("funded");
      const ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.finished).toBe(false);
    });
  });

  test("fails when job does not exist", async () => {
    const t = convexTest(schema, modules);

    const { fakeJobId } = await generateFakeIds(t);

    const res = await t.mutation(api.job.setStatus, {
      jobId: fakeJobId,
      status: "succeeded",
      score: 100,
      endStateA: "succeeded",
      endStateB: "succeeded",
      tx: "tx",
      backendKey: BACKEND_CONVEX_KEY,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Job not found");
  });

  test("fails when job already in a final state", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "succeeded",
        score: 100,
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 9n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const jaId = await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: true,
        endState: "succeeded",
      });
      await ctx.db.insert("job_assignments", {
        jobId,
        providerId: providerId2,
        modelId,
        finished: true,
        endState: "succeeded",
      });

      const res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "failed",
        endStateA: "commit_timeout",
        endStateB: "submitted",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Job is already in a final state");
      const j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("succeeded");
      expect(j?.score).toBe(100);
      const ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.endState).toBe("succeeded");
      const p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(9n);
    });
  });

  test("fails when new status is succeeded and score is invalid", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "ready",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });
      await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const jaId = await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
      await ctx.db.insert("job_assignments", {
        jobId,
        providerId: providerId2,
        modelId,
        finished: false,
      });

      // Score negative
      let res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "succeeded",
        score: -1,
        endStateA: "succeeded",
        endStateB: "succeeded",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Invalid score (must be number between 0 and 100)"
      );
      let j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("funded");
      let ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.finished).toBe(false);
      let p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(10n);
      let ms = await ctx.db.get("model_support", msId);
      expect(ms?.available).toBe(false);

      // Score above 100
      res = await t.mutation(api.job.setStatus, {
        jobId,
        status: "succeeded",
        score: 100.1,
        endStateA: "succeeded",
        endStateB: "succeeded",
        tx: "tx",
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Invalid score (must be number between 0 and 100)"
      );
      j = await ctx.db.get("jobs", jobId);
      expect(j?.status).toBe("funded");
      ja = await ctx.db.get("job_assignments", jaId);
      expect(ja?.finished).toBe(false);
      p = await ctx.db.get("providers", providerId);
      expect(p?.currentJobs).toBe(10n);
      ms = await ctx.db.get("model_support", msId);
      expect(ms?.available).toBe(false);
    });
  });
});

describe("getJobsForProvider", () => {
  test("gets job assigned to provider but not any other", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "{}",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const jobId2 = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId: "differentuser2",
        secret: providerSecret,
        walletAddress: "12345",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
      await ctx.db.insert("job_assignments", {
        jobId: jobId2,
        providerId: providerId2,
        modelId,
        finished: false,
      });

      const res = await t.query(api.job.getJobsForProvider, {
        providerId,
        secret: providerSecret,
      });
      expect(res).toHaveLength(1);
      expect(res[0]?.providerId).toBe(providerId);
    });
  });

  test("gets only ongoing job assignments", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "{}",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      const jobId2 = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });
      const providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: true,
      });
      await ctx.db.insert("job_assignments", {
        jobId: jobId2,
        providerId,
        modelId,
        finished: false,
      });

      const res = await t.query(api.job.getJobsForProvider, {
        providerId,
        secret: providerSecret,
      });
      expect(res).toHaveLength(1);
      expect(res[0]?.jobId).toBe(jobId2);
    });
  });

  test("fails when secret is incorrect or provider does not exist", async () => {
    const t = convexTest(schema, modules);

    const { fakeProviderId } = await generateFakeIds(t);

    let providerId: Id<"providers">;
    await t.run(async (ctx) => {
      const userId = "testuser";
      const price = 2500n;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "{}",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      providerId = await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: "1234",
        walletAddress: "1234",
        approved: true,
        maxJobs: 10n,
        currentJobs: 10n,
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: false,
      });
    });

    await expect(async () => {
      await t.query(api.job.getJobsForProvider, {
        providerId,
        secret: "wrongsecret",
      });
    }).rejects.toThrow("Invalid provider or secret");

    await expect(async () => {
      await t.query(api.job.getJobsForProvider, {
        providerId: fakeProviderId,
        secret: "1234",
      });
    }).rejects.toThrow("Invalid provider or secret");
  });
});

describe("getTimedOutJobs", () => {
  test("gets only job with funded state that has timed out", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const price = 2500n;
      const timeout = 1000 * 60 * 10;

      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);
      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: userId,
        ownerName: userId,
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "hash",
      });

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "{}",
      });

      const jobId = await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now() - timeout * 2,
      });

      await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "funded",
        statusTime: Date.now(),
      });

      await ctx.db.insert("jobs", {
        creatorId: userId,
        benchmarkId,
        modelId,
        price,
        status: "failed",
        statusTime: Date.now() - timeout * 2,
      });

      const res = await t.query(api.job.getTimedOutJobs, {
        timeout,
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      expect(res.jobIds).toHaveLength(1);
      expect(res.jobIds![0]).toBe(jobId);
    });
  });

  test("fails when key is incorrect", async () => {
    const t = convexTest(schema, modules);

    const timeout = 1000 * 60 * 10;
    const res = await t.query(api.job.getTimedOutJobs, {
      timeout,
      backendKey: "wrongkey",
    });
    expect(res.success).toBe(false);
  });
});
