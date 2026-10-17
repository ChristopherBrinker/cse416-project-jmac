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
    - `price : BigInt | undefined` - only defined on success. The calculated price, in Wei, of the created job

- `getUserJobs` : query
  - `args`: none
  - Returns all job records for the given user (see `convex/schema`), or `[]` if they are not authenticated

### provider

- `register` : mutation
  - `args`:
    - `walletAddress : string`
  - Creates a provider record with the provided wallet address. Note that this provider must be manually approved by setting `approved` to `true` in the dashboard
    - Since there is no assignment process yet, approval and state (maxJobs, currentJobs, status) don't currently mean anything
    - Backend verifies wallet address format but not ownership (this should be fine, as using someone else's address would bar a provider from sending results for jobs, with no benefit)
  - Returns an object with the following properties:
    - `success : boolean` - whether the provider was succesfully registered
    - `error : string | undefined` - only defined on failure, detailing the cause
    - `providerId : string | undefined` - only defined on success. The id of the created provider record
    - `secret : string | undefined` - only defined on success. The backend-generated secret for this provider
      - Will be useable by the provider outside the frontend for authenticated heartbeat / state updates, once these are implemented, in lieu of betterauth
  - This should be called by an authenticated user from the frontend. To prevent spam, a user can only have one unapproved provider at a time

- `getUserProviders` : query
  - `args`: none
  - Returns all provider records for the given user (see `convex/schema`), or `[]` if they are not authenticated

- `getProvider` : query
  - `args`:
    - `id : Id<"providers">`
  - Returns the provider record with the given id (see `convex/schema`), or `null` if there is no match or the provider does not belong to the authenticated user

## HTTP Endpoints

### Note

For HTTP actions that require authentication, make sure to set `Authorization: Bearer [token]` in the headers, where `[token]` is the user token obtained from `(await authClient.convex.token()).data.token`

`POST /benchmark/upload`

- Requires authentication
- Expects a file as its body
- Checks that the given file is in valid benchmark format. If so, uploads the file, creates a `benchmarks` entry, and returns a JSON object with `benchmarkId` representing the _id of the new `benchmarks` entry
- On failure, returns a JSON object with an `error` property detailing the cause of the error
  - Note that benchmarks must have a unique set of (name, ownerId, version). If an existing benchmark matches all three of these fields, the action fails

There is currently no way to get the actual benchmark files

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
