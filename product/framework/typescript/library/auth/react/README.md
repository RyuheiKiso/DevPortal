# @k1s0-ts-auth/react

`@k1s0-ts-auth/core` の React 連携パッケージ。Provider・hooks・表示ガード・Web 環境向け TokenStore を提供します。

## 特長

- `AuthProvider` による Context 配信（初期ロード／エラー／reload の状態管理込み）
- `useAuth` / `useAuthSession` / `useCurrentUser` / `useIsAuthenticated` / `useRole` / `usePermission` / `useAccess`
- 描画ガード `RequireAuth` / `RequirePermission`
- **暗号化 TokenStore** `createEncryptedWebTokenStore` + `loadOrCreateAesKey`（AES-GCM, extractable:false 鍵を IndexedDB で永続化）
- `createWebTokenStore` による localStorage / sessionStorage 連携（SSR 安全なメモリ fallback 付き、**平文保存**）
- React 19 / 18 双方対応（peerDependencies に明記）

## クイックスタート

```tsx
import { createAuthManager } from "@k1s0-ts-auth/core";
import { AuthProvider, createWebTokenStore, RequireAuth, useCurrentUser } from "@k1s0-ts-auth/react";

const manager = createAuthManager(adapter, {
  // localStorage に保存する Web 用 TokenStore
  tokenStore: createWebTokenStore({ key: "myapp.auth" }),
});

export function App() {
  return (
    <AuthProvider manager={manager} loadOnMount>
      <Routes />
    </AuthProvider>
  );
}

function Profile() {
  const user = useCurrentUser();
  return <p>Hello, {user?.displayName ?? "anonymous"}</p>;
}

function PrivatePage() {
  return (
    <RequireAuth fallback={<Login />}>
      <Profile />
    </RequireAuth>
  );
}
```

## `AuthProvider` props

| prop | 型 | 既定 | 内容 |
| --- | --- | --- | --- |
| `manager` | `AuthManager` | — | core の `createAuthManager` が返すマネージャ |
| `children` | `ReactNode` | — | ラップ対象 |
| `loadOnMount` | `boolean` | `false` | `true` で mount 時に `manager.getSession({ refresh: true })` を呼ぶ |

Context には `{ manager, session, loading, error, reload() }` を載せます。`reload()` を呼ぶと再度 `manager.getSession({ refresh: true })` を実行し、`loading` / `error` / `session` を更新します。

## hooks

| hook | 返り値 | 補足 |
| --- | --- | --- |
| `useAuthContext()` | `AuthContextValue` | Provider 外から呼ぶと throw |
| `useAuth()` | `AuthManager` | manager の参照を返す |
| `useAuthSession()` | `AuthSession` | 現在セッション |
| `useCurrentUser()` | `AuthUser \| null` | 匿名時は `null` |
| `useIsAuthenticated()` | `boolean` | status と user の両方を考慮 |
| `useRole(role)` | `boolean` | `manager.hasRole(role)` |
| `usePermission(permission)` | `boolean` | `manager.hasPermission(permission)` |
| `useAccess(requirement)` | `AccessDecision` | `manager.canAccess(requirement)`。返り値は毎回新規オブジェクトのため、`useEffect` 依存に使うときは `.allowed` 等プリミティブを取り出すか `useMemo` で安定化を |

## 表示ガード

### `RequireAuth`

認証済みのとき `children`、それ以外は `fallback`（未指定なら `null`）を描画します。

```tsx
<RequireAuth fallback={<Login />}>
  <Dashboard />
</RequireAuth>
```

### `RequirePermission`

`AccessRequirement` を満たすとき `children`、不足のとき `fallback` を描画します。

```tsx
<RequirePermission
  requirement={{ permissions: ["invoice:delete"] }}
  fallback={<DeniedBanner />}
>
  <DeleteInvoiceButton />
</RequirePermission>
```

## `createEncryptedWebTokenStore(options)` (推奨)

AES-GCM で暗号化した状態で localStorage に保存する Web TokenStore。鍵は `@k1s0-ts-storage/react` の `loadOrCreateAesKey` で `extractable:false` の `CryptoKey` として生成し、IndexedDB に永続化します。鍵 raw bytes は JavaScript からもディスクからも露出しません。

```tsx
// 鍵管理ヘルパを取り込み (extractable:false 鍵生成 + IDB 永続化)
import { loadOrCreateAesKey } from "@k1s0-ts-storage/react";
// AES-GCM provider ファクトリを取り込み
import { createAesGcmProvider } from "@k1s0-ts-storage/core";
// 認証マネージャと暗号化 TokenStore を取り込み
import { createAuthManager } from "@k1s0-ts-auth/core";
import { createEncryptedWebTokenStore } from "@k1s0-ts-auth/react";

// アプリ起動時に 1 度だけ実行する非同期セットアップ
async function setupAuth() {
  // IDB から鍵を取り出すか、初回なら生成して保存する (extractable:false / AES-GCM 256bit)
  const key = await loadOrCreateAesKey({ keyName: "myapp.auth" });
  // CryptoKey から AES-GCM provider を組み立てる
  const provider = createAesGcmProvider({ key });
  // 暗号化 TokenStore を作成
  const tokenStore = createEncryptedWebTokenStore({ provider });
  // AuthManager に渡す
  return createAuthManager(adapter, { tokenStore });
}
```

| option | 型 | 既定 |
| --- | --- | --- |
| `provider` | `CryptoProvider` | 必須。`createAesGcmProvider({ key })` で生成 |
| `storage` | `WebKeyValueStorage` | `window.localStorage`（参照不能なら自動でメモリ fallback） |
| `key` | `string` | `"k1s0.auth.tokens"` |
| `onCorrupt` | `(raw, error) => void` | 復号 / JSON.parse / schema 検証いずれかが失敗した時に呼ばれる observability コールバック（破損データは自動削除） |

復号失敗・envelope 不正・JSON 不正・schema 検証失敗のいずれでも `onCorrupt` 通知後に `removeItem` で破損データを掃除し `undefined` を返します（自動再ログインフロー）。

## `createWebTokenStore(options?)` (平文)

> **注意**: localStorage に **平文** で保存します。トークン用途では `createEncryptedWebTokenStore` を強く推奨。`createWebTokenStore` は機密性の低い設定値や、暗号化のオーバーヘッドを避けたい用途向けです。

Web 環境向けの永続 TokenStore を生成します。

| option | 型 | 既定 |
| --- | --- | --- |
| `storage` | `WebKeyValueStorage`（`getItem` / `setItem` / `removeItem` の同期 API） | `window.localStorage`（参照不能なら自動でメモリ fallback） |
| `key` | `string` | `"k1s0.auth.tokens"` |

SSR / Node 環境では `window` が存在しないため、自動でメモリ実装にフォールバックします。プライベートブラウジングなど `window.localStorage` 参照時に throw する環境でも同様に安全にフォールバックします。`sessionStorage` を渡せばセッション限定保存にも切り替えられます。

JSON.parse 不能または非オブジェクトが保存されていた場合、自動的に `removeItem` でクリーンアップして `undefined` を返します（破損データの自動回復）。

## 注意点

`@k1s0-ts-auth/react` の権限判定は表示制御のみです。API リクエストの最終的な認可判定はバックエンドで行ってください。

## ビルド & テスト

- `npm run build` — ESM 出力（`dist/`）
- `npm run typecheck` — `tsconfig.typecheck.json`（sibling core を `paths` で直結）
- `npm run test` / `npm run test:coverage` — Vitest + react-test-renderer（coverage 100% 強制）
