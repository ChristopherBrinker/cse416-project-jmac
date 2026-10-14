import { v, ConvexError } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, query, httpAction } from "./_generated/server";

const validateBenchmark = (
  benchmark: any
): { success: boolean; msg: string } => {
  try {
    if (benchmark.schema_version !== "1.0.0") {
      return { success: false, msg: "Must have schema_version 1.0.0" };
    }
    if (typeof benchmark.name !== "string" || benchmark.name.length === 0) {
      return { success: false, msg: "name must be a non-empty string" };
    }
    if (typeof benchmark.description !== "string") {
      return { success: false, msg: "description must be a string" };
    }
    if (typeof benchmark.version !== "string") {
      return { success: false, msg: "version must be a string" };
    }

    const items = benchmark.items;
    if (!items || !(items.length > 0)) {
      return { success: false, msg: "items must be a non-empty array" };
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item.item_id !== "string" || item.item_id.length === 0) {
        return {
          success: false,
          msg: `items[${i}].item_id must be a non-empty string`,
        };
      }
      if (typeof item.prompt !== "string" || item.prompt.length === 0) {
        return {
          success: false,
          msg: `items[${i}].prompt must be a non-empty string`,
        };
      }

      const choices = item.choices;
      if (!choices || !(choices.length > 0)) {
        return {
          success: false,
          msg: `items[${i}].choices must be a non-empty array`,
        };
      }

      const answer = item.correct_choice;
      if (
        typeof answer !== "number" ||
        Math.trunc(answer) !== answer ||
        answer < 0 ||
        answer >= choices.length
      ) {
        return {
          success: false,
          msg: `items[${i}].correct_choice must be an integer between 0 and items[${i}].choices.length - 1`,
        };
      }

      for (let j = 0; j < choices.length; j++) {
        const choice = choices[j];
        if (typeof choice !== "string" || choice.length === 0) {
          return {
            success: false,
            msg: `items[${i}].choices[${j}] must be a non-empty string`,
          };
        }
      }
    }

    return { success: true, msg: "" };
  } catch {
    return { success: false, msg: "Unknown error" };
  }
};

export const uploadBenchmark = httpAction(async (ctx, request) => {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("Set SITE_URL on the Convex deployment");
  }

  const user = await ctx.auth.getUserIdentity();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  }

  const blob = await request.blob();
  const benchmarkStr = await blob.slice().text();

  if (blob.size === 0) {
    return new Response(JSON.stringify({ error: "Upload a non-empty file" }), {
      status: 400,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  }

  let benchmark;
  try {
    benchmark = JSON.parse(benchmarkStr);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  }

  const valid = validateBenchmark(benchmark);
  if (!valid.success) {
    return new Response(JSON.stringify({ error: valid.msg }), {
      status: 400,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  }

  const ownerId = user.subject;
  // name is required by betterauth, so always defined
  const ownerName = user.name!;
  const name = String(benchmark.name);
  const description = String(benchmark.description);
  const version = String(benchmark.version);

  const strUint8 = new TextEncoder().encode(benchmarkStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", strUint8);
  const hashArray = [...new Uint8Array(hashBuffer)];
  const contentHash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  let storageId;
  try {
    storageId = await ctx.storage.store(blob);
    const benchmarkId = await ctx.runMutation(
      internal.benchmark.createBenchmarkEntry,
      {
        storageId,
        ownerId,
        ownerName,
        name,
        description,
        version,
        contentHash,
      }
    );

    return new Response(JSON.stringify({ benchmarkId }), {
      status: 200,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  } catch (error) {
    const b = { error: "Unknown error" };
    let status = 500;
    if (error instanceof ConvexError && error.data && error.data.error) {
      b.error = error.data.error;
      status = 400;
    } else {
      console.log(error);
    }

    if (storageId) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        /* */
      }
    }

    return new Response(JSON.stringify(b), {
      status,
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        Vary: "origin",
      }),
    });
  }
});

export const createBenchmarkEntry = internalMutation({
  args: {
    storageId: v.id("_storage"),
    ownerId: v.string(),
    ownerName: v.string(),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("benchmarks")
      .withIndex("by_ownerId_name_version", (q) =>
        q
          .eq("ownerId", args.ownerId)
          .eq("name", args.name)
          .eq("version", args.version)
      )
      .first();
    if (existing) {
      throw new ConvexError({
        error:
          "A benchmark with this name and version already exists for this user",
      });
    }

    return await ctx.db.insert("benchmarks", args);
  },
});

export const getBenchmarks = query({
  args: {
    name: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // any unavoidable here - intermediate queries have different types
    let quer: any = ctx.db.query("benchmarks");
    if (args.name) {
      quer = quer.withSearchIndex("search_name", (q: any) =>
        q.search("name", args.name)
      );
    }
    if (args.ownerName) {
      quer = quer.filter((q: any) =>
        q.eq(q.field("ownerName"), args.ownerName)
      );
    }
    if (args.version) {
      quer = quer.filter((q: any) => q.eq(q.field("version"), args.version));
    }

    const benchmarks = await quer.take(20);
    const result = [];
    for (const b of benchmarks) {
      result.push({
        _id: b._id,
        ownerName: b.ownerName,
        name: b.name,
        description: b.description,
        version: b.version,
        contentHash: b.contentHash,
      });
    }
    return result;
  },
});
