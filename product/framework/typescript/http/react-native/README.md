# @k1s0-ts-http/react-native

React Native integration for `@k1s0-ts-http/core`.

## Features

- Re-exports the provider and hooks from the React integration.
- `useHttpQuery` and `useHttpMutation` support `parseAs` for JSON, text, binary, and stream response bodies.
- `resolvePlatformFetch` selects an iOS, Android, or default `fetch` implementation.
- `createNetInfoAware` optionally integrates with `@react-native-community/netinfo` to reject or queue requests while offline.
- Dual ESM/CommonJS build with a `react-native` export condition.

## Install

```bash
npm install @k1s0-ts-http/core @k1s0-ts-http/react-native
```

Install NetInfo only when offline-aware behavior is needed:

```bash
npm install @react-native-community/netinfo
```

## Usage

```tsx
import { useEffect } from "react";
import { createHttpClient } from "@k1s0-ts-http/core";
import {
  HttpClientProvider,
  createNetInfoAware,
  resolvePlatformFetch,
  useHttpQuery,
} from "@k1s0-ts-http/react-native";

const fetchImpl = resolvePlatformFetch({ default: fetch });
const baseClient = createHttpClient({
  baseUrl: "https://api.example.com",
  fetchImpl,
});

const { client, dispose } = await createNetInfoAware(baseClient, {
  rejectWhenOffline: true,
});

export function App() {
  useEffect(() => dispose, []);

  return (
    <HttpClientProvider client={client}>
      <UserList />
    </HttpClientProvider>
  );
}

function UserList() {
  const q = useHttpQuery<{ id: string; name: string }[]>({ url: "/users" });
  return null;
}
```

If `@react-native-community/netinfo` is not installed, `createNetInfoAware()` returns the original client and a no-op `dispose`.

## Build And Test

```bash
npm install
npm run typecheck
npm run build
npm test
```

The package emits ESM under `dist/esm`, CommonJS under `dist/cjs`, declarations, and source maps.
