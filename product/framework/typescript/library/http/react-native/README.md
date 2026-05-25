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

dual build（ESM + CJS）で出力します。

- `dist/esm/`: ESM + `.d.ts`（`package.json` の `"type": "module"` で `.js` を ESM 解決）
- `dist/cjs/`: CJS（Metro / Jest が `require()` で取得、ビルド時に `dist/cjs/package.json` へ `{"type":"commonjs"}` を書き出し）

```bash
npm install                      # 初回のみ依存解決
npm run typecheck                # tsconfig.typecheck.json（sibling core を paths で直結）
npm run test                     # Vitest + react-test-renderer
npm run test:coverage            # statements/branches/functions/lines = 100% 強制（autoUpdate: false）
npm run build                    # esm + cjs を生成
```

- `react-native` の `Platform` は各テストで `vi.mock("react-native", ...)` で差し替え（rollup が実物の `index.js.flow` を解析できないため必須）
- `@react-native-community/netinfo` は `vi.mock` で fake 化し、`fetch` / `addEventListener` の挙動を制御
