import { encodeAbiParameters, keccak256 } from "viem";

// Identifies the immutable evaluation specification recorded on-chain at assignment: the
// SHA-256 hex of the exact benchmark bytes and the Convex model ID. Must match spec_hash in
// workers/jmac_worker/commitments.py and the vector in contracts/test/EvaluationSettlement.t.sol.
export const specHash = (contentHash: string, modelId: string): `0x${string}` =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      [contentHash, modelId]
    )
  );
