# @k1s0-ts-outbox/react-native

> **API ステータス**: `v0.1.x` は **beta** リリース。breaking change の可能性あり。

`@k1s0-ts-outbox/core` の React Native バインディング。
`react` 版と同じ Provider / hooks に加えて、`@react-native-async-storage/async-storage` 用の
KvStore アダプタを同梱しています。

## インストール

```bash
npm install @k1s0-ts-outbox/react-native --registry http://localhost:4873/
npm install @react-native-async-storage/async-storage
```

## 使用例

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OutboxProvider,
  createAsyncStorageKvStore,
  useOutbox,
} from "@k1s0-ts-outbox/react-native";
import { createOutboxStorage, createHttpPublisher } from "@k1s0-ts-outbox/core";

const kv = createAsyncStorageKvStore(AsyncStorage);
const storage = createOutboxStorage(kv);

function App() {
  return (
    <OutboxProvider config={{ storage, publisher: createHttpPublisher(http, { ... }) }}>
      <Screen />
    </OutboxProvider>
  );
}
```

## 提供 API

| API | 説明 |
|---|---|
| `<OutboxProvider>` | react 版と同一 |
| `useOutbox*` hooks | react 版と同一 |
| `createAsyncStorageKvStore(storage, options?)` | AsyncStorage を KvStoreLike に適合させる |
