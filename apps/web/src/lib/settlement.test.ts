import { expect, test } from "bun:test";

import { specHash } from "./settlement";

test("spec hash matches the contract, scheduler and worker vector", () => {
  expect(specHash("0123456789abcdef".repeat(4), "model1")).toBe(
    "0x051bd1fbac43750c77bbe2acd55022b45b4bf7a726ca55289f5021298470a342"
  );
});
