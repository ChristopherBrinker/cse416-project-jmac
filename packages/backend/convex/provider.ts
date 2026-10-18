import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query, mutation } from "./_generated/server";

function generateSecret() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);

  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars[arr[i] % chars.length];
  }
  return result;
}

export const register = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }

    const addr = args.walletAddress;
    if (addr.length !== 42 || addr.slice(0, 2) !== "0x") {
      return { success: false, error: "Invalid wallet address" };
    }
    const addrChar = "0123456789ABCDEFabcdef";
    for (let i = 2; i < addr.length; i++) {
      if (!addrChar.includes(addr[i])) {
        return { success: false, error: "Invalid wallet address" };
      }
    }

    const existing = await ctx.db
      .query("providers")
      .withIndex("by_userId_approved", (q) =>
        q.eq("userId", identity.subject).eq("approved", false)
      )
      .first();
    if (existing) {
      return {
        success: false,
        error: "Cannot make more providers until existing ones are approved",
      };
    }

    const secret = generateSecret();

    const providerId = await ctx.db.insert("providers", {
      userId: identity.subject,
      secret,
      walletAddress: args.walletAddress,
      approved: false,
      maxJobs: 0n,
      currentJobs: 0n,
      status: "offline",
      lastHeartbeat: Date.now(),
    });
    return { success: true, providerId, secret };
  },
});

export const addModelSupport = mutation({
  args: { providerId: v.id("providers"), modelId: v.id("models") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider || provider.userId !== identity.subject) {
      return { success: false, error: "Provider not found" };
    }
    if (provider.status !== "offline") {
      return {
        success: false,
        error:
          "Set provider status to 'offline' before altering supported models",
      };
    }

    const model = await ctx.db.get("models", args.modelId);
    if (!model) {
      return { success: false, error: "Model not found" };
    }

    const existing = await ctx.db
      .query("model_support")
      .withIndex("by_providerId", (q) => q.eq("providerId", provider._id))
      .filter((q) => q.eq(q.field("modelId"), args.modelId))
      .unique();
    if (existing) {
      return {
        success: false,
        error: "Model already in supported list for this provider",
      };
    }

    await ctx.db.insert("model_support", {
      providerId: provider._id,
      modelId: model._id,
    });

    return { success: true };
  },
});

export const removeModelSupport = mutation({
  args: { providerId: v.id("providers"), modelId: v.id("models") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider || provider.userId !== identity.subject) {
      return { success: false, error: "Provider not found" };
    }

    if (provider.status !== "offline") {
      return {
        success: false,
        error:
          "Set provider status to 'offline' before altering supported models",
      };
    }

    const model = await ctx.db.get("models", args.modelId);
    if (!model) {
      return { success: false, error: "Model not found" };
    }

    const existing = await ctx.db
      .query("model_support")
      .withIndex("by_providerId", (q) => q.eq("providerId", provider._id))
      .filter((q) => q.eq(q.field("modelId"), args.modelId))
      .unique();
    if (!existing) {
      return {
        success: false,
        error: "No record that the provider supports this model",
      };
    }

    await ctx.db.delete("model_support", existing._id);

    return { success: true };
  },
});

export const setMaxJobs = mutation({
  args: { providerId: v.id("providers"), newMaxJobs: v.int64() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider || provider.userId !== identity.subject) {
      return { success: false, error: "Provider not found" };
    }

    if (provider.status !== "offline") {
      return {
        success: false,
        error: "Set provider status to 'offline' before changing max jobs",
      };
    }

    if (args.newMaxJobs < 0 || args.newMaxJobs > 20) {
      return {
        success: false,
        error: "Max jobs must be between 0 and 20, inclusive",
      };
    }

    await ctx.db.patch("providers", provider._id, { maxJobs: args.newMaxJobs });

    return { success: true };
  },
});

export const setStatus = mutation({
  args: {
    providerId: v.id("providers"),
    newStatus: v.string(),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const provider = await ctx.db.get("providers", args.providerId);

    if (!provider) {
      return { success: false, error: "Provider not found" };
    }

    if (!identity && !args.secret) {
      return { success: false, error: "Authentication required" };
    }

    if (
      (identity && provider.userId !== identity.subject) ||
      (args.secret && provider.secret !== args.secret)
    ) {
      return { success: false, error: "Invalid authentication" };
    }

    if (args.newStatus !== "ready" && args.newStatus !== "offline") {
      return {
        success: false,
        error: "Provided status is invalid. Must be 'ready' or 'offline'",
      };
    }

    await ctx.db.patch("providers", provider._id, { status: args.newStatus });

    return { success: true };
  },
});

export const heartbeat = mutation({
  args: { providerId: v.id("providers"), secret: v.string() },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get("providers", args.providerId);

    if (!provider) {
      return { success: false, error: "Provider not found" };
    }

    if (provider.secret !== args.secret) {
      return { success: false, error: "Invalid authentication" };
    }

    await ctx.db.patch("providers", provider._id, {
      lastHeartbeat: Date.now(),
    });

    return { success: true };
  },
});

export const getUserProviders = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    const providers = await ctx.db
      .query("providers")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .paginate(args.paginationOpts);

    const providers_with_models = await Promise.all(
      providers.page.map(async (p) => {
        const model_support = await ctx.db
          .query("model_support")
          .withIndex("by_providerId", (q) => q.eq("providerId", p._id))
          .collect();
        const models = model_support.map((m) => m.modelId);
        return { ...p, models };
      })
    );
    return { ...providers, page: providers_with_models };
  },
});
