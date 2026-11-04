import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

/*
  Administrator operations. These are internal functions, so they cannot be
  called from the browser; run them with deployment credentials, e.g.
    bunx convex run admin:addModel '{"name": "SmolLM2-135M-Instruct"}'
    bunx convex run admin:approveProvider '{"providerId": "<id>"}'
*/

export const addModel = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Model name must not be empty");
    }
    return await ctx.db.insert("models", { name });
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
