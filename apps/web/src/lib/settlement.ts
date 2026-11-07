import { encodeAbiParameters, keccak256 } from "viem";
import type { Hex } from "viem";

// Must match spec_hash in workers/jmac_worker/commitments.py and packages/scheduler/spec.ts.
export const specHash = (contentHash: string, modelId: string): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      [contentHash, modelId]
    )
  );
