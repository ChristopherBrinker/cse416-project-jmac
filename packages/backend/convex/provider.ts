import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  buildChallengeMessage,
  checkChallengeUsable,
  createNonce,
  normalizeWalletAddress,
  verifyChallengeSignature,
  WALLET_CHALLENGE_TTL_MS,
} from "./lib/wallet";

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

export const createWalletChallenge = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false as const, error: "Authentication required" };
    }
    const walletAddress = normalizeWalletAddress(args.walletAddress);
    if (!walletAddress) {
      return { success: false as const, error: "Invalid wallet address" };
    }

    // Only the newest challenge per account stays usable
    const previous = await ctx.db
      .query("wallet_challenges")
      .withIndex("by_userId_and_used", (q) =>
        q.eq("userId", identity.subject).eq("used", false)
      )
      .take(20);
    await Promise.all(
      previous.map((challenge) =>
        ctx.db.delete("wallet_challenges", challenge._id)
      )
    );

    const issuedAt = Date.now();
    const expiresAt = issuedAt + WALLET_CHALLENGE_TTL_MS;
    const nonce = createNonce();
    const message = buildChallengeMessage({
      userId: identity.subject,
      walletAddress,
      nonce,
      issuedAt,
      expiresAt,
    });
    const challengeId = await ctx.db.insert("wallet_challenges", {
      userId: identity.subject,
      walletAddress,
      nonce,
      message,
      expiresAt,
      used: false,
    });
    return { success: true as const, challengeId, message, expiresAt };
  },
});

const MAX_PENDING_PROVIDERS = 20;

/**
 * Stored addresses are checksummed, but legacy rows may be lowercase or
 * arbitrarily cased; `admin:normalizeProviderWallets` canonicalizes those.
 * Checking both common forms keeps uniqueness case-insensitive meanwhile.
 */
const isWalletRegistered = async (
  ctx: MutationCtx,
  checksummed: string
): Promise<boolean> => {
  const forms = [...new Set([checksummed, checksummed.toLowerCase()])];
  const matches = await Promise.all(
    forms.map((walletAddress) =>
      ctx.db
        .query("providers")
        .withIndex("by_walletAddress", (q) =>
          q.eq("walletAddress", walletAddress)
        )
        .first()
    )
  );
  return matches.some((match) => match !== null);
};

const removeProvider = async (
  ctx: MutationCtx,
  providerId: Id<"providers">
) => {
  const support = await ctx.db
    .query("model_support")
    .withIndex("by_providerId", (q) => q.eq("providerId", providerId))
    .take(MAX_PENDING_PROVIDERS);
  await Promise.all(
    support.map((row) => ctx.db.delete("model_support", row._id))
  );
  await ctx.db.delete("providers", providerId);
};

export const register = mutation({
  args: {
    challengeId: v.id("wallet_challenges"),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }

    const challenge = await ctx.db.get("wallet_challenges", args.challengeId);
    if (!challenge) {
      return { success: false, error: "Wallet challenge not found" };
    }
    const usable = checkChallengeUsable(
      challenge,
      identity.subject,
      Date.now()
    );
    if (!usable.ok) {
      return { success: false, error: usable.error };
    }
    // Consume the challenge before checking the signature so a failed or
    // replayed attempt can never reuse it.
    await ctx.db.patch("wallet_challenges", challenge._id, { used: true });
    const verified = await verifyChallengeSignature(challenge, args.signature);
    if (!verified.ok) {
      return { success: false, error: verified.error };
    }

    // Legacy providers registered with a typed, unverified address can never
    // be approved, so a signed registration replaces them instead of being
    // blocked by them (they have no assignments: they were never approved).
    const unapproved = await ctx.db
      .query("providers")
      .withIndex("by_userId_approved", (q) =>
        q.eq("userId", identity.subject).eq("approved", false)
      )
      .take(MAX_PENDING_PROVIDERS);
    const legacy = unapproved.filter(
      (provider) => provider.walletVerifiedAt === undefined
    );
    await Promise.all(
      legacy.map((provider) => removeProvider(ctx, provider._id))
    );

    if (await isWalletRegistered(ctx, challenge.walletAddress)) {
      return {
        success: false,
        error: "This wallet is already registered to a provider",
      };
    }

    if (unapproved.length > legacy.length) {
      return {
        success: false,
        error: "Cannot make more providers until existing ones are approved",
      };
    }

    const secret = generateSecret();
    const now = Date.now();
    const providerId = await ctx.db.insert("providers", {
      userId: identity.subject,
      secret,
      walletAddress: challenge.walletAddress,
      walletVerifiedAt: now,
      approved: false,
      maxJobs: 0n,
      currentJobs: 0n,
      status: "offline",
      lastHeartbeat: now,
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
      available: false,
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

    if (!provider.approved) {
      return {
        success: false,
        error: "Only approved providers can change status",
      };
    }

    if (args.newStatus !== "ready" && args.newStatus !== "offline") {
      return {
        success: false,
        error: "Provided status is invalid. Must be 'ready' or 'offline'",
      };
    }
    if (args.newStatus === "ready" && provider.maxJobs === 0n) {
      return {
        success: false,
        error:
          "Set max jobs to a positive value (between 1 and 20, inclusive) before setting status to 'ready'",
      };
    }
    if (args.newStatus === provider.status) {
      return { success: true };
    }

    await ctx.db.patch("providers", provider._id, { status: args.newStatus });

    const newAvailable =
      args.newStatus === "ready" && provider.currentJobs < provider.maxJobs;
    const model_support = await ctx.db
      .query("model_support")
      .withIndex("by_providerId", (q) => q.eq("providerId", provider._id))
      .collect();
    for (const ms of model_support) {
      await ctx.db.patch("model_support", ms._id, { available: newAvailable });
    }

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

    if (provider.status === "disconnected") {
      await ctx.db.patch("providers", provider._id, { status: "ready" });
      if (provider.currentJobs < provider.maxJobs) {
        const mss = await ctx.db
          .query("model_support")
          .withIndex("by_providerId", (q) => q.eq("providerId", provider._id))
          .collect();
        await Promise.all(
          mss.map(async (ms) => {
            await ctx.db.patch("model_support", ms._id, { available: true });
          })
        );
      }
    }

    return { success: true };
  },
});

export const checkHeartbeats = mutation({
  args: { backendKey: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }

    // 1 minute is the cutoff for hearbeat
    const heartbeatCutoff = Date.now() - 1000 * 60;

    const disconnected = await ctx.db
      .query("providers")
      .withIndex("by_status_lastHeartbeat", (q) =>
        q.eq("status", "ready").lt("lastHeartbeat", heartbeatCutoff)
      )
      .collect();

    await Promise.all(
      disconnected.map(async (p) => {
        await ctx.db.patch("providers", p._id, { status: "disconnected" });
        const mss = await ctx.db
          .query("model_support")
          .withIndex("by_providerId", (q) => q.eq("providerId", p._id))
          .collect();
        await Promise.all(
          mss.map(async (ms) => {
            await ctx.db.patch("model_support", ms._id, { available: false });
          })
        );
      })
    );

    return { success: true, modifiedCount: disconnected.length };
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
