import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "./setup-test";

const BACKEND_CONVEX_KEY = process.env.BACKEND_CONVEX_KEY;
if (!BACKEND_CONVEX_KEY) {
  throw new Error("Set BACKEND_CONVEX_KEY in .env.test");
}

describe("addModelSupport", () => {
  test("succeeds when provider and model are valid and support does not exist", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
      expect(res.success).toBe(true);

      const ms = await ctx.db.query("model_support").first();
      expect(ms).not.toBe(null);
    });
  });

  test("fails when provider does not belong to user", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "differentuser";
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
      expect(res.error).toBe("Provider not found");

      const ms = await ctx.db.query("model_support").first();
      expect(ms).toBe(null);
    });
  });

  test("fails when provider is not offline", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
        status: "ready",
        lastHeartbeat: 0,
      });

      let res = await t.mutation(api.provider.addModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before altering supported models"
      );
      let ms = await ctx.db.query("model_support").first();
      expect(ms).toBe(null);

      await ctx.db.patch("providers", providerId, { status: "disconnected" });
      res = await t.mutation(api.provider.addModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before altering supported models"
      );
      ms = await ctx.db.query("model_support").first();
      expect(ms).toBe(null);
    });
  });

  test("fails when provider already supports this model", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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

      const res = await t.mutation(api.provider.addModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Model already in supported list for this provider"
      );
      const ms = await ctx.db.query("model_support").collect();
      expect(ms).toHaveLength(1);
    });
  });
});

describe("removeModelSupport", () => {
  test("succeeds when provider and model are valid and support exists", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
      expect(res.success).toBe(true);

      const ms = await ctx.db.query("model_support").first();
      expect(ms).toBe(null);
    });
  });

  test("fails when provider does not belong to user", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "differentuser";
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
      expect(res.error).toBe("Provider not found");

      const ms = await ctx.db.query("model_support").first();
      expect(ms).not.toBe(null);
    });
  });

  test("fails when provider is not offline", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
        status: "ready",
        lastHeartbeat: 0,
      });

      await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      let res = await t.mutation(api.provider.removeModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before altering supported models"
      );
      let ms = await ctx.db.query("model_support").first();
      expect(ms).not.toBe(null);

      await ctx.db.patch("providers", providerId, { status: "disconnected" });
      res = await t.mutation(api.provider.removeModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before altering supported models"
      );
      ms = await ctx.db.query("model_support").first();
      expect(ms).not.toBe(null);
    });
  });

  test("fails when provider does not already support this model", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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

      const res = await t.mutation(api.provider.removeModelSupport, {
        providerId,
        modelId,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("No record that the provider supports this model");
    });
  });
});

describe("setMaxJobs", () => {
  test("succeeds when provider and newMaxJobs are valid", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
      expect(res.success).toBe(true);
      const p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(10n);
    });
  });

  test("fails when provider does not belong to user", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "differentuser";
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
      expect(res.error).toBe("Provider not found");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(0n);
    });
  });

  test("fails when provider is not offline", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
        status: "ready",
        lastHeartbeat: 0,
      });

      let res = await t.mutation(api.provider.setMaxJobs, {
        providerId,
        newMaxJobs: 10n,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before changing max jobs"
      );
      let p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(0n);

      await ctx.db.patch("providers", providerId, { status: "disconnected" });
      res = await t.mutation(api.provider.setMaxJobs, {
        providerId,
        newMaxJobs: 10n,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set provider status to 'offline' before changing max jobs"
      );
      p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(0n);
    });
  });

  test("fails when newMaxJobs is invalid", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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

      let res = await t.mutation(api.provider.setMaxJobs, {
        providerId,
        newMaxJobs: -1n,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Max jobs must be between 0 and 20, inclusive");
      let p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(0n);

      res = await t.mutation(api.provider.setMaxJobs, {
        providerId,
        newMaxJobs: 21n,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Max jobs must be between 0 and 20, inclusive");
      p = await ctx.db.get("providers", providerId);
      expect(p!.maxJobs).toBe(0n);
    });
  });
});

describe("setStatus", () => {
  test("succeeds when provider and newStatus are valid and maxJobs is nonzero (using convex auth)", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      let res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
      });
      expect(res.success).toBe(true);
      let p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      let ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);

      res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "offline",
      });
      expect(res.success).toBe(true);
      p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("succeeds when provider and newStatus are valid and maxJobs is nonzero (using secret)", async () => {
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      let res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
        secret: providerSecret,
      });
      expect(res.success).toBe(true);
      let p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      let ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);

      res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "offline",
        secret: providerSecret,
      });
      expect(res.success).toBe(true);
      p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("fails when provider secret is incorrect", async () => {
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
        secret: "wrongsecret",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid authentication");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("fails when provider does not belong to user", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
    await t.run(async (ctx) => {
      const userId = "differentuser";
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid authentication");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("fails when provider is not approved", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
        approved: false,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "offline",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Only approved providers can change status");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("fails when setting to ready when maxJobs is 0", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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
        maxJobs: 0n,
        currentJobs: 0n,
        status: "offline",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "ready",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Set max jobs to a positive value (between 1 and 20, inclusive) before setting status to 'ready'"
      );
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("fails when new status is invalid", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.setStatus, {
        providerId,
        newStatus: "invalid",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Provided status is invalid. Must be 'ready' or 'offline'"
      );
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });
});

describe("heartbeat", () => {
  test("succeeds when secret valid and status ready/offline (and does not change state)", async () => {
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

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });

      let res = await t.mutation(api.provider.heartbeat, {
        providerId,
        secret: providerSecret,
      });
      expect(res.success).toBe(true);
      let p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      let ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);

      await ctx.db.patch("providers", providerId, { status: "offline" });
      await ctx.db.patch("model_support", msId, { available: false });
      res = await t.mutation(api.provider.heartbeat, {
        providerId,
        secret: providerSecret,
      });
      expect(res.success).toBe(true);
      p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("offline");
      ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });

  test("succeeds when secret valid and status disconnected", async () => {
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
        status: "disconnected",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.heartbeat, {
        providerId,
        secret: providerSecret,
      });
      expect(res.success).toBe(true);
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);
    });
  });

  test("fails when secret is incorrect", async () => {
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
        status: "disconnected",
        lastHeartbeat: 0,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: false,
      });

      const res = await t.mutation(api.provider.heartbeat, {
        providerId,
        secret: "wrongsecret",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid authentication");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("disconnected");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(false);
    });
  });
});

describe("checkHeartbeats", () => {
  test("succeeds when key valid and one of two providers has timed out", async () => {
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
        lastHeartbeat: Date.now(),
      });
      const providerId2 = await ctx.db.insert("providers", {
        userId,
        secret: providerSecret,
        walletAddress: "",
        approved: true,
        maxJobs: 10n,
        currentJobs: 0n,
        status: "ready",
        lastHeartbeat: Date.now() - 1000 * 60 * 2,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });
      const msId2 = await ctx.db.insert("model_support", {
        providerId: providerId2,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.provider.checkHeartbeats, {
        backendKey: BACKEND_CONVEX_KEY,
      });
      expect(res.success).toBe(true);
      expect(res.modifiedCount).toBe(1);
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);
      const p2 = await ctx.db.get("providers", providerId2);
      expect(p2!.status).toBe("disconnected");
      const ms2 = await ctx.db.get("model_support", msId2);
      expect(ms2!.available).toBe(false);
    });
  });

  test("fails when key is incorrect", async () => {
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
        lastHeartbeat: Date.now() - 1000 * 60 * 2,
      });

      const msId = await ctx.db.insert("model_support", {
        providerId,
        modelId,
        available: true,
      });

      const res = await t.mutation(api.provider.checkHeartbeats, {
        backendKey: "wrongkey",
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid key");
      const p = await ctx.db.get("providers", providerId);
      expect(p!.status).toBe("ready");
      const ms = await ctx.db.get("model_support", msId);
      expect(ms!.available).toBe(true);
    });
  });
});

describe("getUserProviders", () => {
  test("gets provider belonging to user but not provider belonging to another", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "testuser",
    });

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
      expect(res.page).toHaveLength(1);
      expect(res.page[0]!.models).toEqual([modelId]);
    });
  });
});
