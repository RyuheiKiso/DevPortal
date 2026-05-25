# @k1s0-ts-error/react-native

`@k1s0-ts-error/core` の React Native 向けバインディング。`@k1s0-ts-error/react` と同等の `ErrorProvider` / `ErrorBoundary` / hook 群に加え、React Native の global error handler を AppError パイプラインへ接続する `registerNativeGlobalErrorHandler` を提供します。

## 特長

- `ErrorProvider` / `useErrorHandler` / `useLastError` / `useAsyncErrorHandler` / `useErrorContext`
- `ErrorBoundary` + `withErrorBoundary` HOC
- `registerNativeGlobalErrorHandler` で `ErrorUtils.setGlobalHandler` 経由の未捕捉例外を AppError 化

## クイックスタート

```tsx
import { useEffect } from "react";
import { ErrorProvider, ErrorBoundary, registerNativeGlobalErrorHandler } from "@k1s0-ts-error/react-native";

function Root({ children }: { children: React.ReactNode }) {
  // ネイティブ未捕捉例外を AppError 経由で通知する
  useEffect(() => {
    // 戻り値の関数を unmount 時に呼ぶと previous handler に戻る
    return registerNativeGlobalErrorHandler({
      onError: (error, isFatal) => {
        // ここでログ adapter や通知 adapter へ転送
        nativeLogger.error("native unhandled", { kind: error.kind, isFatal });
      },
      // 既存 handler (React Native の標準赤画面) も呼びたい場合
      callPrevious: true,
    });
  }, []);

  return (
    <ErrorProvider
      logger={{ error: (msg, data) => nativeLogger.error(msg, data) }}
      notification={{ show: (input) => showToast(input) }}
    >
      <ErrorBoundary fallback={GlobalErrorView}>{children}</ErrorBoundary>
    </ErrorProvider>
  );
}
```

## `registerNativeGlobalErrorHandler(options)`

| option | 型 | 説明 |
| --- | --- | --- |
| `onError` | `(error: AppError, isFatal: boolean) => void` | 正規化済み AppError と fatal フラグを受け取るコールバック (必須) |
| `errorUtils?` | `NativeErrorUtilsLike` | テスト時のモック差し替え。省略時は `globalThis.ErrorUtils` を解決 |
| `normalizeOptions?` | `NormalizeOptions` | `normalizeError` に渡す追加オプション (component 名上書き等) |
| `callPrevious?` | `boolean` | true で既存 handler (React Native 赤画面など) にも引き渡す |

戻り値は **unregister 関数**。呼び出すと previous handler に戻ります (previous が存在しない場合は noop)。

### Hermes / RN 0.84 メモ

- `globalThis.ErrorUtils` は Hermes / JSC 共に提供されますが、テスト環境 (Jest / vitest) では存在しないため、テストでは `errorUtils` を明示渡ししてください。
- `isFatal === true` は赤画面が出る致命例外を意味します。クラッシュレポート送信などはこのフラグで分岐させてください。

## hook / Provider / ErrorBoundary

API は `@k1s0-ts-error/react` と同一です。詳細は同パッケージの README を参照してください。

> **設計メモ**: React と React Native のバインディングは現在ほぼ同一コードを保持しています (姉妹パッケージ `@k1s0-ts-notification` も同じ方針)。プラットフォーム固有の挙動 (`react-native` の `ErrorUtils` 連携など) のみ react-native 側で追加されます。
