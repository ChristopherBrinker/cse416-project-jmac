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
    });
    return { success: true, providerId, secret };
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
      .withIndex("by_userId_approved", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .paginate(args.paginationOpts);
    return providers;
  },
});

export const getProvider = query({
  args: { id: v.id("providers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return null;
    }

    const provider = await ctx.db.get("providers", args.id);
    if (!provider || provider.userId !== identity.subject) {
      return null;
    }

    return provider;
  },
});
