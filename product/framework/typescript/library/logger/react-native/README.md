# @k1s0-ts-logger/react-native

DevPortal 構造化ロガーの React Native 連携（`@k1s0-ts-logger/core` の補助層）。

- `LoggerProvider` + `useLogger` / `useScopedLogger`
- `resolvePlatformTransports` で `Platform.OS` 別にトランスポートを差し替え
- `installGlobalErrorHandler` で RN の `ErrorUtils` 経由のグローバル例外を Logger に流す

## インストール

```bash
npm install @k1s0-ts-logger/core @k1s0-ts-logger/react-native
```

`react`, `react-native` は peer dependency です。

## 使い方

### Provider + hook

```tsx
import { createLogger, createConsoleTransport } from "@k1s0-ts-logger/core";
import { LoggerProvider, useLogger } from "@k1s0-ts-logger/react-native";

const logger = createLogger({
  env: __DEV__ ? "dev" : "prod",
  envLevels: { dev: "debug", prod: "warn" },
  transports: [createConsoleTransport()],
});

export function App() {
  return (
    <LoggerProvider logger={logger}>
      <Main />
    </LoggerProvider>
  );
}

function Main() {
  const log = useLogger();
  log.info("rendered");
  return null;
}
```

### Platform 別トランスポート

```ts
import {
  createLogger,
  createConsoleTransport,
  createStorageTransport,
  createRemoteTransport,
} from "@k1s0-ts-logger/core";
import { resolvePlatformTransports } from "@k1s0-ts-logger/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// AsyncStorage を StorageAdapter として薄くラップ
const asyncStorageAdapter = {
  getItem: (k: string) => AsyncStorage.getItem(k),
  setItem: (k: string, v: string) => AsyncStorage.setItem(k, v),
  removeItem: (k: string) => AsyncStorage.removeItem(k),
};

const transports = resolvePlatformTransports({
  default: [
    createConsoleTransport(),
    createStorageTransport({ storage: asyncStorageAdapter }),
  ],
  ios: [
    createConsoleTransport(),
    createStorageTransport({ storage: asyncStorageAdapter }),
    createRemoteTransport({ endpoint: "https://logs.example.com/ios" }),
  ],
  android: [
    createConsoleTransport(),
    createStorageTransport({ storage: asyncStorageAdapter }),
    createRemoteTransport({ endpoint: "https://logs.example.com/android" }),
  ],
  windows: [createConsoleTransport()],
  macos: [createConsoleTransport()],
});

const logger = createLogger({ env: "prod", transports });
```

`@react-native-async-storage/async-storage` は本パッケージの依存に含めていません。アプリ側で導入し、上記のように `StorageAdapter` 形へラップしてください。

### グローバル例外ハンドラ

```ts
import { installGlobalErrorHandler } from "@k1s0-ts-logger/react-native";

const unsubscribe = installGlobalErrorHandler(logger, {
  fatalLevel: "fatal",
  nonFatalLevel: "error",
  callPreviousHandler: true,
});
// 解除時は直前のハンドラに戻す
unsubscribe();
```

`callPreviousHandler` 既定値は `true`（赤画面表示を維持）。RN ランタイムが提供する `ErrorUtils` が無い環境では何もせず no-op の解除関数を返します。

**unsubscribe の安全性**: 解除関数は呼び出し時点で `ErrorUtils.getGlobalHandler()` を確認し、**自身が install した handler のままの場合のみ** `previous` に復元します。別の caller が後から `setGlobalHandler` で上書きしていた場合は、その新しい handler を尊重して何もしません（LIFO 順序前提のリストア事故を防止）。

`useScopedLogger` は `react` 版と同じく `useRef` ベースの構造比較を採用しており、BigInt / 循環参照 / 関数 を含む context でも安全に動作します。

## ビルド構成

```bash
npm install
npm run typecheck
npm run build  # ESM (dist/esm) + CJS (dist/cjs) を生成
```

このパッケージは **dual build (ESM + CJS)** です。Metro / Jest どちらからも安全に解決できるよう、`package.json` の `type` フィールドは意図的に指定していません（`.js` を CJS と解釈させ、`main` 経由でロードさせる）。

| 出力 | パス |
|------|------|
| ESM  | `dist/esm/*` (`.js` + `.d.ts`) |
| CJS  | `dist/cjs/*` (`.js`) |

`tsconfig.cjs.json` は `tsconfig.json` を `extends` し、`module: CommonJS` と `outDir: ./dist/cjs` の差分のみ持ちます。型定義は ESM 側でのみ生成します。

## Verdaccio publish の順序と自動化

`core` を先に publish した後、`prepublishOnly` で `file:../core` をバージョン文字列に置換し、`postpublish` で `file:../core` に戻す自動化が入っています。

```bash
# core publish 後
npm version <patch|minor|major>
npm publish --registry http://<verdaccio>
```

publish 失敗時に `postpublish` が走らないと `dependencies."@k1s0-ts-logger/core"` がバージョン文字列のまま残るので、手動で `"file:../core"` に戻してください。

## scaffold へのローカル統合手順

`product/scaffold/react_native` で動作確認する場合、Metro が symlink を嫌うため **tarball install** を推奨します。

```bash
# core / react-native の順で pack
cd product/framework/typescript/logger/core && npm pack
cd ../react-native && npm pack

# scaffold 側で install
cd ../../../../scaffold/react_native
npm install ../../framework/typescript/logger/core/k1s0-ts-logger-core-0.1.0.tgz
npm install ../../framework/typescript/logger/react-native/k1s0-ts-logger-react-native-0.1.0.tgz
```

`index.js` を以下のように組み立てます。

```tsx
import { AppRegistry, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLogger, createConsoleTransport, createStorageTransport, createRemoteTransport } from "@k1s0-ts-logger/core";
import { LoggerProvider, installGlobalErrorHandler, resolvePlatformTransports } from "@k1s0-ts-logger/react-native";
import App from "./App";
import { name as appName } from "./app.json";

const asyncStorageAdapter = {
  getItem: (k: string) => AsyncStorage.getItem(k),
  setItem: (k: string, v: string) => AsyncStorage.setItem(k, v),
  removeItem: (k: string) => AsyncStorage.removeItem(k),
};

const transports = resolvePlatformTransports({
  default: [createConsoleTransport(), createStorageTransport({ storage: asyncStorageAdapter })],
  windows: [createConsoleTransport()],
});

const logger = createLogger({
  env: __DEV__ ? "dev" : "prod",
  envLevels: { dev: "debug", prod: "warn" },
  tags: [`platform:${Platform.OS}`],
  transports,
});
installGlobalErrorHandler(logger);

AppRegistry.registerComponent(appName, () => (props) => (
  <LoggerProvider logger={logger}>
    <App {...props} />
  </LoggerProvider>
));
```

## ビルド & テスト

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

- `react-native` の `Platform` は `vi.doMock` で差し替え（各テストで OS を切替）
- `ErrorUtils` は `globalThis` 直書きの fake で差し替え（テスト後 `delete` で復元）

