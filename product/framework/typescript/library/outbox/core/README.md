# @k1s0-ts-outbox/core

> **API ステータス**: `v0.1.x` は **beta** リリースです。マイナーバージョン (`0.x`) 内で
> breaking change が入る可能性があります。安定版 (`v1.0.0`) リリース時に CHANGELOG で
> 移行手順を告知します。

DevPortal 共通の Outbox パターン実装 (headless)。
HTTP 等の外部送信が失敗・遅延・オフラインでも、ローカル永続化と再送スケジューラで
**at-least-once delivery** を保証します。Idempotency-Key と Dead-Letter Queue を内蔵し、
React / React Native バインディングと組み合わせて UI からも操作可能です。

## 特長

- **永続キュー**: `KvStore<unknown>` (storage/core) を渡すだけで再起動を跨いで送信を保証
- **抽象 Publisher**: `(entry, ctx) => Promise<void>` で送信処理を完全に分離 (HTTP / gRPC / WebSocket / メッセージブローカ 等に拡張可)
- **HTTP プリセット**: `createHttpPublisher(httpClient, options)` で `@k1s0-ts-http/core` と即連携、`Idempotency-Key` ヘッダ自動付与
- **指数バックオフ + ジッタ**: 失敗時のリトライ間隔を `attempt` ごとに伸長
- **スケジューラ**: 設定された interval ごとに pending エントリを自動再送 (overlapping 防止)
- **Dead-Letter Queue**: max retries 到達時に自動隔離、`restoreFromDlq` で手動回復
- **dedupeKey 置換**: 既存 pending/failed 同 key を payload 上書きで重複防止
- **イベント購読**: appended / publishing / published / failed / movedToDlq / restored を `subscribe`

## インストール

```bash
npm install @k1s0-ts-outbox/core --registry http://localhost:4873/
```

## 使い方

```ts
import {
  createOutboxManager,
  createOutboxStorage,
  createHttpPublisher,
} from "@k1s0-ts-outbox/core";
import { createMemoryStore, withCodec, jsonCodec } from "@k1s0-ts-storage/core";
import { createHttpClient } from "@k1s0-ts-http/core";

// KvStore<unknown> を満たす任意実装。ここでは storage/core の memory + jsonCodec を使う
const kv = withCodec(jsonCodec)(createMemoryStore());
const http = createHttpClient({ baseUrl: "https://api.example.com" });

const manager = createOutboxManager<{ orderId: string }>({
  // KvStore を Outbox 用に namespace + 直列化ラップする
  storage: createOutboxStorage(kv),
  // HTTP プリセット publisher (Idempotency-Key を自動付与)
  publisher: createHttpPublisher(http, {
    resolveRequest: (entry) => ({ method: "POST", url: "/orders", body: entry.payload }),
  }),
  retry: { maxRetries: 5, backoffBaseMs: 500 },
  // autoStart: true なら起動直後にリカバリ完了を待ってから scheduler tick が走る
  scheduler: { intervalMs: 5000, autoStart: true },
});

const entry = await manager.append({ payload: { orderId: "o-1" } });
manager.subscribe((event) => console.log(event.type, event.entry?.id));
```

## API 概要

| API | 説明 |
|---|---|
| `createOutboxManager(config)` | Outbox マネージャ生成 |
| `createOutboxStorage(kv, options?)` | `KvStore` を Outbox 用に namespace + 直列化ラップ |
| `createHttpPublisher(client, options)` | HTTP 送信プリセット |
| `manager.append(input)` | エントリ追加 (Idempotency-Key 自動採番) |
| `manager.publish(id)` | 単発送信 (リトライ判定込み) |
| `manager.retry(id)` | failed/dead を pending に戻す |
| `manager.moveToDlq(id)` / `restoreFromDlq(id)` | DLQ 移動・復帰 |
| `manager.flush()` | pending 全件を一度試行 |
| `manager.purgeCompleted(olderThanMs?)` | sent 状態の完了エントリを一括削除 |
| `manager.subscribe(listener)` | イベント購読 |
| `manager.start()` / `stop()` | scheduler の起動・停止 |
| `manager.dispose()` | クリーンアップ |

## イベント種別

| `event.type` | 用途 |
|---|---|
| `appended` | append / dedupe 置換 / 復元 / 手動 retry |
| `publishing` | publish 開始 (status="publishing" 遷移) |
| `published` | publish 成功 (status="sent") |
| `failed` | publish 失敗 (リトライ予定 or DLQ 移動) |
| `movedToDlq` | DLQ 自動/手動移動 |
| `restored` | DLQ からの復帰 |
| `removed` | エントリ削除 (remove / purgeCompleted) |
| `started` / `stopped` | scheduler 起動・停止 |
| `scheduled` | scheduler tick のデバッグ用 (本番では基本的に無視可) |

## ビルド

```bash
npm run build         # ESM + CJS の dual 出力
npm run typecheck     # 型チェックのみ
```

## テスト

```bash
npm test              # 全テスト実行
npm run test:coverage # カバレッジ計測 (statements/branches/functions/lines 100% 必達)
```

カバレッジは `vitest.config.ts` で 100% を強制しています (autoUpdate:false)。

## Publish フロー (Verdaccio)

```bash
npm run clean && npm run build && npm run test:coverage
npm publish
```

`prepublishOnly` で自動的に clean → build → test:coverage が走ります。

## 依存関係

- 必須: `zod`
- 任意 (optional peer): `@k1s0-ts-storage/core` / `@k1s0-ts-http/core` / `@k1s0-ts-logger/core` / `@k1s0-ts-error/core`

storage は `KvStore<unknown>` を `import type` でしか参照しないため、`@k1s0-ts-storage/core`
を使わず独自実装の KvStore を渡すことも可能です。

## 運用上の注意

### `sent` エントリのクリーンアップ

送信成功 (`status="sent"`) したエントリは本体 KV に残り続けます (UI から履歴を見られるようにするため)。
本ライブラリは自動 cleanup を行わないので、長期運用ではユーザー側で定期的に `manager.remove(id)` を呼ぶか、
`manager.list({ status: "sent" })` で取得して一括削除してください。

### クラッシュリカバリ

アプリが publish 中にクラッシュした場合、`status="publishing"` のエントリが残ります。
これらは次回 `createOutboxManager` 起動時に自動的に `pending` に戻り、scheduler / flush の対象となります。
同一 `idempotencyKey` を保持したまま再送されるため、サーバ側の重複排除が有効ならば二重送信は防げます。

### `nextAttemptAt` の意味

- 未定義 (`undefined`): 即時試行可能
- 数値: epoch ms。`now()` 経過後に scheduler / flush で対象化される
- `failed` 状態のエントリは `now() + computeBackoff(attempt)` が設定される

### DLQ 自動アーカイブ

`dlqAutoArchive: { maxEntries: N }` を設定すると、DLQ サイズが N を超えた時点で最古エントリを FIFO 削除します。
アーカイブが走るのは「publish 失敗で DLQ に追加された直後」のみで、定期メンテナンスは行いません。

### `manager.ready()` で起動時リカバリを待つ

`autoStart=false` で利用者が手動で `flush()` / `publish(id)` を呼ぶ場合は、`await manager.ready()` を
先に呼んでリカバリ完了を待ってください。recovery 未完了で `publish(id)` を呼ぶと、まだ `publishing` 状態
のエントリは status=publishing として早期 return されてしまいます (`autoStart=true` なら scheduler は
自動的に recovery 完了を待ってから tick を開始するので不要)。

```ts
const manager = createOutboxManager({ ... });
await manager.ready(); // recovery 完了を待つ
await manager.flush();
```

### `manager.publish(id)` の冪等性

既に `sent` / `dead` / `publishing` 状態のエントリに対する `publish(id)` 呼び出しは何もせず冪等的に
現在の entry を返します。`publishing` 状態は同一プロセス内では発生しないため `recovery` 未完了の
シナリオでのみ観測されます。明示的に再試行したい場合は `retry(id)` を使ってください。

### `manager.dispose()` の挙動

- in-flight な publish の `AbortController` を abort し、scheduler を停止し、listener をクリアします
- **in-flight な Promise の完了は待ちません** (publisher が abort signal を尊重して即座に reject する想定)
- 戻り値は `Promise<void>` ですが内部処理は同期です (型 I/F の慣習)

### `OutboxEntry` の不変性 (shallow freeze)

`append()` / `publish()` / `get()` / `list()` / 各イベントの `entry` は **shallow freeze** されています。
トップレベルのプロパティ書き換えは TypeError になりますが、`entry.payload.foo = ...` のような
ネスト構造の mutation は通ります。ネスト構造の不変性が必要な場合は呼び出し側で deep freeze するか、
新しいオブジェクトを返してください。

### `OutboxError` の `cause` と `Error.cause`

`OutboxError` は ES2022 標準の `Error.prototype.cause` 互換です。`event.error.cause` には publisher が
throw した root 例外そのものが入るため、デバッグ・テレメトリ送信時に活用できます。
永続化される `OutboxEntry.lastError` は `{ message, code?, at }` のみで cause は含みません。

### イベント listener は同期前提

`manager.subscribe(listener)` の listener は **同期実行** されます。`async` 関数を渡しても
返却される `Promise` は内部で `void` され、完了は **保証されません**。listener 内で
非同期処理を行う場合は、自前で `Promise.catch` を付けてエラーを観測してください。

```ts
manager.subscribe((event) => {
  // 非同期処理は自前で fire-and-forget する
  void sendToTelemetry(event).catch((err) => console.error(err));
});
```

また、1 つの listener が長時間ブロックすると後続の listener 配信が遅延します。
listener は **軽量・短時間で完了させる** ことを推奨します。

### Cross-tab / Multi-process は サポート外

`withLock` は **メモリ内** の chain Map を用いた同一プロセス内のロックです。
複数のタブやプロセスが **同じ KvStore** (例: localStorage / 共有ファイル) を共有して
並行に publish/append すると、サーバへ二重送信が起きる可能性があります
(`Idempotency-Key` でサーバ側の重複排除は効きますが、ライブラリ層では防げません)。

複数タブシナリオを安全に運用する場合は、`BroadcastChannel` や `navigator.locks` 等で
**外部ロック** を実装するか、各 タブで namespace を分けて Outbox を独立運用してください。

### SSR (Server-Side Rendering) 互換性

サーバサイドで `OutboxProvider` を一時的にマウントする場合は、必ず
`scheduler: { autoStart: false }` を指定してください。autoStart=true だとサーバプロセス内で
`setTimeout` ベースの scheduler が起動し、レンダリングが終わってもメモリリークの原因になります。

クライアントサイドへハイドレーション後に `manager.start()` を呼び出すのが推奨パターンです。
`createOutboxManager` 内部の `crypto.randomUUID` は Node 19+ で利用可能なため、
Node 18 環境ではフォールバックが効きます (`fallbackId`)。
