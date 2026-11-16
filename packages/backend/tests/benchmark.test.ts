import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../convex/_generated/api";
import { validateBenchmark, benchmarkLimits } from "../convex/benchmark";
import schema from "../convex/schema";
import { modules, generateFakeIds } from "./setup-test";
import { valid_benchmark } from "./valid-benchmark";

describe("validateBenchmark", () => {
  test("accepts valid benchmark", () => {
    const v = validateBenchmark(valid_benchmark);
    expect(v.success).toBe(true);
  });

  test("rejects invalid schema_version", () => {
    const b = structuredClone(valid_benchmark);
    b.schema_version = "2.0.0";
    const v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("schema_version");
  });

  test("rejects empty name", () => {
    const b = structuredClone(valid_benchmark);
    b.name = "";
    const v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("name");
  });

  test("rejects non-array or empty items", () => {
    const b = structuredClone(valid_benchmark);

    b.items = { length: 2, 0: b.items[0], 1: b.items[1] };
    let v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("items");

    b.items = [];
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("items");
  });

  test("rejects empty or duplicate items[i].item_id", () => {
    const b = structuredClone(valid_benchmark);

    b.items[0].item_id = "";
    let v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("item_id");

    b.items[0].item_id = "1";
    b.items[1].item_id = "1";
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("item_id");
  });

  test("rejects empty items[i].prompt", () => {
    const b = structuredClone(valid_benchmark);
    b.items[0].prompt = "";
    const v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("prompt");
  });

  test("rejects non-array or empty items[i].choices", () => {
    const b = structuredClone(valid_benchmark);

    b.items[0].choices = {
      length: 2,
      0: "choice1",
      1: "choice2",
      2: "choice3",
    };
    let v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("choices");

    b.items[0].choices = [];
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("choices");
  });

  test("rejects empty items[i].choices[j]", () => {
    const b = structuredClone(valid_benchmark);

    b.items[0].choices[1] = "";
    const v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("choices[1]");
  });

  test("rejects invalid items[i].correct_choice", () => {
    const b = structuredClone(valid_benchmark);

    b.items[0].correct_choice = -1;
    let v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("correct_choice");

    b.items[0].correct_choice = 3;
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("correct_choice");
  });

  test("rejects benchmarks exceeding limits", () => {
    let b = structuredClone(valid_benchmark);
    b.items = Array.from({ length: benchmarkLimits.MAX_ITEMS + 1 }, () => ({}));
    let v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("limit");

    b = structuredClone(valid_benchmark);
    b.items[0].prompt = "x".repeat(benchmarkLimits.MAX_PROMPT + 1);
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("limit");

    b = structuredClone(valid_benchmark);
    b.items[0].choices = Array.from(
      { length: benchmarkLimits.MAX_CHOICES + 1 },
      () => "c"
    );
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("limit");

    b = structuredClone(valid_benchmark);
    b.items[0].choices[0] = "x".repeat(benchmarkLimits.MAX_CHOICE + 1);
    v = validateBenchmark(b);
    expect(v.success).toBe(false);
    expect(v.msg).toContain("limit");
  });
});

describe("uploadBenchmark", () => {
  // First test using convex needs more time
  test("accepts valid benchmark", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "test" });
    const res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(valid_benchmark),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.benchmarkId).toBeDefined();
  }, 15_000);

  test("rejects invalid JSON", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "test" });
    const res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "test",
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("rejects invalid benchmark", async () => {
    const b = structuredClone(valid_benchmark);
    b.name = "";
    const t = convexTest(schema, modules).withIdentity({ name: "test" });
    const res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(b),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("reject body exceeding size limit", async () => {
    const b = structuredClone(valid_benchmark);
    b.name = "x".repeat(benchmarkLimits.MAX_BYTES);
    const t = convexTest(schema, modules).withIdentity({ name: "test" });
    const res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(b),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("rejects benchmark with same name, owner, and version", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "test" });
    let res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(valid_benchmark),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);

    res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(valid_benchmark),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("accepts benchmark with same name and owner but different version", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "test" });

    let res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(valid_benchmark),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);

    const b = structuredClone(valid_benchmark);
    b.version = "1.1";
    res = await t.fetch("/benchmark/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(b),
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);
  });
});

const setupGetBenchmarkFile = async (settings: {
  jobAssignmentDNE?: boolean;
  jobAssignmentFinished?: boolean;
}) => {
  const t = convexTest(schema, modules);
  const testData = await t.run(async (ctx) => {
    const b = new Blob([JSON.stringify(valid_benchmark)], {
      type: "application/json",
    });
    const sId = await ctx.storage.store(b);

    const benchmarkId = await ctx.db.insert("benchmarks", {
      storageId: sId,
      ownerId: "testuser",
      ownerName: "testuser",
      name: valid_benchmark.name,
      description: valid_benchmark.description,
      version: valid_benchmark.version,
      itemCount: BigInt(valid_benchmark.items.length),
      contentHash: "",
    });

    const modelId = await ctx.db.insert("models", {
      name: "testModel",
      revision: "",
      settings: "",
    });

    const providerSecret = "1234";
    const providerId = await ctx.db.insert("providers", {
      userId: "",
      secret: providerSecret,
      walletAddress: "",
      approved: true,
      maxJobs: 10n,
      currentJobs: 1n,
      status: "ready",
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

    const ja_finished = Boolean(settings.jobAssignmentFinished);
    if (!settings.jobAssignmentDNE) {
      await ctx.db.insert("job_assignments", {
        jobId,
        providerId,
        modelId,
        finished: ja_finished,
      });
    }

    return { benchmarkId, modelId, providerId, providerSecret, jobId };
  });
  return { ...testData, t };
};
describe("getBenchmarkFile", () => {
  test("returns file when authenticated provider has a running job with that benchmark", async () => {
    const testData = await setupGetBenchmarkFile({});
    const t = testData.t;

    const res = await t.fetch(
      `/benchmark?jobId=${testData.jobId}&providerId=${testData.providerId}&secret=${testData.providerSecret}`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);
    const res_b = (await res.json()) as any;
    expect(res_b.name).toBe(valid_benchmark.name);
  });

  test("fails when job or provider do not exist", async () => {
    const testData = await setupGetBenchmarkFile({});
    const t = testData.t;

    const { fakeJobId, fakeProviderId } = await generateFakeIds(t);

    let res = await t.fetch(
      `/benchmark?jobId=${fakeJobId}&providerId=${testData.providerId}&secret=${testData.providerSecret}`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);

    res = await t.fetch(
      `/benchmark?jobId=${testData.jobId}&providerId=${fakeProviderId}&secret=${testData.providerSecret}`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("fails when provider secret is incorrect", async () => {
    const testData = await setupGetBenchmarkFile({});
    const t = testData.t;

    const res = await t.fetch(
      `/benchmark?jobId=${testData.jobId}&providerId=${testData.providerId}&secret=wrongsecret`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("fails when provider has no assignment for this job", async () => {
    const testData = await setupGetBenchmarkFile({
      jobAssignmentDNE: true,
    });
    const t = testData.t;

    const res = await t.fetch(
      `/benchmark?jobId=${testData.jobId}&providerId=${testData.providerId}&secret=${testData.providerSecret}`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });

  test("fails when provider's assignment for this job is finished", async () => {
    const testData = await setupGetBenchmarkFile({
      jobAssignmentFinished: true,
    });
    const t = testData.t;

    const res = await t.fetch(
      `/benchmark?jobId=${testData.jobId}&providerId=${testData.providerId}&secret=${testData.providerSecret}`,
      { method: "GET" }
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(400);
  });
});

describe("getBenchmarks", () => {
  test("gets benchmark by just name or part of name, doesn't get by wrong name", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: "testuser",
        ownerName: "testuser",
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      let res = await t.query(api.benchmark.getBenchmarks, {
        name: valid_benchmark.name,
      });
      expect(res).toHaveLength(1);
      expect(res[0]?._id).toBe(benchmarkId);

      res = await t.query(api.benchmark.getBenchmarks, {
        name: valid_benchmark.name.slice(0, 3),
      });
      expect(res).toHaveLength(1);
      expect(res[0]?._id).toBe(benchmarkId);

      res = await t.query(api.benchmark.getBenchmarks, {
        name: "this does not match anything",
      });
      expect(res).toHaveLength(0);
    });
  });

  test("gets benchmark by just owner name", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: "testuser",
        ownerName: "testuser",
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      let res = await t.query(api.benchmark.getBenchmarks, {
        ownerName: "testuser",
      });
      expect(res).toHaveLength(1);
      expect(res[0]?._id).toBe(benchmarkId);

      res = await t.query(api.benchmark.getBenchmarks, {
        ownerName: "this does not match anything",
      });
      expect(res).toHaveLength(0);
    });
  });

  test("gets benchmark by just version", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: "testuser",
        ownerName: "testuser",
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      let res = await t.query(api.benchmark.getBenchmarks, {
        version: valid_benchmark.version,
      });
      expect(res).toHaveLength(1);
      expect(res[0]?._id).toBe(benchmarkId);

      res = await t.query(api.benchmark.getBenchmarks, {
        version: "this does not match anything",
      });
      expect(res).toHaveLength(0);
    });
  });

  test("gets benchmark name, owner name, and version", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const b = new Blob([JSON.stringify(valid_benchmark)], {
        type: "application/json",
      });
      const sId = await ctx.storage.store(b);

      const benchmarkId = await ctx.db.insert("benchmarks", {
        storageId: sId,
        ownerId: "testuser",
        ownerName: "testuser",
        name: valid_benchmark.name,
        description: valid_benchmark.description,
        version: valid_benchmark.version,
        itemCount: BigInt(valid_benchmark.items.length),
        contentHash: "",
      });

      const res = await t.query(api.benchmark.getBenchmarks, {
        name: valid_benchmark.name,
        ownerName: "testuser",
        version: valid_benchmark.version,
      });
      expect(res).toHaveLength(1);
      expect(res[0]?._id).toBe(benchmarkId);
    });
  });
});
