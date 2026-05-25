# @k1s0-ts-auth/react-native

`@k1s0-ts-auth/core` の React Native 連携パッケージ。Provider・hooks・表示ガードに加えて、AsyncStorage / SecureStore / Keychain などへ繋げるための `createNativeTokenStore` を提供します。

## 特長

- `AuthProvider` による Context 配信（React 版と同型 API）
- `useAuth` / `useAuthSession` / `useCurrentUser` / `useIsAuthenticated` / `useRole` / `usePermission` / `useAccess`
- 描画ガード `RequireAuth` / `RequirePermission`
- `createNativeTokenStore` による任意の Native KV ストレージ連携（同期／非同期どちらでも OK）
- React Native 0.73 以降に対応

## クイックスタート

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAuthManager } from "@k1s0-ts-auth/core";
import {
  AuthProvider,
  createNativeTokenStore,
  RequireAuth,
  useCurrentUser,
} from "@k1s0-ts-auth/react-native";

const manager = createAuthManager(adapter, {
  // AsyncStorage の getItem / setItem / removeItem を渡すだけ
  tokenStore: createNativeTokenStore(AsyncStorage, "myapp.auth.tokens"),
});

export function App() {
  return (
    <AuthProvider manager={manager} loadOnMount>
      <RootNavigator />
    </AuthProvider>
  );
}

function ProfileScreen() {
  const user = useCurrentUser();
  return <Text>Hello, {user?.displayName ?? "anonymous"}</Text>;
}

function PrivateScreen() {
  return (
    <RequireAuth fallback={<LoginScreen />}>
      <ProfileScreen />
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

Context は React 版と同じ `{ manager, session, loading, error, reload() }` を載せます。

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

## `createNativeTokenStore(storage, key?)`

任意の Native KV ストレージから TokenStore を作ります。`storage` は次の最小契約を満たす実装（`NativeKeyValueStorage`）であれば何でも渡せます。

```ts
interface NativeKeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

`key` は省略可で、既定値は `"k1s0.auth.tokens"`。`AuthTokenSet` を JSON シリアライズして単一キーに保存します。

### 代表的な統合例

- **AsyncStorage** — `createNativeTokenStore(AsyncStorage)` をそのまま渡す
- **Expo SecureStore** — 文字列のみ扱える API のため、最小ラッパで `setItem` / `getItem` / `removeItem` を `SecureStore.setItemAsync` / `getItemAsync` / `deleteItemAsync` に橋渡し
- **react-native-keychain** — Generic Password 1 件で扱うラッパを作成し、`setItem` 内で `Keychain.setGenericPassword` を呼ぶ

ラッパは非同期 (`Promise<string | null>`) でも同期でもどちらでも構いません。実装が `await` を要求するかは `NativeKeyValueStorage` 側に任せています。

## 表示ガード

`RequireAuth` / `RequirePermission` の使用方法は `@k1s0-ts-auth/react` と同一です。React Native 環境用に `<>` / `<Text>` などをそのまま渡せます。

## 注意点

`@k1s0-ts-auth/react-native` の権限判定は表示制御のみです。API リクエストの最終的な認可判定はバックエンドで行ってください。SecureStore / Keychain などのセキュアストレージはトークン漏洩対策として強く推奨されますが、デバイス紛失時の取り消しはバックエンド側の refresh token 失効ポリシーで担保してください。

## ビルド & テスト

- `npm run build` — ESM (`dist/esm/`) と CJS (`dist/cjs/`) を両方生成
- `npm run typecheck` — `tsconfig.typecheck.json`（sibling core を `paths` で直結）
- `npm run test` / `npm run test:coverage` — Vitest + react-test-renderer（coverage 100% 強制）
