# @k1s0-ts-storage/core

DevPortal 共通の統一 KV ストレージ抽象。Web / React Native / Node を問わず単一の非同期 I/F (`KvStore<T>`) で扱い、合成可能なミドルウェア (namespace / codec / ttl / migration / observable / quota / audit / encryption) と機密度別レジストリで業務システム基盤を構築する。

## 特長

- **統一非同期 I/F**: `localStorage`・`AsyncStorage`・`SecureStore`・`IndexedDB`・メモリ — どのバックエンドも `KvStore<T>` で扱える
- **合成可能なミドルウェア**: `withNamespace` / `withCodec` / `withTtl` / `withMigration` / `withObservable` / `withQuotaGuard` / `withAudit` / `withEncryption` を関数合成で積み上げる
- **TypedSlot**: 「1 キー = 1 型」の `auth.TokenStore` のようなユースケースを抽象化
- **業務システム向け**: 機密度別レジストリ (`secure` / `durable` / `session` / `ephemeral`)、選択的クリア、マイグレーション、暗号化、監査
- **`Error` 継承ではなく plain object** でエラー表現 (JSON 化・transport 送信が容易)

## クイックスタート

```ts
// メモリストアに JSON codec を被せて型付きで使う
import { createMemoryStore, createTypedSlot, jsonCodec, withCodec, withNamespace } from "@k1s0-ts-storage/core";

// 文字列ストア + JSON codec で User 型を取り扱う
type User = { id: string; name: string };
const inner = createMemoryStore<string>();
const userStore = withCodec<string, User>(jsonCodec<User>())(withNamespace<string>("app")(inner));

// set / get
await userStore.set("current", { id: "u1", name: "Alice" });
const user = await userStore.get("current"); // { id: "u1", name: "Alice" }

// auth の TokenStore 相当 (1 キー = 1 型)
type Tokens = { accessToken: string; expiresAt: number };
const tokenSlot = createTypedSlot(createMemoryStore<Tokens>(), "tokens");
await tokenSlot.set({ accessToken: "abc", expiresAt: Date.now() + 60_000 });
```

## API (Phase 1)

### バックエンド

#### `createMemoryStore<T>(initial?)`
メモリ上に値を保持する `KvStore<T>`。`subscribe` / `keys` / `clear` / `has` 全機能を提供。テスト・SSR・`ephemeral` スコープに最適。

#### `createSyncBacked(sync: SyncStorage)`
`localStorage` 互換の同期/非同期 Storage を `KvStore<string>` に昇格する。`length` と `key(i)` が両方提供されている場合のみ `keys` と `clear` が利用できる。

### 単一キー型付き

#### `createTypedSlot<T>(store: KvStore<T>, key: string)`
KvStore の特定キーを `TypedSlot<T>` として公開する。auth の `TokenStore` はこの形に等しい。

#### `asKvStore<T>(slot: TypedSlot<T>, key: string)`
逆方向。`TypedSlot<T>` を最小 KvStore に変換する。

### ミドルウェア

#### `withNamespace<T>(prefix)`
すべてのキーに `prefix + ":"` を付与する。`keys` / `clear` / `subscribe` は prefix 配下のみに作用する。空 prefix は素通し。

#### `withCodec<I, O>(codec)`
内側 `KvStore<I>` (通常 `string`) と外側 `KvStore<O>` を `codec` で接続。`jsonCodec<O>()` を被せれば任意の型を文字列バックエンドに格納できる。

#### `jsonCodec<T>({ replacer?, reviver?, space? })`
JSON.stringify ベースの codec。既定 replacer は `Error` を `{ name, message, stack }` に展開する (循環参照や function 等は標準動作)。

#### `stringCodec()`
identity codec。型を `KvStore<string>` に固定する no-op。

#### `base64Codec()`
`Uint8Array` を base64 文字列に変換する codec。暗号化レイヤの出力を文字列バックエンドに収めるときに使う。

### エラー

`createQuotaError` / `createNotAvailableError` / `createMigrationError` および対応する `isXxx` 型ガード、`isQuotaExceededLike` (`DOMException` 検出)、`toAppErrorShape` (`@k1s0-ts-error/core` 互換シリアライザ) を提供。

## 後続フェーズ

Phase 2 で `withTtl` / `withMigration` / `withObservable` / `withReadThroughCache` を、Phase 3 で `withQuotaGuard` / `withAudit` / `withEncryption` / `createAesGcmProvider` / `createStorageRegistry` を追加予定。

## Build And Test

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
```

カバレッジ閾値は `vitest.config.ts` で 100% に固定。`autoUpdate: false` で後退検知。
