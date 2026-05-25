# @k1s0-ts-storage/react-native

DevPortal React Native bindings for the unified KV storage framework. AsyncStorage / expo-secure-store / react-native-keychain / MMKV のアダプタと、React Context / hooks を提供する。

## 特長

- **4 種のアダプタ**: `AsyncStorage` / `expo-secure-store` / `react-native-keychain` (perKey / singleService) / `MMKV`
- **`<StorageProvider>` + hooks**: Web 版と同じ API (`useStorageValue` / `useTypedSlot`)
- **モジュール依存はすべて duck-type 注入** (peerDependencies / peerDependenciesMeta で optional 化、テスト容易化、bundle 影響ゼロ)

## クイックスタート

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { MMKV } from "react-native-mmkv";
import {
  createMemoryStore,
  createStorageRegistry,
  createTypedSlot,
  withCodec,
  jsonCodec,
} from "@k1s0-ts-storage/core";
import {
  createAsyncStorageBackend,
  createExpoSecureStoreBackend,
  createMmkvBackend,
  StorageProvider,
  useStorageValue,
} from "@k1s0-ts-storage/react-native";

// 各バックエンドを KvStore に正規化
const durable = createAsyncStorageBackend(AsyncStorage);
const secure = createExpoSecureStoreBackend(SecureStore);
const session = createMmkvBackend(new MMKV({ id: "session" }));

// Registry を組み立てる
const registry = createStorageRegistry({
  secure,
  durable,
  session,
  ephemeral: createMemoryStore(),
});

// App ルートで Provider を被せる
function App() {
  return (
    <StorageProvider registry={registry}>
      <ThemeSwitcher />
    </StorageProvider>
  );
}

// hook で値を扱う
function ThemeSwitcher() {
  const codec = jsonCodec<{ theme: string }>();
  const slot = createTypedSlot(
    withCodec<string, { theme: string }>(codec)(durable),
    "preferences",
  );
  const { value, setValue } = useTypedSlot(slot);
  // ...
}
```

## API

### バックエンドアダプタ
- `createAsyncStorageBackend(asyncStorage)` — `@react-native-async-storage/async-storage` 互換オブジェクトを `KvStore<string>` 化
- `createExpoSecureStoreBackend(secureStore)` — `expo-secure-store` 互換オブジェクトを `KvStore<string>` 化 (機密データ向け)
- `createKeychainBackend(keychain, opts?)` — `react-native-keychain` を `KvStore<string>` 化
  - `mode: "perKey"` (既定): key 1 つにつき service 1 つ
  - `mode: "singleService"`: 単一 service に JSON マップで保存 (Android Keystore の制約緩和向け)
- `createMmkvBackend(mmkv)` — `react-native-mmkv` の同期 API を `KvStore<string>` 化

### React 統合
- `<StorageProvider registry={...}>` — `StorageRegistry` を DI
- `useStorageRegistry()` — Registry を取得
- `useStorageScope<T>(scope)` — 指定スコープの KvStore を取得
- `useStorageValue<T>(scope, key, { defaultValue? })` — 値を `useState` 風に保持
- `useTypedSlot<T>(slot)` — `TypedSlot<T>` を `useState` 風に保持

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```

カバレッジ閾値は `vitest.config.ts` で 100% に固定。テストは全アダプタの duck-type モック注入で行い、実機 verify は別途。
