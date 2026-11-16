// Note these are not actual production keys
process.env.BETTER_AUTH_SECRET = "1234";
process.env.SITE_URL = "http://localhost:7346";
process.env.BACKEND_CONVEX_KEY = "1234";
process.env.CHAIN_ID = "31337";
process.env.CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";

export const modules = import.meta.glob("../convex/**/*.ts");

if (!process.env.BACKEND_CONVEX_KEY) {
  throw new Error("Set BACKEND_CONVEX_KEY in .env.test");
}
export const BACKEND_CONVEX_KEY = process.env.BACKEND_CONVEX_KEY;

export const generateFakeIds = (t: any) =>
  t.run(async (ctx: any) => {
    const b = new Blob(["{}"], {
      type: "application/json",
    });
    const sId = await ctx.storage.store(b);
    const benchmarkId = await ctx.db.insert("benchmarks", {
      storageId: sId,
      ownerId: "",
      ownerName: "",
      name: "",
      description: "",
      version: "",
      itemCount: 0n,
      contentHash: "",
    });

    const modelId = await ctx.db.insert("models", {
      name: "",
      revision: "",
      settings: "",
    });

    const providerId = await ctx.db.insert("providers", {
      userId: "",
      secret: "",
      walletAddress: "",
      approved: true,
      maxJobs: 10n,
      currentJobs: 0n,
      status: "offline",
      lastHeartbeat: 0,
    });

    const jobId = await ctx.db.insert("jobs", {
      creatorId: "",
      benchmarkId,
      modelId,
      price: 0n,
      status: "funded",
      statusTime: 0,
    });

    await ctx.db.delete("benchmarks", benchmarkId);
    await ctx.db.delete("models", modelId);
    await ctx.db.delete("providers", providerId);
    await ctx.db.delete("jobs", jobId);

    return {
      fakeBenchmarkId: benchmarkId,
      fakeModelId: modelId,
      fakeProviderId: providerId,
      fakeJobId: jobId,
    };
  });
