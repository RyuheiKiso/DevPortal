# @k1s0-ts-http/react-native

DevPortal HTTP クライアントの React Native 連携。

- `HttpClientProvider` / `useHttpClient` / `useScopedHttpClient` / `useHttpQuery` / `useHttpMutation` は `@k1s0-ts-http/react` 同等
- `resolvePlatformFetch`: `Platform.OS` 別に fetch 実装を差し替えるヘルパ（iOS/Android で異なる挙動を入れたい場合に）
- `createNetInfoAware`: `@react-native-community/netinfo`（peerDep optional）で接続状態を監視し、オフライン時の reject / オンライン復帰時の自動再開を提供

## インストール

```bash
npm install @k1s0-ts-http/core @k1s0-ts-http/react-native
```

NetInfo 連携を使う場合のみ peerDep を追加でインストール:

```bash
npm install @react-native-community/netinfo
```

## 使い方

```tsx
import { createHttpClient } from "@k1s0-ts-http/core";
import {
  HttpClientProvider,
  useHttpClient,
  useHttpQuery,
  createNetInfoAware,
  resolvePlatformFetch,
} from "@k1s0-ts-http/react-native";

const fetchImpl = resolvePlatformFetch({ default: fetch });
const baseClient = createHttpClient({
  baseUrl: "https://api.example.com",
  fetchImpl,
});

// NetInfo 連携（peerDep 未インストールでも no-op で動く）
// 戻り値は { client, dispose } で、unmount 時に dispose() を呼ぶ
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
```

`createNetInfoAware` は `@react-native-community/netinfo` を dynamic import で解決します。peerDep が未インストールなら no-op として親クライアントをそのまま返し、`dispose` も空関数になります。インストール済みなら起動時に `NetInfo.fetch()` で初期接続状態を解決した上で `addEventListener` で監視します。

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

`build` は `tsc -p tsconfig.json` で ESM (`dist/esm/`) を、`tsc -p tsconfig.cjs.json` で CJS (`dist/cjs/`) を出力する dual build です。

## publish

`prepublishOnly` で `dependencies."@k1s0-ts-http/core"` を `"file:../core"` から自身の version 文字列へ置換、`postpublish` で復元します。core → react-native の順に publish してください。

`npm pack` は `postpublish` を発火しないため、tarball 検証のみで publish しない場合は `git restore package.json` で復元してください。

## scaffold へのローカル統合

Metro は symlink を嫌うため `npm pack` で tarball を作って `npm install ./xxx.tgz` するのを推奨します。
