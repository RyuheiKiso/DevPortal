# @k1s0-ts-auth/core

DevPortal 共通の認証・認可コア。セッション保持、ロール／権限判定、トークン管理、HTTP 認証ヘッダ生成のためのフロントエンド共通インターフェースを提供します。

このパッケージは認証サーバーや IdP を内包しません。バックエンドや OIDC 基盤が返すセッション・ロール・権限・トークンをフロントエンドで扱う薄い抽象層です。

## 特長

- `AuthAdapter` による `/me` / login / logout / refresh の差し替え
- `AuthManager` によるセッション保持・購読・トークン保存の一元化
- `hasRole` / `hasPermission` / `canAccess` による表示制御
- `createMemoryTokenStore` によるテスト・簡易用途のトークン保管
- `getAuthHeaders()` による HTTP クライアント連携（`@k1s0-ts-http/core` の `AuthHandler` と互換）
- 認証状態を扱うためだけの **副作用なし plain modules**（ESM / CJS デュアル出力）

## クイックスタート

```ts
import { createAuthManager } from "@k1s0-ts-auth/core";
import type { AuthAdapter, AuthSession } from "@k1s0-ts-auth/core";

// バックエンド連携を担う AuthAdapter を実装
const adapter: AuthAdapter = {
  async getSession() {
    const response = await fetch("/api/me", { credentials: "include" });
    if (!response.ok) return { status: "anonymous", user: null };
    return (await response.json()) as AuthSession;
  },
  async signIn() {
    // OIDC リダイレクトや credential 送信は案件側で実装
    location.assign("/oidc/start");
    return { status: "anonymous", user: null };
  },
  async signOut() {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  },
};

const manager = createAuthManager(adapter);

// 初期化
await manager.getSession();

// HTTP クライアントへ
const headers = await manager.getAuthHeaders();
// → { Authorization: "Bearer xxxxx" } もしくは {}
```

## 主な API

### `createAuthManager(adapter, options?)`

`AuthAdapter` を渡して `AuthManager` を生成します。`options.initialSession` で SSR 由来の初期セッションを注入できます。`options.tokenStore` を渡せばトークン保存先を差し替えられます（省略時はメモリ）。`options.onListenerError` を渡せば、`subscribe` で登録した listener が throw した時の通知先を差し替えられます（省略時は `console.error` にフォールバック）。いずれの場合も他の listener への通知は継続します。

### `AuthManager`

| メソッド | 内容 |
| --- | --- |
| `getSnapshot()` | 現在セッションの同期スナップショットを返す |
| `getSession({ refresh? })` | キャッシュ済みなら同期スナップショット、`refresh=true` または未ロードなら `adapter.getSession()` で再取得 |
| `setSession(session, event?)` | セッションを明示的に差し替える |
| `signIn(request?)` | `adapter.signIn` を呼ぶ。未実装なら `adapter.getSession` にフォールバック |
| `signOut(request?)` | `adapter.signOut` を呼んで匿名へ |
| `refresh()` | `adapter.refresh(tokenStore.get())` を呼んで反映 |
| `getAccessToken()` | 現在セッション (`current.tokens`) を優先して access token を返す。未定義時のみ TokenStore にフォールバック (SSR ハイドレーション直前など) |
| `getAuthHeaders()` | 現在セッションのトークンを優先して `{ Authorization: "<type> <token>" }` か `{}` を返す |
| `hasRole(role)` / `hasPermission(permission)` | 現在ユーザーに対する単一判定 |
| `canAccess(requirement)` | `AccessRequirement` を満たすか詳細判定（`AccessDecision` を返す） |
| `subscribe(listener)` | セッション変化を購読。返り値は購読解除関数。listener が throw しても他の listener への通知は止まらず、例外は `options.onListenerError` または `console.error` に流れる |

### `canAccess(session, requirement)`

`AccessRequirement` の各フィールドで権限要件を表現できます：

| フィールド | 型 | 用途 |
| --- | --- | --- |
| `authenticated` | `boolean` | 認証必須を要求（匿名は `reason: "anonymous"` で拒否） |
| `roles` | `readonly string[]` | 必要なロール一覧 |
| `permissions` | `readonly string[]` | 必要な権限一覧 |
| `mode` | `"all" \| "any"` | `roles` / `permissions` の評価方式（既定: `"all"`） |

返り値の `AccessDecision` は `allowed` / `missingRoles` / `missingPermissions` / `reason`（`anonymous` / `missing-role` / `missing-permission`）を含みます。

### `createMemoryTokenStore(initial?)`

メモリ上にトークン集合を保持する `TokenStore`。初期値を渡せます。テスト・SSR・即時利用に向き、永続化が必要な場合は `@k1s0-ts-auth/react` の `createWebTokenStore` または `@k1s0-ts-auth/react-native` の `createNativeTokenStore` を利用してください。

### `isTokenExpired(tokens, nowMs?, skewMs?)` / `shouldRefreshToken(tokens, nowMs?, windowMs?)`

トークンの有効期限判定。`skewMs` で時刻ずれ補正、`windowMs` で「期限まで残り N ms 以下なら更新」の判定を行えます。

### `createAuthorizationHeader(tokens)`

`AuthTokenSet` から `"Bearer xxxxx"` 形式の文字列を組み立てます。`tokenType` 未指定時は `"Bearer"` 既定、`accessToken` 未指定または空文字なら `undefined` を返します。

## AuthSession の正規化

`normalizeSession(session)` は以下を保証します：

- `undefined` 入力 → `createAnonymousSession()` の匿名セッション
- `status="authenticated"` かつ `user=null` の不整合 → 匿名へ倒す
- `roles` / `permissions` / `attributes` / `tokens` / `claims` を独立した複製として保持し、外部 mutation を遮断

### 設計ポリシー

- `status="anonymous"` の入力に付随する `tokens` / `claims` は **破棄** されます。「匿名だがトークンを保持」したい用途 (例: guest token を別途利用するなど) は本ライブラリの設計範囲外で、別途アプリ側で管理してください。
- `tokens` / `claims` / `attributes` は **shallow copy** で保護されます。第一層キーの追加・削除やプリミティブ値の差し替えは遮断されますが、**ネストしたオブジェクト・配列の内部 mutation までは防げません**。深い不変が必要な場合は利用側で `structuredClone` 等を行ってから渡してください。

## tokenStore の外部書き換えはサポートしません

`AuthManager` の `getAccessToken()` / `getAuthHeaders()` は `current` セッションの `tokens.accessToken` を権威ソースとし、未定義の場合のみ `tokenStore` にフォールバックします。これは並行 `signIn` / `signOut` 進行中に古い store 値が漏洩することを防ぐためです。

そのため、`manager` の外から直接 `tokenStore.set(...)` で書き換えても `getAccessToken()` などには反映されません。トークンを更新したい場合は必ず以下を使ってください:

- `manager.setSession({ status: "authenticated", user, tokens: { ... } })`
- `manager.refresh()` (adapter.refresh 経由で更新)
- `manager.signIn()` (adapter.signIn 経由でログインし直す)

`tokenStore` は本質的に永続化のためのバックエンドストレージであり、外部から直接 mutate する API として設計されていません。

## 注意点

フロントエンドの権限判定は UX 用の表示制御に過ぎません。API アクセスの最終的な認可判定は必ずバックエンドで実施してください。`@k1s0-ts-auth/*` の `canAccess` / `hasRole` / `hasPermission` で「描画しない／無効化する」ことはできますが、API リクエスト自体は別途バックエンド側で再検証する設計を前提にしています。

## ビルド & テスト

- `npm run build` — ESM (`dist/`) と CJS (`dist/cjs/`) を両方生成
- `npm run typecheck` — `tsconfig.typecheck.json` で型チェック
- `npm run test` / `npm run test:coverage` — Vitest（coverage は **100% 強制**）
