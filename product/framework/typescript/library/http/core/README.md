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

const res = await grpc.unary(EchoServiceEchoMethod, { message: "hi" });
```

If `grpc-web` is not installed, `createGrpcClient()` throws `HttpError` with code `GRPC_PEER_MISSING`.

## Build And Test

```bash
npm install
npm run typecheck
npm run build
npm test
npm run test:coverage
```

`prepublishOnly` runs clean, build, and coverage. The package emits ESM, CommonJS, declarations, and source maps under `dist/`.
