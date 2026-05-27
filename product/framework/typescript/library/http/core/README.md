# @k1s0-ts-http/core

Shared HTTP client primitives for DevPortal TypeScript packages.

## Features

- `createHttpClient` fetch wrapper with `baseUrl`, default headers, auth headers, request IDs, interceptors, logging, retry, and timeout support.
- Runtime validation for retry, timeout, and request ID header settings to reject unsafe values before requests run.
- REST helpers: `get`, `post`, `put`, `patch`, `del`, `getJson`, `getText`, `getBlob`, and `getArrayBuffer`.
- gRPC-web unary client with optional `grpc-web` peer dependency.
- Normalized `HttpError` values for HTTP, timeout, abort, network, and gRPC failures.
- Zod schemas for config validation.

## Install

```bash
npm install @k1s0-ts-http/core
```

Install optional peers only when those integrations are used:

```bash
npm install grpc-web
npm install @k1s0-ts-logger/core
```

## HTTP Usage

```ts
import { createBearerAuth, createHttpClient, get, post } from "@k1s0-ts-http/core";

const client = createHttpClient({
  baseUrl: "https://api.example.com",
  defaultHeaders: { "X-Tenant": "acme" },
  auth: createBearerAuth(async () => getAccessToken()),
  retry: { maxRetries: 3, backoffBaseMs: 200 },
  timeout: { totalMs: 30_000, perAttemptMs: 5_000 },
  logger,
});

const users = await get<{ id: string; name: string }[]>(client, "/users", {
  query: { active: true },
});

await post<{ id: string }>(client, "/users", { name: "alice" });
```

## Error Handling

```ts
import { HttpError } from "@k1s0-ts-http/core";

try {
  await get(client, "/secret");
} catch (err) {
  if (err instanceof HttpError) {
    console.log(err.status, err.code, err.retryable, err.requestId);
  }
}
```

### Auth errors are not retried by default (v0.2)

When `config.auth.getAuthHeaders()` throws, the error is wrapped into
`HttpError({ code: "AUTH_FAILED", retryable: false })` and the request is
**not** retried automatically. This avoids tight retry loops when a token
endpoint is down. If you want to retry transient auth failures, opt in via
`retry.shouldRetry`:

```ts
const client = createHttpClient({
  auth,
  retry: {
    maxRetries: 2,
    shouldRetry: (err) => (err as { code?: string }).code === "AUTH_FAILED",
  },
});
```

If your `auth` provider throws a custom `HttpError` directly, it is passed
through unchanged (the wrapper only kicks in for non-`HttpError` throws).

## gRPC-web

```ts
import { createBearerAuth, createGrpcClient } from "@k1s0-ts-http/core";

const grpc = await createGrpcClient({
  baseUrl: "https://grpc.example.com",
  auth: createBearerAuth(getToken),
  retry: { maxRetries: 2 },
  timeoutMs: 10_000,
  logger,
});

// Safe-by-default: unary calls are NOT retried unless opt-in.
// Read-only / idempotent RPCs can opt in per call:
const res = await grpc.unary(GetUserMethod, { id: "u1" }, { idempotent: true });

// Side-effectful RPCs (Create/Charge/Transfer) should leave it unset to
// avoid double-execution on transient UNAVAILABLE errors.
await grpc.unary(ChargeMethod, { amount: 100 });
```

If `grpc-web` is not installed, `createGrpcClient()` throws `HttpError` with code `GRPC_PEER_MISSING`.

### gRPC unary idempotency opt-in (v0.2, breaking)

`grpc.unary()` now treats each call as **non-idempotent by default** and
clamps `maxRetries` to 0 unless one of these flags is set:

- `opts.idempotent: true` — opt in per call (recommended for read-only RPCs).
- `config.retry.allowNonIdempotent: true` — opt in for every RPC under the
  client (matches the pre-v0.2 behaviour; only enable when the server
  guarantees idempotency or duplication is acceptable).

When retries are disabled for safety, a `logger.debug("grpc.retry.disabled",
{ reason: "non-idempotent" })` entry is emitted so you can spot RPCs that
might benefit from opt-in.

Auth errors inside gRPC unary are wrapped into `HttpError({ code:
"AUTH_FAILED", retryable: false })` with the same semantics as the HTTP
client.

### gRPC retry policy: `retryableStatuses` is unsupported

gRPC has its own status codes (no HTTP status), so `retryableStatuses` is
intentionally **omitted** from `GrpcClientConfig.retry`. Passing it produces a
Zod validation error at `createGrpcClient()` time. To customise retryable
codes, use `shouldRetry` on the policy and inspect `err.code` (e.g.
`"UNAVAILABLE"`, `"DEADLINE_EXCEEDED"`).

## Build And Test

```bash
npm install
npm run typecheck
npm run build
npm test
npm run test:coverage
```

`prepublishOnly` runs clean, build, and coverage. The package emits ESM, CommonJS, declarations, and source maps under `dist/`.
