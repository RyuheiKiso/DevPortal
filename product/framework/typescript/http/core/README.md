# @k1s0-ts-http/core

DevPortal 共通の HTTP クライアント基盤。

- `fetch` ベースの汎用 HTTP クライアント（`createHttpClient`）
- タイムアウト（リクエスト全体 / 1 試行ごとの 2 段）
- リトライ（指数バックオフ + ジッタ、5xx / `408` / `425` / `429` / ネットワーク失敗を既定でリトライ）
- 認証ヘッダ供給（`AuthProvider` 契約、Bearer / 静的ヘッダの組み立てヘルパ）
- `X-Request-Id` の自動付与（`crypto.randomUUID()` ベース、相関 ID として伝搬）
- エラー正規化（`HttpError`：ステータス / コード / リトライ可否 / `requestId` / 原因）
- 構造的サブタイピングで合致する任意 Logger を注入可能（`@k1s0-ts-logger/core` の `Logger` が peerDep optional でそのまま利用可）
- REST 用ヘルパ（`get` / `post` / `put` / `patch` / `del`、JSON 自動 stringify / parse、`query` の URL エンコード）
- gRPC-web 用クライアント（`createGrpcClient`、`grpc-web` を peerDep optional で動的 import、unary 対応、status コード正規化、retry / timeout / auth / log を REST と共有）
- zod による設定スキーマ validation

このパッケージは UI フレームワーク非依存です。React 連携は `@k1s0-ts-http/react`、React Native は `@k1s0-ts-http/react-native` を利用してください。

## インストール

```bash
npm install @k1s0-ts-http/core
```

社内 Verdaccio を利用する場合は、リポジトリの `.npmrc` で registry を `http://<verdaccio-host>:<port>` に向けてください。

gRPC-web を使う場合のみ、利用側で追加で `grpc-web` を導入してください（peer optional）。

```bash
npm install grpc-web
```

ログ連携を使う場合のみ、利用側で `@k1s0-ts-logger/core` を導入してください（peer optional）。

```bash
npm install @k1s0-ts-logger/core
```

## 公開 API

### HTTP クライアントの生成

```ts
import {
  createHttpClient,
  createBearerAuth,
  get,
  post,
} from "@k1s0-ts-http/core";

const client = createHttpClient({
  baseUrl: "https://api.example.com",
  defaultHeaders: { "X-Tenant": "acme" },
  auth: createBearerAuth(async () => await getAccessToken()),
  retry: { maxRetries: 3, backoffBaseMs: 200 },
  timeout: { totalMs: 30_000, perAttemptMs: 5_000 },
  logger,
});

// REST ヘルパ（戻りは HttpResponse<T>。.body が JSON parse 済み）
const users = await get<{ id: string; name: string }[]>(client, "/users", { query: { active: true } });
await post<{ id: string }>(client, "/users", { name: "alice" });
```

### エラーハンドリング

`!response.ok` の応答は `HttpError` として throw されます（retry policy 評価対象）。

```ts
import { HttpError } from "@k1s0-ts-http/core";

try {
  await get(client, "/secret");
} catch (err) {
  if (err instanceof HttpError) {
    console.log(err.status, err.code, err.retryable, err.requestId);
  }
}
```

### gRPC-web クライアント

```ts
import { createGrpcClient } from "@k1s0-ts-http/core";

const grpc = await createGrpcClient({
  baseUrl: "https://grpc.example.com",
  auth: createBearerAuth(getToken),
  retry: { maxRetries: 2 },
  timeoutMs: 10_000,
  logger,
});

const res = await grpc.unary(EchoServiceEchoMethod, { message: "hi" });
```

`grpc-web` が未インストールの環境で `createGrpcClient()` を呼ぶと、`HttpError(code: "GRPC_PEER_MISSING")` が throw されます（core 全体は壊さない）。

### スキーマ validation

```ts
import { httpClientConfigSchema, validateHttpClientConfig } from "@k1s0-ts-http/core";

const valid = validateHttpClientConfig({
  baseUrl: "https://api.example.com",
  retry: { maxRetries: 3, backoffBaseMs: 200, jitter: "full" },
  timeout: { totalMs: 30000, perAttemptMs: 5000 },
});
// 失敗時は ZodError を throw
```

## 動作の重要な仕様

- **`!response.ok` は常に throw 化**：HTTP 4xx/5xx を `HttpError` に変換します。これにより retry / error interceptor の責務が一つに統一されます。
- **timeout の入れ子順序**：`withTimeout(total) → withRetry → withTimeout(perAttempt) → fetch`。total が retry 全体を抱えるため、リトライ回数を増やしても全体時間を一定に抑えられます。
- **`AbortError` はリトライしません**：親 `signal.abort()` で即座に中断します。
- **ネットワーク失敗（`TypeError`）はリトライ対象**：fetch がネットワークエラーで `TypeError` を投げる仕様に従います。
- **`X-Request-Id` は client 内で自動生成**：ユーザの request interceptor から見えるので、外部ロガーに紐付けたい場合は `req.requestId` を参照してください。
- **JSON parse は REST ヘルパの責務**：低レベル `client.request()` は `body` 未パースで `raw` Response を返します。バイナリやストリーミングと共存させるための分離です。
- **Logger は構造的型**：`@k1s0-ts-logger/core` への直接依存は持ちません。`{ debug, info, warn, error }(message, context?) => void` 構造を満たすオブジェクトなら何でも渡せます（utility 関数 `noopLogger` も提供）。

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

- provider: `v8`
- 計測対象: `src/**/*.ts`
- 除外: `*.test.ts` / `src/types.ts` / `src/index.ts` / `src/rest/index.ts` / `src/grpc/index.ts`
- 閾値: `statements` / `branches` / `functions` / `lines` を **すべて 100%** に設定

`prepublishOnly` は `clean → build → test:coverage` の順で動くため、カバレッジ閾値を割ると publish できません。

## Verdaccio publish の順序

3 パッケージは内部依存があるため **以下の順序で publish** する必要があります。

```
1. core を npm version bump → npm publish --registry http://<verdaccio>
2. react / react-native の version を core と一致させる
3. react を npm publish（prepublishOnly が file:../core を core のバージョン文字列に書き換え、
   postpublish で file:../core に戻す）
4. react-native を npm publish（同上）
```

**注意**: publish 失敗時は `postpublish` が走らず、`package.json` の `dependencies."@k1s0-ts-http/core"` が version 文字列のまま残る可能性があります。その場合は手動で `"file:../core"` に戻してください（`git diff package.json` で確認）。

また `npm pack` は `postpublish` を発火させないため、tarball 検証のみで publish しない場合は `git restore package.json` で復元してください。

## scaffold へのローカル統合手順

`product/scaffold/react` や `product/scaffold/react_native` でローカル動作確認する場合は、以下のいずれかを利用します（推奨は 1）。

1. **tarball install（最も再現性高い）**
   ```bash
   cd product/framework/typescript/http/core
   npm pack
   cd ../../../../scaffold/react
   npm install ../../framework/typescript/http/core/k1s0-ts-http-core-0.1.0.tgz
   ```

2. **`file:` プロトコル依存**
   ```json
   {
     "dependencies": {
       "@k1s0-ts-http/core": "file:../../framework/typescript/http/core"
     }
   }
   ```

3. **npm link**（Web/Vite では OK、Metro 経由の RN では symlink を嫌うため非推奨）
