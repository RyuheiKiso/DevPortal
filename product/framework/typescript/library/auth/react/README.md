# @k1s0-ts-auth/react

`@k1s0-ts-auth/core` の React 連携パッケージ。Provider・hooks・表示ガード・Web 環境向け TokenStore を提供します。

## 特長

- `AuthProvider` による Context 配信（初期ロード／エラー／reload の状態管理込み）
- `useAuth` / `useAuthSession` / `useCurrentUser` / `useIsAuthenticated` / `useRole` / `usePermission` / `useAccess`
- 描画ガード `RequireAuth` / `RequirePermission`
- `createWebTokenStore` による localStorage / sessionStorage 連携（SSR 安全なメモリ fallback 付き）
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
| `useAccess(requirement)` | `AccessDecision` | `manager.canAccess(requirement)` |

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

## `createWebTokenStore(options?)`

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
