# Information about Convex API

This contains information useful for interacting with the convex backend

## Table of Contents

- [Public Functions](#public-functions)
- [HTTP Endpoints](#http-endpoints)
- [Benchmark File Format](#benchmark-file-format)
- [Quick Testing from Client](#quick-testing-from-client)

## Public Functions

`getBenchmarks`

- `args`:
  - `name : string | undefined`
  - `ownerName : string | undefined`
  - `version : string | undefined`
- Returns up to 20 metadata records for benchmarks using name, owner name, and version as optional filters. Each record has the following properties:
  - `_id : string`
  - `ownerName : string`
  - `name : string`
  - `description : string`
  - `version : string`
  - `contentHash : string`

## HTTP Endpoints

### Note

HTTP Actions (besides OPTIONS) require authentication. Make sure to set `Authorization: Bearer [token]` in the headers, where `[token]` is the user token obtained from `(await authClient.convex.token()).data.token`

`POST /benchmark/upload`

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
