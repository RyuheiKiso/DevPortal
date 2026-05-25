# @k1s0-ts-http/react

React integration for `@k1s0-ts-http/core`.

## Features

- `HttpClientProvider` stores a shared `HttpClient` in React context.
- `useHttpClient` returns the current client and throws outside the provider.
- `useScopedHttpClient` creates a stable derived client with scoped `baseUrl`, headers, retry, or timeout settings.
- `useHttpQuery` runs a request, parses JSON responses when needed, aborts stale requests, and exposes `loading`, `data`, `error`, `requestId`, and `refetch`.
- `useHttpQuery` and `useHttpMutation` support `parseAs` for `auto`, `json`, `text`, `blob`, `arrayBuffer`, or `stream` response bodies.
- `useHttpMutation` exposes `mutate`, `mutateAsync`, `reset`, and latest-result state.

## Install

```bash
npm install @k1s0-ts-http/core @k1s0-ts-http/react
```

## Usage

```tsx
import { createHttpClient } from "@k1s0-ts-http/core";
import { HttpClientProvider, useHttpQuery } from "@k1s0-ts-http/react";

const client = createHttpClient({ baseUrl: "https://api.example.com" });

export function App() {
  return (
    <HttpClientProvider client={client}>
      <UserList />
    </HttpClientProvider>
  );
}

function UserList() {
const q = useHttpQuery<{ id: string; name: string }[]>({ url: "/users" });

  if (q.loading) return <div>loading...</div>;
  if (q.error) return <div>error: {q.error.message}</div>;

  return <ul>{q.data?.map((u) => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

For text or binary responses, choose the parser explicitly when needed:

```tsx
const text = useHttpQuery<string>({ url: "/status.txt" }, { parseAs: "text" });
const file = useHttpQuery<ArrayBuffer>({ url: "/export.bin" }, { parseAs: "arrayBuffer" });
```

## Build And Test

```bash
npm install
npm run typecheck
npm run build
npm test
```

The package emits ESM declarations and source maps under `dist/`.
