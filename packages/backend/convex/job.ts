import { v } from "convex/values";

import { query, mutation } from "./_generated/server";

export const createJob = mutation({
  args: {
    benchmarkId: v.id("benchmarks"),
    modelId: v.id("models"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return { success: false, error: "Authentication required" };
    }

    if (!ctx.db.get("models", args.modelId)) {
      return { success: false, error: "Model not found" };
    }
    if (!ctx.db.get("benchmarks", args.benchmarkId)) {
      return { success: false, error: "Benchmark not found" };
    }

    // Currently, price is fixed at 2500 wei
    const price = 2500n;

    const jobId = await ctx.db.insert("jobs", {
      creatorId: identity.subject,
      benchmarkId: args.benchmarkId,
      modelId: args.modelId,
      price,
      status: "created",
    });

    return { success: true, jobId, price };
  },
});

export const getUserJobs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return [];
    }
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_creatorId", (q) => q.eq("creatorId", identity.subject))
      .order("desc")
      .collect();
    return jobs;
  },
});
