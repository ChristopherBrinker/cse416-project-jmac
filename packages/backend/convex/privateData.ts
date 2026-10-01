// Convex module names preserve the generated scaffold API.
/* oxlint-disable unicorn/filename-case */
import { query } from "./_generated/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Authentication required");
    }
    return {
      message: "This is private",
    };
  },
});
