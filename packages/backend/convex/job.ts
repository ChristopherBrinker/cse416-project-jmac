import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
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
    const benchmark = await ctx.db.get("benchmarks", args.benchmarkId);
    if (!benchmark) {
      return { success: false, error: "Benchmark not found" };
    }
    // Assignment records the item count on-chain; refuse before the creator can fund.
    if (!benchmark.itemCount) {
      return {
        success: false,
        error: "Benchmark has no recorded item count; re-upload it",
      };
    }

    // Currently, price is fixed at 2500 wei
    const price = 2500n;

    const jobId = await ctx.db.insert("jobs", {
      creatorId: identity.subject,
      benchmarkId: args.benchmarkId,
      modelId: args.modelId,
      price,
      status: "created",
      statusTime: Date.now(),
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
  args: {
    jobId: v.id("jobs"),
    price: v.int64(),
    jobFunded_tx: v.string(),
    retry: v.boolean(),
    // Funding wallet read from the contract; the contract rejects it as a provider.
    creatorWallet: v.string(),
    backendKey: v.string(),
  },
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

    if (job.status !== (args.retry ? "funded" : "created")) {
      return { success: false, error: "Job already funded" };
    }
    /* Mutation can return success: false without reverting this.
      When implemented, scheduler will after some time use this as an indicator of failure*/
    await ctx.db.patch("jobs", job._id, {
      status: "funded",
      statusTime: Date.now(),
      jobFunded_tx: args.jobFunded_tx,
    });

    const benchmark = await ctx.db.get("benchmarks", job.benchmarkId);
    if (!benchmark?.itemCount) {
      return {
        success: false,
        error: "Benchmark has no recorded item count; re-upload it",
      };
    }

    const candidates = ctx.db
      .query("model_support")
      .withIndex("by_modelId_available", (q) =>
        q.eq("modelId", job.modelId).eq("available", true)
      );

    // Approval means a platform administrator set `approved` in the Convex dashboard (no app
    // mutation grants it, so providers cannot approve themselves). The job
    // creator never evaluates their own job, and two providers registered by the same user
    // or sharing a wallet are never paired, so one account cannot supply both results.
    // Candidates are read lazily until two eligible providers are found, so ineligible
    // rows never hide eligible ones behind a fixed limit.
    const creatorWallet = args.creatorWallet.toLowerCase();
    const providers: Doc<"providers">[] = [];
    for await (const ms of candidates) {
      const p = await ctx.db.get("providers", ms.providerId);
      const independent =
        p !== null &&
        p.approved &&
        p.userId !== job.creatorId &&
        p.walletAddress.toLowerCase() !== creatorWallet &&
        !providers.some(
          (chosen) =>
            chosen.userId === p.userId ||
            chosen.walletAddress.toLowerCase() === p.walletAddress.toLowerCase()
        );
      if (independent) {
        providers.push(p);
      }
      if (providers.length === 2) {
        break;
      }
    }

    if (providers.length !== 2) {
      return { success: false, error: "Providers unavailable" };
    }

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
        modelId: job.modelId,
        finished: false,
      });
    }
    // The scheduler records keccak256(abi.encode(contentHash, modelId)) and itemCount
    // on-chain, so the evaluated benchmark bytes and model are fixed for the whole job.
    return {
      success: true,
      providers,
      spec: {
        contentHash: benchmark.contentHash,
        modelId: job.modelId,
        itemCount: benchmark.itemCount,
      },
    };
  },
});

export const setStatus = mutation({
  args: {
    jobId: v.id("jobs"),
    status: v.string(),
    score: v.optional(v.number()),
    endStateA: v.optional(v.string()),
    endStateB: v.optional(v.string()),
    tx: v.optional(v.string()),
    backendKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }

    if (args.status !== "failed" && args.status !== "succeeded") {
      return {
        success: false,
        error: "Status can only be set to 'failed' or 'succeeded'",
      };
    }

    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) {
      return { success: false, error: "Job not found" };
    }

    if (job.status === "failed" || job.status === "succeeded") {
      return {
        success: false,
        error: "Job is already in a final state",
      };
    }

    if (args.status === "failed") {
      let failureReason: string | undefined;
      if (args.endStateA === "disagreement") {
        failureReason = "Providers disagreed on results";
      } else if (args.endStateA === "assignment_failed") {
        failureReason = "Provider assignment failed";
      } else if (args.endStateA !== undefined) {
        failureReason = "Timed out";
      }
      await ctx.db.patch("jobs", job._id, {
        status: args.status,
        statusTime: Date.now(),
        jobFailed_tx: args.tx,
        failureReason,
      });
    } else if (args.status === "succeeded") {
      if (
        args.score === undefined ||
        !Number.isFinite(args.score) ||
        args.score < 0 ||
        args.score > 100
      ) {
        return {
          success: false,
          error: "Invalid score (must be number between 0 and 100)",
        };
      }

      await ctx.db.patch("jobs", job._id, {
        status: args.status,
        statusTime: Date.now(),
        score: args.score,
        jobComplete_tx: args.tx,
      });
    }

    const job_assignments = await ctx.db
      .query("job_assignments")
      .withIndex("by_jobId", (q) => q.eq("jobId", job._id))
      .filter((q) => q.eq(q.field("finished"), false))
      .collect();

    const endStates = [args.endStateA, args.endStateB];

    for (let i = 0; i < Math.min(2, job_assignments.length); i++) {
      const ja = job_assignments[i];
      await ctx.db.patch("job_assignments", ja._id, {
        finished: true,
        endState: endStates[i],
      });

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

export const getTimedOutJobs = query({
  args: { backendKey: v.string(), timeout: v.number() },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }

    const jobTimeout = Date.now() - args.timeout;

    const timedOutJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status_statusTime", (q) =>
        q.eq("status", "funded").lt("statusTime", jobTimeout)
      )
      .collect();

    const jobIds = timedOutJobs.map((j) => j._id);

    return { success: true, jobIds };
  },
});

/*export const setTx = mutation({
  args: { jobId: v.id("jobs"), tx_hash: v.string(), tx_type: v.string(), backendKey: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.BACKEND_CONVEX_KEY) {
      throw new Error("BACKEND_CONVEX_KEY not set in convex");
    }
    if (args.backendKey !== process.env.BACKEND_CONVEX_KEY) {
      return { success: false, error: "Invalid key" };
    }
    
    const valid_tx_types = ["jobFunded", "jobFailed", "jobComplete"];

    if (!valid_tx_types.includes(args.tx_type)) {
      return {
        success: false,
        error: "Invalid tx type. Must be 'jobFunded', 'jobFailed', or 'jobComplete'",
      };
    }

    const tx_field = args.tx_type + "_tx";

    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) {
      return { success: false, error: "Job not found" };
    }

    await ctx.db.patch("jobs", job._id, {[tx_field]: args.tx_hash});
  }
})*/
