import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  benchmarks: defineTable({
    storageId: v.id("_storage"),
    ownerId: v.string(),
    ownerName: v.string(),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    contentHash: v.string(),
  })
    .index("by_ownerId_name_version", ["ownerId", "name", "version"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["ownerId", "version"],
      staged: false,
    }),

  models: defineTable({
    name: v.string(),
  }).searchIndex("search_name", {
    searchField: "name",
    staged: false,
  }),

  jobs: defineTable({
    creatorId: v.string(),
    benchmarkId: v.id("benchmarks"),
    modelId: v.id("models"),
    price: v.int64(),
    status: v.string(),
  }).index("by_creatorId", ["creatorId"]),

  providers: defineTable({
    userId: v.string(),
    secret: v.string(),
    walletAddress: v.string(),
    approved: v.boolean(),
    maxJobs: v.int64(),
    currentJobs: v.int64(),
    status: v.string(),
  }).index("by_userId", ["userId"]),
});
