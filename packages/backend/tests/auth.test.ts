import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "./setup-test";
import { valid_benchmark } from "./valid-benchmark";

/*
  Just tests that endpoints using Convex Auth do not succeed when
  called without an identity.
  User authorization, provider secret matching, or backend key matching
  are handled in their individual test suites
*/

describe("Endpoints using Convex Auth require it", () => {
  // First test using convex needs more time
  test("POST /benchmark/upload", async () => {
    const t = convexTest(schema, modules);

    const res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(valid_benchmark),
    });
    expect(res.status).toBe(401);
  }, 15_000);

  test("job.createJob", async () => {
    const t = convexTest(schema, modules);

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
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  // This endpoint does not fail, rather it returns page: [] regardless of params
  test("job.getUserJobs", async () => {
    const t = convexTest(schema, modules);
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
      expect(res.page).toHaveLength(0);
    });
  });

  test("provider.createWalletChallenge", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.provider.createWalletChallenge, {
      walletAddress: "",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Authentication required");
  }, 15_000);

  test("provider.register", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const challengeId = await ctx.db.insert("wallet_challenges", {
        userId: "",
        walletAddress: "",
        nonce: "",
        message: "",
        expiresAt: Date.now(),
        used: false,
      });

      const res = await t.mutation(api.provider.register, {
        challengeId,
        signature: "",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  test("provider.addModelSupport", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });
      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "offline",
        lastHeartbeat: 0,
      });

      const res = await t.mutation(api.provider.addModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  test("provider.removeModelSupport", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });
      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 10n,
        currentJobs: 1n,
        status: "offline",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.removeModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  test("provider.setMaxJobs", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";

      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 0n,
        currentJobs: 0n,
        status: "offline",
        lastHeartbeat: 0,
      });

      const res = await t.mutation(api.provider.setMaxJobs, {
        providerId,
        newMaxJobs: 10n,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  test("provider.setStatus", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "offline",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Authentication required");
    });
  });

  // This endpoint does not fail, rather it returns page: [] regardless of params
  test("provider.getUserProviders", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = "testuser";
      const providerSecret = "1234";

      const modelId = await ctx.db.insert("models", {
        name: "testModel",
        revision: "",
        settings: "",
      });

      const providerId = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: 0,
      });
      await ctx.db.insert("providers", {
        userId: "differentuser",
        secret: providerSecret,
        walletAddress: "",
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

      const res = await t.query(api.provider.getUserProviders, {
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      });
      expect(res.page).toHaveLength(0);
    });
  });
});
