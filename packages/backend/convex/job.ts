import { paginationOptsValidator } from "convex/server";
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

    if (!(await ctx.db.get("models", args.modelId))) {
      return { success: false, error: "Model not found" };
    }
    if (!(await ctx.db.get("benchmarks", args.benchmarkId))) {
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
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_creatorId", (q) => q.eq("creatorId", identity.subject))
      .order("desc")
      .paginate(args.paginationOpts);
    return jobs;
  },
});

export const assignProviders = mutation({
  args: { jobId: v.id("jobs"), price: v.int64(), backendKey: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }

    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) {
      return { success: false, error: "Job not found" };
    }
    if (job.price !== args.price) {
      return { success: false, error: "Price does not match" };
    }

    if (job.status !== "created") {
      return { success: false, error: "Job already funded" };
    }
    /* Mutation can return success: false without reverting this.
      When implemented, scheduler will after some time use this as an indicator of failure*/
    await ctx.db.patch("jobs", job._id, { status: "funded" });

    // This will be turned into a sensible algorithm later
    const model_support = await ctx.db
      .query("model_support")
      .withIndex("by_modelId_available", (q) =>
        q.eq("modelId", job.modelId).eq("available", true)
      )
      .take(2);

    if (model_support.length !== 2) {
      return { success: false, error: "Providers unavailable" };
    }

    const providers = await Promise.all(
      model_support.map(async (ms) => {
        const p = await ctx.db.get("providers", ms.providerId);
        return p!;
      })
    );
    for (const p of providers) {
      await ctx.db.patch("providers", p._id, {
        currentJobs: p.currentJobs + 1n,
      });
      if (p.currentJobs + 1n === p.maxJobs) {
        const mss = await ctx.db
          .query("model_support")
          .withIndex("by_providerId", (q) => q.eq("providerId", p._id))
          .collect();
        for (const ms of mss) {
          await ctx.db.patch("model_support", ms._id, { available: false });
        }
      }
      await ctx.db.insert("job_assignments", {
        jobId: job._id,
        providerId: p._id,
        finished: false,
      });
    }
    return { success: true, providers };
  },
});

export const setStatus = mutation({
  args: { jobId: v.id("jobs"), status: v.string(), backendKey: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }

    if (args.status !== "failure" && args.status !== "success") {
      return {
        success: false,
        error: "Status can only be set to 'failure' or 'success'",
      };
    }

    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) {
      return { success: false, error: "Job not found" };
    }

    if (job.status === "failure" || job.status === "success") {
      return {
        success: false,
        error: "Job is already in a final state",
      };
    }

    await ctx.db.patch("jobs", job._id, { status: args.status });

    const job_assignments = await ctx.db
      .query("job_assignments")
      .withIndex("by_jobId", (q) => q.eq("jobId", job._id))
      .filter((q) => q.eq(q.field("finished"), false))
      .collect();
    for (const ja of job_assignments) {
      await ctx.db.patch("job_assignments", ja._id, { finished: true });

      const p = (await ctx.db.get("providers", ja.providerId))!;
      await ctx.db.patch("providers", p._id, {
        currentJobs: p.currentJobs - 1n,
      });
      if (p.currentJobs === p.maxJobs && p.status === "ready") {
        const model_support = await ctx.db
          .query("model_support")
          .withIndex("by_providerId", (q) => q.eq("providerId", p._id))
          .collect();
        for (const ms of model_support) {
          await ctx.db.patch("model_support", ms._id, { available: true });
        }
      }
    }

    return { success: true };
  },
});

export const getJobsForProvider = query({
  args: { providerId: v.id("providers"), secret: v.string() },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider || provider.secret !== args.secret) {
      throw new Error("Invalid provider or secret");
    }

    const job_assignments = await ctx.db
      .query("job_assignments")
      .withIndex("by_providerId_finished", (q) =>
        q.eq("providerId", provider._id).eq("finished", false)
      )
      .collect();
    return job_assignments;
  },
});
