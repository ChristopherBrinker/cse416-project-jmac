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
    statusTime: v.number(),
    score: v.optional(v.number()),
  })
    .index("by_creatorId", ["creatorId"])
    .index("by_status_statusTime", ["status", "statusTime"]),

  job_assignments: defineTable({
    jobId: v.id("jobs"),
    providerId: v.id("providers"),
    modelId: v.id("models"),
    finished: v.boolean(),
  })
    .index("by_providerId_finished", ["providerId", "finished"])
    .index("by_jobId", ["jobId"])
    .index("by_jobId_providerId_finished", ["jobId", "providerId", "finished"]),

  providers: defineTable({
    userId: v.string(),
    secret: v.string(),
    walletAddress: v.string(),
    approved: v.boolean(),
    maxJobs: v.int64(),
    currentJobs: v.int64(),
    status: v.string(),
    lastHeartbeat: v.number(),
  })
    .index("by_userId_approved", ["userId", "approved"])
    .index("by_userId", ["userId"])
    .index("by_status_lastHeartbeat", ["status", "lastHeartbeat"]),

  model_support: defineTable({
    providerId: v.id("providers"),
    modelId: v.id("models"),
    available: v.boolean(),
  })
    .index("by_providerId", ["providerId"])
    .index("by_modelId_available", ["modelId", "available"]),
});
