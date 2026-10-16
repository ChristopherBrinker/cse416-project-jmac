import { v } from "convex/values";

import { query } from "./_generated/server";

export const getModels = query({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const models = args.name
      ? await ctx.db
          .query("models")
          .withSearchIndex("search_name", (q: any) =>
            q.search("name", args.name)
          )
          .take(20)
      : await ctx.db.query("models").take(20);
    return models;
  },
});
