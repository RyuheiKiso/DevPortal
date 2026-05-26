# @k1s0-ts-outbox/react

> **API ステータス**: `v0.1.x` は **beta** リリース。breaking change の可能性あり。
> SSR で利用する場合は `config.scheduler.autoStart: false` を指定し、ハイドレーション後に
> `manager.start()` を呼んでください (詳細は `@k1s0-ts-outbox/core` の README を参照)。

`@k1s0-ts-outbox/core` の React バインディング。Provider と hook を提供します。

## インストール

```bash
npm install @k1s0-ts-outbox/react --registry http://localhost:4873/
```

## 使用例

```tsx
import { OutboxProvider, useOutbox, useOutboxList, useOutboxControls } from "@k1s0-ts-outbox/react";
import { createOutboxStorage, createHttpPublisher } from "@k1s0-ts-outbox/core";

const config = {
  storage: createOutboxStorage(kv),
  publisher: createHttpPublisher(http, { resolveRequest: ... }),
};

function App() {
  return (
    <OutboxProvider config={config}>
      <Page />
    </OutboxProvider>
  );
}

function Page() {
  const list = useOutboxList();
  const { start, stop, flush } = useOutboxControls();
  return (
    <ul>
      {list.map((e) => <li key={e.id}>{e.id}: {e.status}</li>)}
    </ul>
  );
}
```

## 提供 API

| API | 説明 |
|---|---|
| `<OutboxProvider config={...}>` / `manager={...}` | Manager を Context に流す |
| `useOutbox()` | Manager 本体を取得 |
| `useOutboxList(opts?)` | エントリ一覧を購読 (自動再フェッチ) |
| `useOutboxEntry(id)` | 単一エントリを購読 |
| `useOutboxStatus(id)` | status だけを購読 |
| `useOutboxControls()` | `{ start, stop, flush }` を返す |
| `useOutboxAppend()` | memoized な `append` 関数を返す |
| `useOutboxEvents(listener)` | イベント購読を自動ライフサイクル化 |

## テスト・ビルド

```bash
npm run typecheck && npm run build && npm test
```
