import { expect, test } from "bun:test";

import { specHash } from "./spec";

test("spec hash matches the contract and worker vector", () => {
  expect(specHash("0123456789abcdef".repeat(4), "model1")).toBe(
    "0x051bd1fbac43750c77bbe2acd55022b45b4bf7a726ca55289f5021298470a342"
  );
});

test("spec hash changes with the benchmark bytes or the model", () => {
  const spec = specHash("a".repeat(64), "model1");
  expect(specHash("b".repeat(64), "model1")).not.toBe(spec);
  expect(specHash("a".repeat(64), "model2")).not.toBe(spec);
});
