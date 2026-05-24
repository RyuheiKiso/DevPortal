# @k1s0-ts-http/react

DevPortal HTTP クライアントの React 連携。

- `HttpClientProvider`: Context に `HttpClient` を流す Provider
- `useHttpClient`: Context から `HttpClient` を取り出す Hook（Provider 外なら明示エラー）
- `useScopedHttpClient`: 親クライアントに baseUrl / headers / retry / timeout を局所上書きした派生クライアントを取得
- `useHttpQuery`: GET 等の軽量クエリ Hook（loading / data / error / requestId / refetch）。前回の request は次回 fetch 時に AbortController で打ち切り
- `useHttpMutation`: POST 等の mutation Hook（loading / data / error / mutate / reset）

このパッケージは `@k1s0-ts-http/core` の上にだけ依存する薄いレイヤです。`react` は peerDependency（>= 18）として扱います。

## インストール

```bash
npm install @k1s0-ts-http/core @k1s0-ts-http/react
```

## 使い方

```tsx
import { createHttpClient } from "@k1s0-ts-http/core";
import { HttpClientProvider, useHttpClient, useHttpQuery } from "@k1s0-ts-http/react";

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

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

## publish

`prepublishOnly` で `dependencies."@k1s0-ts-http/core"` を `"file:../core"` から自身の version 文字列へ置換、`postpublish` で復元します。core → react の順に publish してください。

`npm pack` は `postpublish` を発火しないため、tarball 検証のみで publish しない場合は `git restore package.json` で復元してください。
