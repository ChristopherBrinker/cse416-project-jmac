"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

const handleSubmit = async (formData: FormData) => {
  let token;
  try {
    const t = await authClient.convex.token();
    if (!t.data) {
      return;
    }
    token = t.data.token;
  } catch (error) {
    console.log(error);
    return;
  }

  try {
    const file = formData.get("fileupload") as File;
    if (file.size > 0) {
      const postUrl = new URL(
        `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/benchmark/upload`
      );
      const result = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          Authorization: `Bearer ${token}`,
        },
        body: file,
      });

      const body = await result.json();
      console.log(body);
      if (result.status === 200) {
        alert(body.benchmarkId);
      } else {
        alert(body.error);
      }
    }
  } catch (error) {
    alert(error);
  }
};

export default function DevSandbox() {
  const [searchBenchmarkName, setSearchBenchmarkName] = useState<
    string | undefined
  >();
  const [searchOwnerName, setSearchOwnerName] = useState<string | undefined>();
  const [searchVersion, setSearchVersion] = useState<string | undefined>();
  const benchmarks = useQuery(api.benchmark.getBenchmarks, {
    name: searchBenchmarkName,
    ownerName: searchOwnerName,
    version: searchVersion,
  });

  const [searchModelName, setSearchModelName] = useState<string | undefined>();
  const models = useQuery(api.model.getModels, {
    name: searchModelName,
  });

  const createJob = useMutation(api.job.createJob);
  const {
    results: jobList,
    status: jobListStatus,
    loadMore: jobListLoadMore,
  } = usePaginatedQuery(api.job.getUserJobs, {}, { initialNumItems: 5 });

  const registerProvider = useMutation(api.provider.register);
  const {
    results: providers,
    status: providersStatus,
    loadMore: providersLoadMore,
  } = usePaginatedQuery(
    api.provider.getUserProviders,
    {},
    { initialNumItems: 5 }
  );

  const handleBenchmarkSearch = (formData: FormData) => {
    const name = formData.get("benchmarkName")
      ? String(formData.get("benchmarkName"))
      : undefined;
    const ownerName = formData.get("ownerName")
      ? String(formData.get("ownerName"))
      : undefined;
    const version = formData.get("version")
      ? String(formData.get("version"))
      : undefined;
    setSearchBenchmarkName(name);
    setSearchOwnerName(ownerName);
    setSearchVersion(version);
  };

  const handleModelSearch = (formData: FormData) => {
    const name = formData.get("modelName")
      ? String(formData.get("modelName"))
      : undefined;
    setSearchModelName(name);
  };

  const handleCreateJob = async (formData: FormData) => {
    try {
      const benchmarkId = formData.get("benchmarkId") as Id<"benchmarks">;
      const modelId = formData.get("modelId") as Id<"models">;
      const ret = await createJob({ benchmarkId, modelId });
      console.log(ret);
      if (!ret.success) {
        alert(ret.error);
      }
    } catch (error) {
      console.log(error);
      alert(error);
    }
  };

  const handleRegister = async (formData: FormData) => {
    try {
      const providerAddress = String(formData.get("providerAddress"));
      const ret = await registerProvider({ walletAddress: providerAddress });
      console.log(ret);
      if (!ret.success) {
        alert(ret.error);
      }
    } catch (error) {
      console.log(error);
      alert(error);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div id="benchmark-upload">
        Benchmark upload
        <form action={handleSubmit}>
          <div>
            <label htmlFor="fileupload">Upload file </label>
            <input
              type="file"
              id="fileupload"
              name="fileupload"
              accept="application/json, .json"
              style={{ backgroundColor: "ButtonFace" }}
              required
            />
          </div>
          <div>
            <button style={{ backgroundColor: "ButtonFace" }} type="submit">
              Send
            </button>
          </div>
        </form>
      </div>
      <div id="benchmark-search">
        <div>
          Search benchmarks
          <form action={handleBenchmarkSearch}>
            <div>
              <input
                type="text"
                id="benchmarkName"
                name="benchmarkName"
                placeholder="Benchmark name"
                style={{ border: "1px solid black" }}
              />
              <input
                type="text"
                id="ownerName"
                name="ownerName"
                placeholder="Owner name"
                style={{ border: "1px solid black" }}
              />
              <input
                type="text"
                id="version"
                name="version"
                placeholder="Benchmark version"
                style={{ border: "1px solid black" }}
              />
            </div>
            <div>
              <button style={{ backgroundColor: "ButtonFace" }} type="submit">
                Search
              </button>
            </div>
          </form>
        </div>
        <div>
          {benchmarks?.map((m) => (
            <div key={m._id} style={{ marginBottom: "8px" }}>
              <div>Id: {m._id}</div>
              <div>
                {m.name}, version {m.version} by {m.ownerName}
              </div>
              <div>Description: {m.description}</div>
              <div>Hash: {m.contentHash}</div>
            </div>
          ))}
        </div>
      </div>
      <div id="model-search">
        <div>
          Search models
          <form action={handleModelSearch}>
            <div>
              <input
                type="text"
                id="modelName"
                name="modelName"
                placeholder="Model name"
                style={{ border: "1px solid black" }}
              />
            </div>
            <div>
              <button style={{ backgroundColor: "ButtonFace" }} type="submit">
                Search
              </button>
            </div>
          </form>
        </div>
        <div>
          {models?.map((m) => (
            <div key={m._id} style={{ marginBottom: "8px" }}>
              <div>Id: {m._id}</div>
              <div>Name: {m.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div id="job-stuff">
        <div>
          Create evaluation job (note the actual ui should have users select
          from searches, not type the ids)
          <form action={handleCreateJob}>
            <div>
              <input
                type="text"
                id="benchmarkId"
                name="benchmarkId"
                placeholder="Benchmark ID"
                style={{ border: "1px solid black" }}
              />
              <input
                type="text"
                id="modelId"
                name="modelId"
                placeholder="Model ID"
                style={{ border: "1px solid black" }}
              />
            </div>
            <div>
              <button style={{ backgroundColor: "ButtonFace" }} type="submit">
                Create
              </button>
            </div>
          </form>
        </div>
        <div>
          Current jobs:
          {jobList?.map((j) => (
            <div key={j._id} style={{ marginBottom: "8px" }}>
              <div>Id: {j._id}</div>
              <div>Benchmark Id: {j.benchmarkId}</div>
              <div>Model Id: {j.modelId}</div>
              <div>Price: {j.price}</div>
              <div>Status: {j.status}</div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => jobListLoadMore(5)}
            disabled={jobListStatus !== "CanLoadMore"}
          >
            Load More {providersStatus === "Exhausted" ? "(nothing left)" : ""}
          </button>
        </div>
      </div>
      <div id="provider-stuff">
        <div>
          Register Provider (wallet is 0x followed by 20 hex bytes, example
          0x00112233445566778899aabbccddeeff00112233)
          <form action={handleRegister}>
            <div>
              <input
                type="text"
                id="providerAddress"
                name="providerAddress"
                placeholder="Provider Wallet Address"
                style={{ border: "1px solid black" }}
              />
            </div>
            <div>
              <button style={{ backgroundColor: "ButtonFace" }} type="submit">
                Register
              </button>
            </div>
          </form>
        </div>
        <div>
          Current providers:
          {providers?.map((p) => (
            <div key={p._id} style={{ marginBottom: "8px" }}>
              <div>Id: {p._id}</div>
              <div>
                Secret: {p.secret} (in actual ui, should be hidden with toggle
                visibility)
              </div>
              <div>Wallet Address: {p.walletAddress}</div>
              <div>Approved: {String(p.approved)}</div>
              <div>Max Jobs: {p.maxJobs}</div>
              <div>Current Jobs: {p.currentJobs}</div>
              <div>Status: {p.status}</div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => providersLoadMore(5)}
            disabled={providersStatus !== "CanLoadMore"}
          >
            Load More {providersStatus === "Exhausted" ? "(nothing left)" : ""}
          </button>
        </div>
      </div>
      <div style={{ marginBottom: "32px" }} />
    </main>
  );
}
