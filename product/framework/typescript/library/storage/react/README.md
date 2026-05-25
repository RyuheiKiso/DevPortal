# @k1s0-ts-storage/react

DevPortal React bindings for the unified KV storage framework. ブラウザ各種ストレージのアダプタ、React Context / hooks、cross-tab 同期を提供する。

## 特長

- **4 種のアダプタ**: `localStorage` / `sessionStorage` / `IndexedDB`（自前最小実装、外部依存ゼロ） / `cookie`
- **`<StorageProvider>` + hooks**: `useStorageRegistry` / `useStorageScope` / `useStorageValue` / `useTypedSlot`
- **cross-tab 同期**: `attachStorageEvents` で `withObservable` と `storage` イベントを接続
- **SSR 安全**: `storage` / `document` を注入可能、テストもしやすい

## クイックスタート

```tsx
import {
  createMemoryStore,
  createStorageRegistry,
  withCodec,
  jsonCodec,
  withObservable,
} from "@k1s0-ts-storage/core";
import {
  createLocalStorageBackend,
  createSessionStorageBackend,
  StorageProvider,
  useStorageValue,
  attachStorageEvents,
} from "@k1s0-ts-storage/react";

// 永続スコープに JSON codec を被せた observable な store を組み立てる
const durableBase = createLocalStorageBackend();
const durable = withObservable<{ theme: string }>()(
  withCodec<string, { theme: string }>(jsonCodec<{ theme: string }>())(durableBase),
);

// cross-tab 同期を有効化 (戻り値は解除関数、アプリ終了時に呼ぶ)
attachStorageEvents(durable, {
  decode: (raw) => (raw === null ? undefined : (JSON.parse(raw) as { theme: string })),
});

// Registry を組み立てる
const registry = createStorageRegistry({
  secure: createMemoryStore(),
  durable,
  session: createSessionStorageBackend(),
  ephemeral: createMemoryStore(),
});

// Provider 配下で hook を使う
function App() {
  return (
    <StorageProvider registry={registry}>
      <ThemeSwitcher />
    </StorageProvider>
  );
}

function ThemeSwitcher() {
  const { value, setValue, loading } = useStorageValue<{ theme: string }>("durable", "preferences", {
    defaultValue: { theme: "light" },
  });
  if (loading) return <span>loading…</span>;
  return (
    <button onClick={() => setValue({ theme: value?.theme === "light" ? "dark" : "light" })}>
      {value?.theme}
    </button>
  );
}
```

## API

### バックエンドアダプタ
- `createLocalStorageBackend(opts?)` — `window.localStorage` を `KvStore<string>` 化
- `createSessionStorageBackend(opts?)` — `window.sessionStorage` を `KvStore<string>` 化
- `createIndexedDbBackend({ dbName, storeName, version?, factory? })` — 自前 IndexedDB 実装 (`KvStore<T>`)
- `createCookieBackend({ document?, defaultAttributes? })` — `document.cookie` ベース (`KvStore<string>`)

### cross-tab 連携
- `attachStorageEvents(observable, opts?)` — `window` の `storage` イベントを `KvStoreObservable.emit` に橋渡し

### React 統合
- `<StorageProvider registry={...}>` — `StorageRegistry` を DI
- `useStorageRegistry()` — Registry を取得
- `useStorageScope<T>(scope)` — 指定スコープの KvStore を取得
- `useStorageValue<T>(scope, key, { defaultValue? })` — 値を `useState` 風に保持 (cross-tab 同期込み)
- `useTypedSlot<T>(slot)` — `TypedSlot<T>` を `useState` 風に保持

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```

カバレッジ閾値は `vitest.config.ts` で 100% に固定。テスト時のみ `fake-indexeddb` を devDep として使用 (本番依存ゼロ)。
