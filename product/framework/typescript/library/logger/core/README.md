# @k1s0-ts-logger/core

DevPortal 共通の構造化ロガー（コア機能）。

- 6 段階のログレベル（trace / debug / info / warn / error / fatal）
- 環境別（dev / staging / prod）の最小レベルフィルタ
- 構造化ログ（タグ・コンテキスト・メタデータ・Error 正規化）
- 親子バインディング（`logger.child({tags, context})`）
- 差し替え可能な複数トランスポート
  - `createConsoleTransport`（console 出力）
  - `createStorageTransport`（任意の KV ストアに永続化）
  - `createRemoteTransport`（fetch ベースの HTTP 送信、バッチ・指数バックオフ・リトライ）
- カスタムトランスポート向けの汎用バッファ（`createBatcher`）
- zod による設定値スキーマ validation

このパッケージは UI フレームワーク非依存です。React 連携は `@k1s0-ts-logger/react`、React Native は `@k1s0-ts-logger/react-native` を利用してください。

## インストール

```bash
npm install @k1s0-ts-logger/core
```

社内 Verdaccio を利用する場合は、リポジトリの `.npmrc` で registry を `http://<verdaccio-host>:<port>` に向けてください。

## 公開 API

### Logger の生成

```ts
import {
  createLogger,
  createConsoleTransport,
  createStorageTransport,
  createRemoteTransport,
} from "@k1s0-ts-logger/core";

const logger = createLogger({
  env: "prod",
  envLevels: { dev: "debug", staging: "info", prod: "warn" },
  tags: ["app:web"],
  context: { version: "1.0.0" },
  transports: [
    createConsoleTransport(),
    createStorageTransport({ storage: localStorageAdapter, maxEntries: 500 }),
    createRemoteTransport({ endpoint: "/api/logs", flushSize: 20, flushIntervalMs: 5000 }),
  ],
});

logger.info("user signed in", { userId: "u-1" });
logger.error("payment failed", { error: new Error("invalid card"), orderId: "o-9" });

// リクエスト単位の子 logger
const reqLog = logger.child({ tags: ["req"], context: { reqId: "r-1" } });
reqLog.warn("retrying");

// 終了時には flush して残バッファを送出
await logger.flush();
await logger.dispose();
```

### ログレベルとフィルタ

```ts
import { LOG_LEVELS, compareLevel, shouldLog, resolveMinLevel, createLevelFilter } from "@k1s0-ts-logger/core";

// 順序 (trace<debug<info<warn<error<fatal) で比較
compareLevel("warn", "info"); // > 0
shouldLog("warn", "info");    // true

// env -> 最小レベルの解決
resolveMinLevel("prod", { prod: "warn" }); // "warn"
```

### Transport 契約

`Transport` は次のインターフェースを満たせばよいので、カスタム実装も簡単に作れます。

```ts
import type { Transport } from "@k1s0-ts-logger/core";

const myTransport: Transport = {
  name: "custom",
  write(entry) { /* 1 件を出力 */ },
  async flush() { /* 任意: バッファを送出 */ },
  async dispose() { /* 任意: リソース解放 */ },
};
```

### バッファ機構

カスタム送信系トランスポートを書くときは `createBatcher` を利用できます。

```ts
import { createBatcher } from "@k1s0-ts-logger/core";

const batcher = createBatcher<MyItem>({
  flushSize: 20,
  flushIntervalMs: 5000,
  onFlush: async (items) => { /* まとめて送信 */ },
});
```

### スキーマ validation

```ts
import { loggerConfigSchema, validateLoggerConfig } from "@k1s0-ts-logger/core";

const valid = validateLoggerConfig({
  env: "dev",
  envLevels: { dev: "debug" },
  defaultMinLevel: "info",
  tags: ["app"],
  context: { version: "1.0" },
});
// 失敗時は ZodError を throw
```

## 動作の重要な仕様

- **`logger.flush()` と `logger.dispose()` は root logger でのみ有効**。`logger.child(...)` 経由で得られた派生 logger の `flush()` / `dispose()` は no-op（型は維持、内部で `isRoot` 判定）。共有 transports を子から不意に停止させないため。
- **`flush()` / `dispose()` は失敗を伝える**。transport のいずれかが reject すると `AggregateError`（`errors` プロパティに個別エラー）として例外を投げます。`onTransportError` も並行して呼ばれます。
- **`flush()` は進行中の非同期 write の完了を待ちます**。`logger.info(...); await logger.flush();` の順で書けば、storage 等の async transport の `write` が完走したことを保証します。
- **`entry.tags` と `entry.context` は『undefined または非空』に正規化される**（R8）。`createLogger({ tags: [] })` のように空配列で初期化しても、最終 entry では `tags: undefined` として transport に流れます（JSON 化時にフィールドが消える）。下流の serializer / schema 検証で「空配列」と「未設定」を分けたい場合は注意してください。
- **`logger.child({ context: { key: undefined } })` で親の同名キーは消えません**（R9）。`undefined` 値は浅マージ時にフィルタされます。明示的な unset が必要なら別 API を検討してください。
- **`createStorageTransport` は内部キューで write を直列化**。並行 `logger.info(...)` で entry を取りこぼしません。`flush()` / `dispose()` は末尾までの完了を保証し、直近の write エラーは `flush()` / `dispose()` から再 throw されます（R3）。
- **`createStorageTransport` で配列でない既存値が見つかった場合**、既定では write を reject して既存値を温存します（旧スキーマ / 他ライブラリと衝突した値を破壊しない）。自動回復したい場合は `onCorruptedValue: "overwrite"` を指定してください（R4）。
- **`createRemoteTransport`** は dispose 中に進行中の HTTP 送信を待ち、リトライバックオフ待機は即時中断します（初回送信は完了させ、リトライは打ち切り）。dispose 中に発生した一時失敗は `onDisposedDrop` で通知できます（R6、未指定なら静かに drop）。
- **`onPermanentFailure` は `shouldRetry=false` 由来の永続失敗（4xx 等）のみを通知します**。dispose 中断由来の一時失敗は `onDisposedDrop` に分離されています（契約上の区別が必要な dead-letter 実装向け）。
- **`createBatcher`** は `onFlush` が reject した場合、対象 items を buffer 先頭に戻し、`flushIntervalMs` 設定時は指数バックオフでタイマーを再起動します（R7、上限は `maxFlushIntervalMs`、既定は `flushIntervalMs * 32`）。dispose 後は `push` / `startTimer` が no-op になります（R2）。

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

出力は `dist/`（ESM + `.d.ts`）。コメントは `removeComments: true` で除去されます。

## テスト・カバレッジ

vitest で単体テストを実行できます。

```bash
npm test              # 1 回だけ走らせる
npm run test:watch    # ファイル変更を監視
npm run test:coverage # カバレッジ計測（@vitest/coverage-v8）
```

カバレッジ計測の方針は `vitest.config.ts` に定義しています。

- provider: `v8`（istanbul より低オーバーヘッド）
- 計測対象: `src/**/*.ts`
- 除外: `*.test.ts` / `src/types.ts`（型のみ）/ `src/index.ts`（re-export のみ）
- 閾値: `statements` / `branches` / `functions` / `lines` を **すべて 100%** に設定（後退検知のため）

`prepublishOnly` は `clean → build → test:coverage` の順で動くため、カバレッジ閾値を割ると publish できません。閾値を満たせない変更を入れる場合は、不足ケースのテスト追加で対応してください。

## Verdaccio publish の順序

3 パッケージは内部依存があるため **以下の順序で publish** する必要があります。

```
1. core を npm version bump（例: npm version patch） → npm publish --registry http://<verdaccio>
2. react / react-native の version を core と一致させる（手動 or npm version で同期）
3. react を npm publish（prepublishOnly が file:../core を core のバージョン文字列に書き換え、
   postpublish で file:../core に戻す）
4. react-native を npm publish（同上）
```

**注意**: publish 失敗時は `postpublish` が走らず、`package.json` の `dependencies."@k1s0-ts-logger/core"` が `"0.1.0"` のような version 文字列のまま残る可能性があります。その場合は手動で `"file:../core"` に戻してください（`git diff package.json` で確認）。

## scaffold へのローカル統合手順

`product/scaffold/react` や `product/scaffold/react_native` でローカル動作確認する場合は、以下のいずれかを利用します（推奨は 1）。

1. **tarball install（最も再現性高い）**
   ```bash
   cd product/framework/typescript/logger/core
   npm pack
   # => k1s0-ts-logger-core-0.1.0.tgz
   cd ../../../../scaffold/react
   npm install ../../framework/typescript/logger/core/k1s0-ts-logger-core-0.1.0.tgz
   ```

2. **`file:` プロトコル依存**
   ```json
   {
     "dependencies": {
       "@k1s0-ts-logger/core": "file:../../framework/typescript/logger/core"
     }
   }
   ```

3. **npm link**（Web/Vite では OK、Metro 経由の RN では symlink を嫌うため非推奨）
   ```bash
   cd product/framework/typescript/logger/core && npm link
   cd ../../../../scaffold/react && npm link @k1s0-ts-logger/core
   ```
