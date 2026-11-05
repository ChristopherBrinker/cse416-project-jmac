import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { normalizeWalletAddress } from "./lib/wallet";

/*
  Administrator operations. These are internal functions, so they cannot be
  called from the browser; run them with deployment credentials, e.g.
    bunx convex run admin:addModel '{"name": "HuggingFaceTB/SmolLM2-135M-Instruct", "settings": "{\"model\": \"HuggingFaceTB/SmolLM2-135M-Instruct\", \"model_revision\": \"12fd25f77366fa6b3b4b768ec3050bf629380bac\", \"tokenizer_revision\": \"12fd25f77366fa6b3b4b768ec3050bf629380bac\", \"worker_sha256\": \"48601c4da741795b6c0b210698a4c593ffdf6fd1694d6744208eea375fbf325f\", \"method\": \"choice-index-log-likelihood-v1\", \"prompt_version\": \"multiple-choice-index-v1\", \"scoring\": \"ordered-choice-equality-v1\", \"device\": \"cpu\", \"dtype\": \"float32\",\"seed\": 0, \"threads\": 1, \"attention\": \"eager\", \"max_context_tokens\": 2048, \"max_seconds\": 300}"}'
      Note that worker_sha256 changes with modification to the workers.
      Currently, the worker includes the expected worker_sha256 as part of its output when receiving a job that mismatches
    bunx convex run admin:approveProvider '{"providerId": "<id>"}'
    bunx convex run admin:normalizeProviderWallets
*/

export const addModel = internalMutation({
  args: { name: v.string(), settings: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Model name must not be empty");
    }
    // Idempotent so the documented seed command can be rerun safely
    const existing = await ctx.db
      .query("models")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    return (
      existing?._id ??
      (await ctx.db.insert("models", { name, settings: args.settings }))
    );
  },
});

export const approveProvider = internalMutation({
  args: { providerId: v.id("providers") },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }
    if (provider.walletVerifiedAt === undefined) {
      throw new Error(
        "Provider wallet was never verified with a signed challenge; ask the owner to re-register"
      );
    }
    await ctx.db.patch("providers", provider._id, { approved: true });
    return null;
  },
});

const NORMALIZE_BATCH = 200;

/**
 * One-off migration: rewrite provider wallet addresses typed before signed
 * registration into checksummed form, so wallet uniqueness checks match
 * regardless of casing. Rerun until it reports done.
 */
export const normalizeProviderWallets = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("providers")
      .paginate({ cursor: args.cursor ?? null, numItems: NORMALIZE_BATCH });
    const changes = page.page.flatMap((provider) => {
      const normalized = normalizeWalletAddress(provider.walletAddress);
      return normalized && normalized !== provider.walletAddress
        ? [{ id: provider._id, walletAddress: normalized }]
        : [];
    });
    await Promise.all(
      changes.map(({ id, walletAddress }) =>
        ctx.db.patch("providers", id, { walletAddress })
      )
    );
    const updated = changes.length;
    return {
      updated,
      done: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
