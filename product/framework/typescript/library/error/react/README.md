# @k1s0-ts-error/react

`@k1s0-ts-error/core` の React 向けバインディング。`ErrorProvider` / `ErrorBoundary` / hook 群を提供します。

## 特長

- `ErrorProvider` でアプリ全体に共通エラーハンドリングを注入
- `useErrorHandler` / `useLastError` / `useAsyncErrorHandler` / `useErrorContext` の hook 群
- `ErrorBoundary` + `withErrorBoundary` HOC
- ログ / 通知 / `auth` / `permission` コールバックを 1 箇所で配線

## クイックスタート

```tsx
import { ErrorProvider, useErrorHandler, ErrorBoundary } from "@k1s0-ts-error/react";

function Root({ children }: { children: React.ReactNode }) {
  return (
    <ErrorProvider
      logger={{ error: (msg, data) => console.error(msg, data) }}
      notification={{ show: (input) => toastQueue.push(input) }}
      onUnauthorized={() => router.push("/login")}
      onForbidden={() => router.push("/forbidden")}
    >
      <ErrorBoundary fallback={GlobalErrorView}>{children}</ErrorBoundary>
    </ErrorProvider>
  );
}

function SaveButton() {
  const { handleError } = useErrorHandler();
  async function onClick() {
    try {
      await save();
    } catch (caught) {
      handleError(caught, { operation: "customer.save" });
    }
  }
  return <button onClick={onClick}>Save</button>;
}
```

## `ErrorProvider` props

| prop | 型 | 説明 |
| --- | --- | --- |
| `children` | `ReactNode` | 配下要素 |
| `logger?` | `{ error(msg, data?): void }` | 構造化ログ adapter (例: `@k1s0-ts-logger/core`) |
| `notification?` | `{ show(input): void }` | 通知 adapter (例: `@k1s0-ts-notification/core`) |
| `onError?` | `(error: AppError) => void` | 全 `handleError` 呼び出しで実行されるコールバック |
| `onUnauthorized?` | `(error: AppError) => void` | `kind === "auth"` のときのみ実行（401 系のサインアウト導線等） |
| `onForbidden?` | `(error: AppError) => void` | `kind === "permission"` のときのみ実行（403 系のフォールバック表示） |

## hook 一覧

### `useErrorHandler()`

```ts
const { handleError, clearError, lastError } = useErrorHandler();
```

- `handleError(error, options?)` で例外を AppError 化 + ログ + 通知 + コールバック呼び出し
- `options.log = false` でログ抑制、`options.notify = false` で通知抑制
- `options` には `NormalizeOptions` (operation, component, requestId, traceId, tags, metadata, defaultKind, defaultUserMessage, includeCause) もそのまま渡せる

### `useLastError()`

直近の AppError (無ければ null) だけを購読する軽量 hook。

### `useErrorContext()`

`{ lastError, handleError, clearError, normalize }` をすべて返す。`normalize` は副作用なしで正規化だけ実行するユーティリティ。

### `useAsyncErrorHandler(fn, options?)`

非同期関数を error handler で包みます。失敗時は `handleError` を呼び、戻り値を `undefined` にして上位の await を継続させます。

```tsx
const save = useAsyncErrorHandler(async (id: string) => {
  return await api.save(id);
}, { operation: "customer.save" });
```

> **注**: `options` は ref で安定化されているため、呼び出し側で毎レンダにリテラル渡ししても返却関数の参照は安定します (依存配列は `[fn, handleError]` のみ)。`fn` を毎レンダ生成しないよう、必要に応じて `useCallback` で包んでください。

## `ErrorBoundary`

```tsx
<ErrorBoundary
  fallback={GlobalErrorView}
  onError={(error, info) => logger.error(error.message, { info })}
  normalizeOptions={{ component: "RootBoundary" }}
>
  {children}
</ErrorBoundary>
```

- `fallback` は `ReactNode` か `ComponentType<ErrorBoundaryFallbackProps>` のいずれか
- fallback コンポーネントは `{ error: AppError, reset(): void }` を受け取る
- `normalizeOptions` は `componentDidCatch` 時に再正規化に使用されます

### `withErrorBoundary(Component, boundaryProps?)`

任意コンポーネントを `ErrorBoundary` で囲む HOC。`displayName` は `withErrorBoundary(<元のコンポーネント名>)` に整形されます。
