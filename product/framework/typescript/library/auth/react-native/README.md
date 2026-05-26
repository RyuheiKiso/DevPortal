# @k1s0-ts-auth/react-native

`@k1s0-ts-auth/core` の React Native 連携パッケージ。Provider・hooks・表示ガードに加えて、`react-native-keychain` / `expo-secure-store` 経由でトークンを保護するためのヘルパ (`createKeychainTokenStore` / `createSecureStoreTokenStore`) を提供します。

> **トークン保存先について** — React Native ではトークンは必ず Keychain (`react-native-keychain`) または SecureStore (`expo-secure-store`) で保護してください。`AsyncStorage` は iOS Documents / Android SharedPreferences に **平文** で書き出すため、トークン用途には**使用しないでください**。低レベル API (`createNativeTokenStore`) は任意 backend を受けますが、AsyncStorage を渡すと平文保存となります。

## 特長

- `AuthProvider` による Context 配信（React 版と同型 API）
- `useAuth` / `useAuthSession` / `useCurrentUser` / `useIsAuthenticated` / `useRole` / `usePermission` / `useAccess`
- 描画ガード `RequireAuth` / `RequirePermission`
- セキュアトークン保存ヘルパ:
  - `createKeychainTokenStore(Keychain, options?)` — `react-native-keychain` 経由（iOS Keychain / Android Keystore）
  - `createSecureStoreTokenStore(SecureStore, options?)` — `expo-secure-store` 経由
- 低レベル汎用ヘルパ `createNativeTokenStore(storage, key?)`（カスタム backend 向け）
- React Native 0.73 以降に対応

## クイックスタート (Keychain / 推奨)

```tsx
// react-native-keychain モジュールを取り込む
import * as Keychain from "react-native-keychain";
// 認証マネージャを作るファクトリ
import { createAuthManager } from "@k1s0-ts-auth/core";
// Provider / Keychain TokenStore ヘルパ / 表示ガード / hooks を取り込む
import {
  AuthProvider,
  createKeychainTokenStore,
  RequireAuth,
  useCurrentUser,
} from "@k1s0-ts-auth/react-native";

// Keychain で保護された TokenStore を組み立てる (Secure Enclave / Android Keystore)
const manager = createAuthManager(adapter, {
  tokenStore: createKeychainTokenStore(Keychain, {
    // 保存キー (TypedSlot 上の key、既定 "k1s0.auth.tokens")
    key: "myapp.auth.tokens",
    // perKey モードでは service = `${servicePrefix}/${key}` で保護される
    backend: { servicePrefix: "myapp" },
  }),
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

## クイックスタート (Expo SecureStore)

```tsx
// expo-secure-store モジュールを取り込む
import * as SecureStore from "expo-secure-store";
// 認証マネージャを作るファクトリ
import { createAuthManager } from "@k1s0-ts-auth/core";
// SecureStore TokenStore ヘルパを取り込む
import { createSecureStoreTokenStore } from "@k1s0-ts-auth/react-native";

// SecureStore で保護された TokenStore を組み立てる
const manager = createAuthManager(adapter, {
  tokenStore: createSecureStoreTokenStore(SecureStore, {
    // 保存キー (既定 "k1s0.auth.tokens")
    key: "myapp.auth.tokens",
  }),
});
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
| `useAccess(requirement)` | `AccessDecision` | `manager.canAccess(requirement)`。返り値は毎回新規オブジェクトのため、`useEffect` 依存に使うときは `.allowed` 等プリミティブを取り出すか `useMemo` で安定化を |

## セキュアトークン保存ヘルパ

### `createKeychainTokenStore(keychain, options?)`

`react-native-keychain` の `KeychainModule` 形状を受け取り、JSON シリアライズした `AuthTokenSet` を Keychain (`setGenericPassword`) で保存します。内部的には `@k1s0-ts-storage/react-native` の `createKeychainBackend` を使うため、`perKey` / `singleService` のどちらのモードも `backend` オプションで指定可能です。

```ts
createKeychainTokenStore(Keychain, {
  // TypedSlot 上のキー名 (既定 "k1s0.auth.tokens")
  key?: string;
  // Keychain backend 設定 (mode / servicePrefix / singleService)
  backend?: { mode?: "perKey" | "singleService"; servicePrefix?: string; singleService?: string };
})
```

### `createSecureStoreTokenStore(secureStore, options?)`

`expo-secure-store` の `getItemAsync` / `setItemAsync` / `deleteItemAsync` を受け取り、JSON シリアライズした `AuthTokenSet` を保存します。

```ts
createSecureStoreTokenStore(SecureStore, {
  // 保存キー (既定 "k1s0.auth.tokens")
  key?: string;
})
```

## 低レベル API: `createNativeTokenStore(storage, key?)`

任意の Native KV ストレージから TokenStore を作る低レベル API です。`storage` は次の最小契約を満たす実装（`NativeKeyValueStorage`）であれば何でも渡せます。

```ts
interface NativeKeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

**`AsyncStorage` をトークン保存に使わないでください** — 平文で端末ストレージに書き出されるため、root 化端末やバックアップ流出で漏洩します。トークン以外の非機密 KV (UI 設定など) を保存する用途であれば AsyncStorage を経由しても問題ありません。

`key` は省略可で、既定値は `"k1s0.auth.tokens"`。`AuthTokenSet` を JSON シリアライズして単一キーに保存します。

## 表示ガード

`RequireAuth` / `RequirePermission` の使用方法は `@k1s0-ts-auth/react` と同一です。React Native 環境用に `<>` / `<Text>` などをそのまま渡せます。

## 注意点

`@k1s0-ts-auth/react-native` の権限判定は表示制御のみです。API リクエストの最終的な認可判定はバックエンドで行ってください。Keychain / SecureStore でトークン漏洩リスクを下げても、デバイス紛失時の取り消しはバックエンド側の refresh token 失効ポリシーで担保してください。

## ビルド & テスト

- `npm run build` — ESM (`dist/esm/`) と CJS (`dist/cjs/`) を両方生成
- `npm run typecheck` — `tsconfig.typecheck.json`（sibling core を `paths` で直結）
- `npm run test` / `npm run test:coverage` — Vitest + react-test-renderer（coverage 100% 強制）
