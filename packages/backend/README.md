# Information about Convex API

This contains information useful for interacting with the convex backend

## Table of Contents

- [Public Functions](#public-functions)
  - [benchmark](#benchmark)
  - [model](#model)
  - [job](#job)
  - [provider](#provider)
- [HTTP Endpoints](#http-endpoints)
- [Benchmark File Format](#benchmark-file-format)
- [Quick Testing from Client](#quick-testing-from-client)
- [Setting Up Evaluations](#setting-up-evaluations)

## Public Functions

### benchmark

- `getBenchmarks` : query
  - `args`:
    - `name : string | undefined`
    - `ownerName : string | undefined`
    - `version : string | undefined`
  - Returns up to 20 metadata records for benchmarks using name, owner name, and version as optional filters. Each record has the following properties:
    - `_id : Id<"benchmarks">`
    - `ownerName : string`
    - `name : string`
    - `description : string`
    - `version : string`
    - `contentHash : string`

### model

- `getModels` : query
  - `args`:
    - `name : string | undefined`
  - Returns up to 20 records for models using name as an optional search filter. Each record has the following properties:
    - `_id : Id<"models">`
    - `_creationTime: number`
    - `name : string`

- Note that, currently, models must be added to the table manually through the dashboard

### job

- `createJob` : mutation
  - `args`:
    - `benchmarkId: Id<"benchmarks">`
    - `modelId: Id<"models">`
  - Creates a job with the provided benchmark id and model id
  - Returns an object with the following properties:
    - `success : boolean` - whether the job was succesfully created
    - `error : string | undefined` - only defined on failure, detailing the cause
    - `jobId : string | undefined` - only defined on success. The id of the created job
    - `price : bigInt | undefined` - only defined on success. The calculated price, in Wei, of the created job

- `getUserJobs` : query
  - `args`:
    - `paginationOpts : paginationOptsValidator`
  - Paginated query that returns job records for the given user (see `convex/schema`)

- `getJobsForProvider` : query
  - `args`:
    - `providerId : Id<"providers">`
    - `secret : string`
  - Returns all active job_assignment records (see `convex/schema`) for this provider, assuming authentication with the provided secret
  - Provider should listen to this to receive jobs

### provider

- `register` : mutation
  - `args`:
    - `walletAddress : string`
  - Creates a provider record with the provided wallet address. Note that this provider must be manually approved by setting `approved` to `true` in the dashboard
    - Backend verifies wallet address format but not ownership (this should be fine, as using someone else's address would bar a provider from sending results for jobs, with no benefit)
  - Returns an object with the following properties:
    - `success : boolean` - whether the provider was successfully registered
    - `error : string | undefined` - only defined on failure, detailing the cause
    - `providerId : string | undefined` - only defined on success. The id of the created provider record
    - `secret : string | undefined` - only defined on success. The backend-generated secret for this provider
  - This should be called by an authenticated user from the frontend. To prevent spam, a user can only have one unapproved provider at a time

- `addModelSupport` : mutation
  - `args`:
    - `providerId : Id<"providers">`
    - `modelId : Id<"models">`
  - Called by an authenticated user from the frontend. Tells the backend that this provider supports the model given by `modelId` and can receive jobs with this `modelId`
  - Provider must have status `"offline"`
  - Returns an object with the following properties:
    - `success : boolean` - whether the model_support record was succesfully added
    - `error : string | undefined` - only defined on failure, detailing the cause

- `removeModelSupport` : mutation
  - `args`:
    - `providerId : Id<"providers">`
    - `modelId : Id<"models">`
  - Called by an authenticated user from the frontend. Tells the backend that this provider no longer supports the model given by `modelId` and should not receive jobs with this `modelId`
  - Provider must have status `"offline"`
  - Returns an object with the following properties:
    - `success : boolean` - whether the model_support record was succesfully deleted
    - `error : string | undefined` - only defined on failure, detailing the cause

- `setMaxJobs` : mutation
  - `args`:
    - `providerId : Id<"providers">`
    - `newMaxJobs : bigint`
  - Called by an authenticated user from the frontend. Updates the maximum number of concurrent jobs the provider can support (note this is 0 when first registered, maximum value is 20)
  - Provider must have status `"offline"`
  - Returns an object with the following properties:
    - `success : boolean` - whether the model_support record was succesfully deleted
    - `error : string | undefined` - only defined on failure, detailing the cause

- `setStatus` : mutation
  - `args`:
    - `providerId : Id<"providers">`
    - `newStatus : string`,
    - `secret : string | undefined`
  - Updates provider status to the indicated status (`"offline"` or `"ready"`)
  - Can be called from the frontend by an authenticated user (without a secret) or from elsewhere using the provider's secret
  - Returns an object with the following properties:
    - `success : boolean` - whether the model_support record was succesfully deleted
    - `error : string | undefined` - only defined on failure, detailing the cause
  - Status can be set to `"offline"` despite having active jobs. This does not cancel the jobs, and the provider is still responsible for them. It simply indicates that the provider should not be assigned any <i>new</i> jobs

- `heartbeat` : mutation
  - `args`:
    - `providerId : Id<"providers">`
    - `secret : string`
  - Updates lastHeartbeat for the provider
  - Will be regularly called by the providers (using secret)
    - [NOT IMPLEMENTED YET] The backend will eventually make scheduled checks for whichever `ready` provider neglects to call heartbeat, setting status to `disconnected`

- `getUserProviders` : query
  - `args`:
    - `paginationOpts : paginationOptsValidator`
  - Paginated query that returns provider records for the given user, including the model ids each support (see `convex/schema`)

## HTTP Endpoints

### Note

For HTTP actions that require authentication, make sure to set `Authorization: Bearer [token]` in the headers, where `[token]` is the user token obtained from `(await authClient.convex.token()).data.token`

`POST /benchmark/upload`

- Requires authentication
- Expects a file as its body
- Checks that the given file is in valid benchmark format. If so, uploads the file, creates a `benchmarks` entry, and returns a JSON object with `benchmarkId` representing the _id of the new `benchmarks` entry
- On failure, returns a JSON object with an `error` property detailing the cause of the error
  - Note that benchmarks must have a unique set of (name, ownerId, version). If an existing benchmark matches all three of these fields, the action fails

`GET /benchmark?jobId=&providerId=&secret=`

- Takes three query parameters: `jobId`, `providerId`, and `secret`
- If the job is active and has been assigned to this provider (authenticated with `secret`), fetches and returns the JSON benchmark file

## Benchmark File Format

A benchmark is a JSON file consisting of a single object. The properties of this object are:

- `schema_version` - currently, must always have the value `"1.0.0"`. Meant to represent the version of the benchmark format
- `name` - `string` representing the name of the benchmark, visible to general users. Must be non-empty
- `description` - `string` description of the benchmark, visible to general users. May be empty but not `null`
- `version` - `string` used to distinguish among one's benchmarks with the same name, visible to general users. May be empty. There is currently no enforced format for this field
- `items` - a non-empty array of benchmark items. NOT visible to anyone but the owner and currently-relevant providers. Each item has the following properties:
  - `item_id` - `string` identifying the item. Must be non-empty. Currently no enforced format
  - `prompt` - `string` prompt for the given item. Must be non-empty
  - `choices` - non-empty array of non-empty `string`s
  - `correct_choice` - integer representing the correct answer in `choices`. Must be a valid array index (between 0 and choices.length-1, inclusive)

## Quick Testing from Client

The `/dev-sandbox` path on the client (component in `apps/web/src/app/components/dev-sandbox.tsx`) is designed to be a quick, minimal way to test client-convex interaction. Feel free to edit it

## Setting up Evaluations

1. Upload a benchmark from the frontend
1. Create a model from the Convex dashboard
1. Register two providers from the frontend
   - You will be barred from making another until you approve the first one (see next step)
   - Payout is not currently implemented, but you should probably choose two addresses output from anvil as the providers' wallet addresses
1. For each provider, set `approved` to `true` from the Convex dashboard
1. For each provider, from the frontend, add the model via addModelSupport (provider must still be `offline`)
1. For each provider, from the frontend, set max jobs and set status to `ready`
   - The backend cannot currently mark jobs as complete, so for testing set max jobs to 20
1. From the frontend, create a job with the benchmarkId and modelId
1. From the frontend, fund the job
   - You need to first connect your "wallet" via entering a private key output from anvil
