# JMAC — Private AI Benchmarking

JMAC is our CSE 416 project for private AI benchmarking. The repository provides the web application, authentication, benchmark uploads, a scheduler for funded jobs, and a Docker-packaged Python benchmark evaluator with provider readiness and heartbeats. The Evaluation contract supports funding, provider assignment, and result-hash commitments; reveal, result comparison, refunds, and payouts are not implemented yet. The worker does not yet fetch assignments or call the contract. See the [worker guide](workers/README.md) for pinned local model inference, provider setup, scoring, and repeatability checks.

The application uses Next.js App Router and TypeScript, Convex for the backend, and Better Auth for email/password authentication through the supported Convex component. Bun workspaces and Turborepo manage the monorepo; Ultracite with Oxlint/Oxfmt and Lefthook handle code checks.

## First-time setup for each developer

Install **Bun 1.4.0** and ask a project maintainer for access to the team's Convex project.

Install the latest version of **Foundry**.

Our current implementation uses a local testnet. In a separate terminal, run an anvil testnet:

```sh
anvil
```

Next thing is to build and deploy the Evaluation smart contract.

Pick an account address output by anvil to represent the scheduler's wallet. Create `contracts/.env` and in it add `BACKEND_ADDRESS=0xYOUR_CHOSEN_ADDRESS`.

Using the url output by anvil as an http url (usually `http://127.0.0.1:8545`) and any private key output by anvil, run the following from the `contracts` directory:

```sh
forge build
forge script script/Deploy.s.sol --broadcast --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

Note the contract address output by `script`.

`build` will produce an ABI file `out/Evaluation.sol/Evaluation.json`. This ABI is required by the frontend and scheduler to call the contract's functions, and must be copied to their respective holding places. From the repository root, run:

```sh
cp contracts/out/Evaluation.sol/Evaluation.json packages/scheduler/abi.json
cp contracts/out/Evaluation.sol/Evaluation.json apps/web/public/abi.json
```

Next is to configure the enviornment variables for the scheduler. Go to `packages/scheduler`, create `.env` and in it add:

| Variable | Where to get it |
| --- | --- |
| `BACKEND_WALLET_PRIVATE_KEY` | From anvil's output, the private key corresponding to the address you chose to be the scheduler |
| `CONTRACT_ADDRESS` | From `forge script`'s output, the address of the deployed contract |
| `NET_URL` | The url output by anvil as an http url (usually `http://127.0.0.1:8545`) |
| `CONVEX_URL` | The cloud url of your Convex deployment |
| `BACKEND_CONVEX_KEY` | Create a key (any string) that will be used to authenticate the scheduler with Convex |

Next is to configure the environment variables for the frontend. First run the following from the repository root:

```sh
cp apps/web/.env.example apps/web/.env.local
```

In `apps/web/.env.local`, add:

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | The URL for your configured Convex development deployment, also written to `packages/backend/.env.local` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | The same deployment's HTTP Actions URL (`https://<deployment>.convex.site`) |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Same as `CONTRACT_ADDRESS` in scheduler |
| `NEXT_PUBLIC_NET_URL` | Same as `NET_URL` in scheduler |

Before continuing, set these values **on each Convex deployment** from `packages/backend` (replace `$BACKEND_CONVEX_KEY` with the one you made for the scheduler):

```sh
bun x convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bun x convex env set SITE_URL http://localhost:7346
bun x convex env set BACKEND_CONVEX_KEY $BACKEND_CONVEX_KEY
```

Keep the secret stable for that deployment. `SITE_URL` must match the browser origin, including port. These settings belong in the Convex dashboard/deployment environment; putting them in a local file does not configure the deployed backend. The Next.js app does not need the auth secret.

Next, run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run dev:setup
```

`bun install` also generates the web environment types. `hooks:install` installs this clone's Git hooks; each developer must run it once.

During `dev:setup`, sign in to Convex and select the **existing team project**. Follow the prompts to configure your development deployment. This writes `packages/backend/.env.local`; do not create an unrelated Convex project. Ask a maintainer which development deployment to use if you are unsure.

Keep backend deployment settings in `packages/backend/.env.local`. Never commit environment files or secrets.

Finally, start the application:

```sh
bun run dev
```

Open [http://localhost:7346](http://localhost:7346), create an account at `/sign-up`, sign in at `/sign-in`, and visit `/dashboard`. A successful connection shows the backend as connected (the private query returns “This is private”). Also go to `/dev-sandbox` for a minimal interface for the current interactions.

## Account configuration

Authentication runs entirely in Convex using `@convex-dev/better-auth`; its component stores users, password accounts, and sessions in Convex. No additional database or auth service is needed. There are no existing accounts to migrate.

Run `bun run dev:server` from the repository root to register the Better Auth component, HTTP routes, and JWT provider and regenerate the Convex API types. Backend setup and deployment-aware code generation require Convex access. Then start the web app.

Email/password registration is enabled without email verification. Better Auth handles password hashing, sessions, and validation. Registration does not grant project membership authorization; implement that separately before exposing project-specific data. Email verification and password recovery require an email delivery configuration and are not configured in this scaffold.

For production, use the production deployment's URLs, a separate `BETTER_AUTH_SECRET`, and an HTTPS `SITE_URL` matching the deployed web origin. Sync the backend with `bun x convex deploy` from `packages/backend` before deploying the web app. See the [supported Next.js integration guide](https://labs.convex.dev/better-auth/framework-guides/next).

## Daily development

After the first-time setup:

```sh
bun run dev
```

Run `bun install --frozen-lockfile` after pulling dependency changes. Git hooks check staged files before commits. For repository-wide checks and fixes:

```sh
bun run check         # Lint and formatting checks
bun run check-types   # TypeScript checks for web, UI, and backend
bun run fix           # Apply Ultracite fixes and formatting
```

| Command | Purpose |
| --- | --- |
| `bun run dev:web` | Start only Next.js on port 7346 |
| `bun run dev:server` | Watch and sync Convex functions and generated types |
| `bun run lint` | Run Oxlint |
| `bun run format:check` | Check formatting |
| `bun run format` | Apply formatting |
| `bun run build` | Build the web application with real Convex environment values |
| `bun run env:generate` | Regenerate web environment types after editing `.env.schema` |

## Repository layout

```text
apps/web/             Next.js application: sign-in and protected dashboard
packages/backend/     Convex functions, schema, auth configuration, generated API
packages/ui/          Shared UI components and styles
packages/config/      Shared TypeScript configuration
packages/scheduler/   Backend-blockchain interactions
contracts/            Foundry workspace
workers/              Python/Docker evaluation, pinned model inference, and tests
```

The frontend imports the generated, typed Convex API from the backend workspace. Commit Convex `_generated` files and regenerate them with Convex tooling; lint and formatting exclude these generated files. Varlock generates `apps/web/src/env.ts` during installation, and that file is ignored.

The dashboard checks Better Auth authentication on the server and waits for Convex authentication before requesting private data. Protected Convex functions must also enforce authentication themselves; frontend route protection does not secure backend calls. Authentication alone does not implement project membership authorization.

## CI and verification

GitHub Actions uses Bun 1.4.0 and frozen installs to run lint, formatting, and TypeScript checks. A separate build job requires repository Actions secrets `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`. A maintainer enables it with repository variable `INTEGRATION_BUILD_ENABLED=true`. The workflow does not deploy Convex.

Static checks run without account credentials. Production builds, deployment-aware Convex code generation, and live authentication checks require a configured Convex deployment and environment values.

After configuring accounts, verify that:

- An anonymous visit to `/dashboard` redirects to sign-in.
- Signing in loads the authenticated Convex response.
- Signing out prevents access to the dashboard.
- An anonymous call to `privateData:get` rejects with “Authentication required”.
