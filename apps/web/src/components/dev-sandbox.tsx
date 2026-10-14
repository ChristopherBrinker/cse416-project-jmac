"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import { useQuery } from "convex/react";
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
    console.log(result);
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

  const handleSearch = (formData: FormData) => {
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

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div>Hello World!</div>
      <div>
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
            />
          </div>
          <div>
            <button style={{ backgroundColor: "ButtonFace" }} type="submit">
              Send
            </button>
          </div>
        </form>
      </div>
      <div>
        Search benchmarks
        <form action={handleSearch}>
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
              Send
            </button>
          </div>
        </form>
      </div>
      <div>
        {benchmarks?.map((m) => (
          <div key={m._id}>
            <div>{m._id}</div>
            <div>
              {m.name}, version {m.version} by {m.ownerName}
            </div>
            <div>Description: {m.description}</div>
            <div>Hash: {m.contentHash}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
