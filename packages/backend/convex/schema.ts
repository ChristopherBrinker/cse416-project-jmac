import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  benchmarks: defineTable({
    storageId: v.string(),
    ownerId: v.string(),
    ownerName: v.string(),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    contentHash: v.string(),
  })
    .index("by_ownerId_name_version", ["ownerId", "name", "version"])
    .index("by_ownerName", ["ownerName"])
    .index("by_version", ["version"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["ownerId", "version"],
      staged: false,
    }),
});
