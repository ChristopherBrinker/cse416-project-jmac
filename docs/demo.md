# M4 demo instructions

How to run JMAC locally and show a successful evaluation and an eligible refund using only disposable test funds.

## What was demonstrated

| Item | Value |
| --- | --- |
| Commit | `8b9dc4e` on branch `feat/job-outcomes-refund-wagmi` |
| Contract | `Evaluation` at `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| Network | Local Anvil, chain ID `31337`, RPC `http://127.0.0.1:8545` (the only supported network) |
| Deployer / scheduler wallet | Anvil account 0 (`0xf39F…2266`), first transaction on a fresh chain, so the address above is deterministic |
| Developer wallet | Anvil account 1 (`0x7099…79C8`) |
| Provider wallets | Anvil accounts 2 (`0x3C44…93BC`) and 3 (`0x90F7…b906`) |
| Contract windows | 5 min to commit, then 2.5 min to reveal (`COMMIT_WINDOW`, `REVEAL_WINDOW` in `contracts/src/Evaluation.sol`) |
| Job price | 2,500 wei (fixed in `job:createJob`) |

Anvil's default accounts and keys are public test keys. They hold fake ETH and must never be used for anything real. Their keys go **into your wallet's local development setup** (MetaMask import) or into git-ignored env files. **The website never asks for a private key.**

### Labelled limitations in this demo

- **Providers are simulated.** `packages/scheduler/demo-providers.ts` stands in for two `jmac_worker` processes. It heartbeats and drives the real contract lifecycle (commit → reveal → claim) with the worker's commitment encoding, but **runs no model and reads no benchmark**. It reveals a digest of fixed predictions (`DEMO_SCORES`, default `1,1,0` → 66.7% on a 3-item benchmark). To use real workers instead, follow [`workers/README.md`](../workers/README.md) (needs `uv` or Docker and the pinned SmolLM2 model).
- **Model revision and worker version** appear as "not recorded" on receipts. The backend has no field for them yet.
- **Admin approval** is a CLI command, not a UI.
- See [requirements checklist](m4/requirements.md) for every remaining gap.

## Prerequisites

- Bun 1.4.0, Foundry (`anvil`, `forge`, `cast`), and access to the team Convex project
- A browser wallet: MetaMask or any EIP-1193/EIP-6963 wallet
- Google Chrome, only for the scripted verification

## Environment variables

Names only. Never commit values.

| File | Variable | Value for this demo |
| --- | --- | --- |
| `contracts/.env` | `BACKEND_ADDRESS` | Anvil account 0 address |
| `packages/scheduler/.env` | `BACKEND_WALLET_PRIVATE_KEY` | Anvil account 0 key (local dev key) |
|  | `CONTRACT_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
|  | `NET_URL` | `http://127.0.0.1:8545` |
|  | `CONVEX_URL` | your deployment's `.convex.cloud` URL |
|  | `BACKEND_CONVEX_KEY` | any shared string, also set on Convex |
| `apps/web/.env.local` | `NEXT_PUBLIC_CONVEX_URL` | your deployment's `.convex.cloud` URL |
|  | `NEXT_PUBLIC_CONVEX_SITE_URL` | the same deployment's `.convex.site` URL |
|  | `NEXT_PUBLIC_CONTRACT_ADDRESS` | same as `CONTRACT_ADDRESS` |
|  | `NEXT_PUBLIC_NET_URL` | same as `NET_URL` |
| Convex deployment (`bun x convex env set`) | `BETTER_AUTH_SECRET`, `SITE_URL` (`http://localhost:7346`), `BACKEND_CONVEX_KEY` | see the root README |
| `packages/scheduler/.env.demo.local` (simulator only, git-ignored) | `DEMO_RESULT_MODE` | `agree`, `disagree`, or `silent` |
|  | `DEMO_SCORES` | optional, e.g. `1,1,0` (per-item correctness pattern, repeated to the on-chain item count) |
|  | `DEMO_PROVIDER_A_ID`, `DEMO_PROVIDER_A_SECRET`, `DEMO_PROVIDER_A_KEY` | provider A's Convex ID, worker secret, and Anvil account 2 key |
|  | `DEMO_PROVIDER_B_ID`, `DEMO_PROVIDER_B_SECRET`, `DEMO_PROVIDER_B_KEY` | provider B's values with Anvil account 3 |

## Setup

Each long-running command gets its own terminal. From the repository root:

```sh
bun install --frozen-lockfile

# 1. Local chain (leave running)
anvil

# 2. Deploy the contract (must be the first transaction on a fresh chain
#    to get the address above). Uses Anvil account 0.
cd contracts
forge build
forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd ..
# If you changed the contract, copy the ABI:
#   cp contracts/out/Evaluation.sol/Evaluation.json packages/scheduler/abi.json
#   cp contracts/out/Evaluation.sol/Evaluation.json apps/web/public/abi.json

# 3. Push Convex functions/schema and seed the model (once per deployment)
cd packages/backend
bun x convex dev --once
bun x convex run admin:addModel '{"name": "SmolLM2-135M-Instruct"}'
cd ../..

# 4. Scheduler (leave running)
cd packages/scheduler && bun run dev

# 5. Web app (leave running) → http://localhost:7346
bun run dev:web
```

### Wallet setup (MetaMask)

1. Import Anvil accounts 1, 2, and 3 into MetaMask (Import account → paste the key printed by `anvil`). These are local test accounts only.
2. Connecting from the dashboard adds and switches to **JMAC Local (Anvil)** (chain 31337, RPC `http://127.0.0.1:8545`) automatically. You can also add it by hand.
3. If you restart Anvil, reset each account's activity in MetaMask (Settings → Advanced → Clear activity tab data) so its nonce cache matches the fresh chain.

## Benchmark format

Upload JSON matching schema `1.0.0` (full spec in [`packages/backend/README.md`](../packages/backend/README.md#benchmark-file-format)):

```json
{
  "schema_version": "1.0.0",
  "name": "Worker scoring example",
  "description": "Three simple questions for validating the local scoring pipeline.",
  "version": "1.0.0",
  "items": [
    {
      "item_id": "arithmetic",
      "prompt": "What is 2 + 2?",
      "choices": ["3", "4", "5"],
      "correct_choice": 1
    }
  ]
}
```

`workers/examples/benchmark.json` is a ready-made 3-item file. Validation errors name the exact field (for example `items[0].correct_choice must be an integer between 0 and items[0].choices.length - 1`). Duplicate `item_id`s are **not** rejected yet.

## Demo script

### A. Register two providers (signed wallet ownership)

1. Sign up at `/sign-up` with a throwaway email.
2. In MetaMask select **account 2** → **Connect wallet** → choose your wallet.
3. **My providers** → **Verify wallet and register** → MetaMask shows a message containing your account, wallet, chain 31337, a nonce, and an expiry → **Sign**.
   - Expected: provider appears with "Wallet address · verified …". Rejecting the signature shows "You rejected the request in your wallet. Nothing was signed or sent." and creates nothing.
4. Approve it (admin only): `cd packages/backend && bun x convex run admin:approveProvider '{"providerId": "<id from the card>"}'`.
5. On the provider card: set capacity to 1 → **Save**, add **SmolLM2-135M-Instruct** → **Add**, then **Set ready**.
6. Switch MetaMask to **account 3** (the page shows "Wallet account changed…") and repeat steps 3–5.
7. Put both providers' IDs and worker secrets (reveal with the eye icon) plus the account 2/3 keys into `packages/scheduler/.env.demo.local`. Start `bun run demo:providers` from `packages/scheduler` (or two real workers).

### B. Successful evaluation

1. Switch MetaMask to **account 1** (the developer).
2. **Upload benchmark** → choose `workers/examples/benchmark.json`.
3. **New evaluation** → pick the benchmark and **SmolLM2-135M-Instruct** → **Create evaluation**.
4. In job details → **Fund job · 2,500 wei** → approve in MetaMask.
   - Expected progression: _Funding pending_ → _Funding confirmed_ → _Providers assigned_ → _Commits n/2 · Reveals n/2_ with a countdown → **Accepted result**.
5. Expected receipt: **66.7%**, "Accuracy 0.667 on the worker's 0–1 scale · 2 of 3 items correct", benchmark v1.0.0 and SHA-256, model, result commitment, completion tx, contract address and chain, spec hash and output digest, three verification checks (spec hash, completion transaction, on-chain count), both providers' IDs and wallets, and "Payment claimed" for each provider (claims are shown separately from acceptance). No questions, answers, or per-item results appear.

### C. Eligible refund

Disagreement (immediate):

1. Set `DEMO_RESULT_MODE=disagree` and restart the simulator.
2. As account 1, create and fund another job.
3. Expected: **Failed: Providers disagreed on results** and **Refund available**.
4. Optional: switch to account 2 → the button is blocked with "Only the funding wallet 0x7099… can refund this job".
5. As account 1 → **Refund job** → approve. Rejecting first keeps the job "Refund available" (never "refunded").
6. Expected: **Refund confirmed**, plus a refund transaction under Transactions. The contract's status field (the seventh value printed) is `3` (Refunded):

   ```sh
   cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
     "jobs(string)(address,string,uint256,(address,string,bytes32,bytes32,bool,bool,bool,uint256),(address,string,bytes32,bytes32,bool,bool,bool,uint256),bool,uint8,uint256,bytes32,uint256)" \
     <jobId> --rpc-url http://127.0.0.1:8545
   ```

Expiry (deadline-based):

1. Set `DEMO_RESULT_MODE=silent` and restart the simulator. Create and fund a job.
2. Before the deadline no refund button is offered (_Evaluation pending · Commits 0/2_ with a countdown).
3. Wait 5 minutes, or fast-forward Anvil: `cast rpc evm_increaseTime 600 && cast rpc evm_mine`. Advance time only **after** "Providers assigned" appears; otherwise the scheduler's assignment reverts with "Commit deadline passed".
4. Expected: **Expired: Timed out** ("Only 0 of 2 providers committed…") and **Refund available** → refund as above.

### D. Wrong network

Switch MetaMask to any other network. Expected: a "Wrong network" banner, the wallet button marked "wrong network", and funding/refund disabled. **Switch to JMAC Local (Anvil)** fixes it.

## Scripted verification

With the stack running, from `apps/web` (uses local Chrome and a **test-only** injected wallet that forwards to Anvil's unlocked dev accounts):

```sh
node node_modules/playwright-core/cli.js install ffmpeg   # once, for video
node e2e/verify-flows.mjs wallet    # connect, account change, wrong network, rejected tx, disconnect
node e2e/verify-flows.mjs success   # simulator in agree mode
node e2e/verify-flows.mjs refund    # simulator in disagree mode
node e2e/verify-flows.mjs expiry    # simulator in silent mode; advances Anvil time
node e2e/verify-flows.mjs sandbox   # dev sandbox has no private-key input
```

Set `E2E_EMAIL`/`E2E_PASSWORD` to a disposable account you created. Screenshots and `.webm` video go to `apps/web/e2e/output/` (git-ignored). Each provider has capacity 1, and a job stays "funded" in Convex until the scheduler's timeout cleanup (about 8 minutes after funding), even after an on-chain refund. Run phases that need assignment only after earlier jobs have settled, or raise provider capacity.

Unit and contract tests:

```sh
bun run test                    # web lifecycle + backend wallet-challenge tests
(cd contracts && forge test)    # 59 contract tests
```
