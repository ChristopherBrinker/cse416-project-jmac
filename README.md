# JMAC — Private AI Benchmarking

JMAC is our CSE 416 project for private AI benchmarking. The repository currently provides the web application, authentication, and a typed backend connection. Benchmark evaluation, Python workers, and Solidity contracts are planned but are not implemented yet.

The application uses Next.js App Router and TypeScript, Convex for the backend, and Better Auth for email/password authentication through the supported Convex component. Bun workspaces and Turborepo manage the monorepo; Ultracite with Oxlint/Oxfmt and Lefthook handle code checks.

## First-time setup for each developer

Install **Bun 1.4.0** and ask a project maintainer for access to the team's Convex project. Run these commands from the repository root after cloning:

```sh
bun install --frozen-lockfile
bun run hooks:install
cp apps/web/.env.example apps/web/.env.local
bun run dev:setup
```

`bun install` also generates the web environment types. `hooks:install` installs this clone's Git hooks; each developer must run it once.

During `dev:setup`, sign in to Convex and select the **existing team project**. Follow the prompts to configure your development deployment. This writes `packages/backend/.env.local`; do not create an unrelated Convex project. Ask a maintainer which development deployment to use if you are unsure.

Fill in `apps/web/.env.local`:

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | The URL for your configured Convex development deployment, also written to `packages/backend/.env.local` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | The same deployment's HTTP Actions URL (`https://<deployment>.convex.site`) |

Copy both public Convex URLs into the web file. Keep backend deployment settings in `packages/backend/.env.local`. Never commit environment files or secrets.

Configure `BETTER_AUTH_SECRET` and `SITE_URL` on your Convex development deployment as described below, then start the application:

```sh
bun run dev
```

Open [http://localhost:7346](http://localhost:7346), create an account at `/sign-up`, sign in at `/sign-in`, and visit `/dashboard`. A successful connection shows the backend as connected (the private query returns “This is private”).

## Account configuration

Authentication runs entirely in Convex using `@convex-dev/better-auth`; its component stores users, password accounts, and sessions in Convex. No additional database or auth service is needed. There are no existing accounts to migrate.

Before syncing backend functions, set these values **on each Convex deployment** from `packages/backend`:

```sh
bun x convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bun x convex env set SITE_URL http://localhost:7346
```

Keep the secret stable for that deployment. `SITE_URL` must match the browser origin, including port. These settings belong in the Convex dashboard/deployment environment; putting them in a local file does not configure the deployed backend. The Next.js app needs only the two public Convex URLs, not the auth secret.

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
contracts/            Planned Foundry workspace
workers/              Planned Python/Docker evaluation workers
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
