# @k1s0-ts-logger/react

DevPortal 構造化ロガーの React 連携（`@k1s0-ts-logger/core` の補助層）。

- `LoggerProvider` で Logger を Context に流す
- `useLogger` / `useScopedLogger` でコンポーネントから Logger を取り出す
- `ErrorBoundary` でレンダリングエラーを自動ログ化
- `installGlobalHandlers` で `window.onerror` / `unhandledrejection` を Logger に流す

## インストール

```bash
npm install @k1s0-ts-logger/core @k1s0-ts-logger/react
```

## 使い方

### Provider と hook

```tsx
import { createLogger, createConsoleTransport } from "@k1s0-ts-logger/core";
import { LoggerProvider, useLogger, useScopedLogger } from "@k1s0-ts-logger/react";

const logger = createLogger({
  env: "dev",
  defaultMinLevel: "debug",
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
  const reqLog = useScopedLogger({ tags: ["req"], context: { reqId: "1" } });
  log.info("rendered");
  reqLog.debug("started");
  return <div />;
}
```

### ErrorBoundary

```tsx
import { ErrorBoundary } from "@k1s0-ts-logger/react";

<ErrorBoundary
  logger={logger}
  fallback={<div>Something went wrong</div>}
  resetKeys={[locationKey]}
>
  <App />
</ErrorBoundary>
```

- `fallback` には関数（`(error) => ReactNode`）も渡せます。
- `onError` を併用すると独自の通知も組み込めます。
- `resetKeys` のいずれかの要素が `Object.is` 比較で変化すると、error 状態を自動でクリアして children を再描画します（ルートに置いた場合、ページ遷移後も永続 fallback にならない）。
- `componentDidCatch` 内で `logger.error` や `onError` が throw しても boundary 自体は壊れません（呼出失敗は `console.warn` で 1 行漏らすのみ）。

### グローバルエラーキャプチャ

```ts
import { installGlobalHandlers } from "@k1s0-ts-logger/react";

const unsubscribe = installGlobalHandlers(logger, { fatalForUnhandled: false });
// 解除（HMR や testing で必要なら）
unsubscribe();
```

SSR 環境（`window` が存在しない）では何もせず no-op の解除関数を返します。

同じ `logger` インスタンスで `installGlobalHandlers` を再呼び出しすると、内部で前回登録を自動解除してから新規登録します（HMR や React StrictMode の二重マウントで listener が増殖するのを防ぎます）。

#### 内部アクティブハンドル管理（HMR / 多重バージョン共存に関する注意）

- アクティブハンドル管理は `Symbol.for("@k1s0-ts-logger/react:activeUninstalls")` を使い `window` 上の共有 `WeakMap` に保持します。HMR でモジュールが再評価されても、同じ logger インスタンスへの再 install 時に前回の listener を自動解除できます（R5/R12）。
- **同一バージョン推奨**: 同じアプリ内に複数バージョンの `@k1s0-ts-logger/react` がロードされる（npm hoisting の事故 / 異なる micro-frontend）と、それぞれが同じ Symbol キーを共有しつつも `Logger` インスタンス参照が別になるため、相互の listener 解除が効かないことがあります。**バージョンは単一に統一**してください（D5）。
- **旧バージョン → 新バージョンの HMR 初回切替**: 旧版（Symbol.for 未対応）でビルドされた状態に新版を流し込む初回 HMR では、旧版の listener が一度だけ二重登録される可能性があります。事前に明示的に旧版の `uninstall()` を呼んでから新版で再 install することを推奨します（D6）。
- **frozen window / SES Lockdown 環境**: `window` の固定 Symbol キーへの代入が拒否される環境では、モジュールスコープのフォールバック `WeakMap` を自動で使います（R5）。install 自体が throw することはありません。

`useScopedLogger` は内部で `useRef` ベースの構造比較（`tags` と `context` のキー / 値を `Object.is` で比較）を行います。BigInt / 循環参照 / 関数 を含む context を渡しても、render 中に `JSON.stringify` が throw することはありません。

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

出力は `dist/`（ESM + `.d.ts`）。テストは core 側でまとめて担保しています。

## Verdaccio publish の順序と自動化

`@k1s0-ts-config` と同じく、依存先 `@k1s0-ts-logger/core` を先に publish する必要があります。`prepublishOnly` で `file:../core` をバージョン文字列に置換し、`postpublish` で `file:../core` に戻す自動化が入っています。

```bash
# core publish 後
npm version <patch|minor|major>
npm publish --registry http://<verdaccio>
```

publish 失敗時に `postpublish` が走らず `dependencies."@k1s0-ts-logger/core"` がバージョン文字列のまま残ったら、手動で `"file:../core"` に戻してください（`git diff package.json` で確認）。

## scaffold へのローカル統合手順

core と同様に `npm pack` か `file:` 依存を利用します。`product/scaffold/react/package.json` で `@k1s0-ts-logger/core` と `@k1s0-ts-logger/react` を依存に追加し、`main.tsx` を以下のように組み立てます。

```tsx
import { createLogger, createConsoleTransport, createStorageTransport, createRemoteTransport } from "@k1s0-ts-logger/core";
import { LoggerProvider, ErrorBoundary, installGlobalHandlers } from "@k1s0-ts-logger/react";

const localStorageAdapter = {
  getItem: (k: string) => window.localStorage.getItem(k),
  setItem: (k: string, v: string) => window.localStorage.setItem(k, v),
  removeItem: (k: string) => window.localStorage.removeItem(k),
};

const logger = createLogger({
  env: import.meta.env.PROD ? "prod" : "dev",
  envLevels: { dev: "debug", prod: "warn" },
  tags: ["app:scaffold-react"],
  transports: [
    createConsoleTransport(),
    createStorageTransport({ storage: localStorageAdapter, maxEntries: 500 }),
    createRemoteTransport({ endpoint: "/api/logs" }),
  ],
});
installGlobalHandlers(logger);

createRoot(document.getElementById("root")!).render(
  <LoggerProvider logger={logger}>
    <ErrorBoundary logger={logger} fallback={<div>Error</div>}>
      <App />
    </ErrorBoundary>
  </LoggerProvider>,
);
```

## ビルド & テスト

- `npm install` — 初回のみ依存解決
- `npm run typecheck` — `tsconfig.typecheck.json`（sibling `@k1s0-ts-logger/core` を `paths` で直結）
- `npm run test` / `npm run test:coverage` — Vitest + react-test-renderer + jsdom（coverage **statements/branches/functions/lines = 100% 強制**、`autoUpdate: false`）
- `npm run build` — ESM 出力（`dist/`）

