# @k1s0-ts-error/core

DevPortal 共通の `AppError` 正規化・分類・シリアライズ・ログ/通知アダプタユーティリティ。

## 特長

- 任意の `catch` 値を `AppError` (plain object) に正規化する `normalizeError`
- HTTP ステータス・エラーコード・Zod 風 issues を kind に分類
- ユーザー向けメッセージとログ向けメッセージを分離 (`userMessage` / `message`)
- `requestId` / `traceId` / `status` / `code` / `details` / `cause` を保持
- 構造化ログ / 通知アダプタ向けの変換関数 (`toLogRecord` / `toNotification`)
- `Error` 継承ではなく **plain object** として AppError を扱う設計 (JSON 化・transport 経由送信が容易)

## クイックスタート

```ts
import { normalizeError, toLogRecord, toNotification } from "@k1s0-ts-error/core";

try {
  await save();
} catch (caught) {
  // 任意の catch 値を AppError に変換
  const error = normalizeError(caught, { operation: "customer.save" });
  // 構造化ログへ転送
  logger.error("Save failed", toLogRecord(error));
  // 通知アダプタへ転送 (toast 等)
  notification.toast(toNotification(error));
}
```

## AppError のフィールド

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `name` | `"AppError"` | type guard 用の固定値 |
| `kind` | `AppErrorKind` | 11 種類の分類値（後述） |
| `message` | `string` | 内部メッセージ（ログ向け） |
| `userMessage` | `string` | ユーザー向けメッセージ |
| `code` | `string?` | 詳細コード（例: `VERSION_CONFLICT`） |
| `status` | `number?` | HTTP ステータスコード |
| `requestId` | `string?` | リクエスト追跡 ID |
| `traceId` | `string?` | 分散トレース ID |
| `details` | `unknown?` | 任意の詳細情報（レスポンス body 等） |
| `cause` | `unknown?` | 原因例外 |
| `retryable` | `boolean` | リトライ可否（既定値あり） |
| `reportable` | `boolean` | 監視通報の対象か（既定値あり） |
| `severity` | `AppErrorSeverity` | `info` / `warning` / `error` / `critical` |
| `validationIssues` | `readonly ValidationIssue[]?` | 検証エラーの内訳 |
| `context` | `ErrorContext?` | `operation` / `component` / `tags` / `metadata` 等 |

## AppErrorKind 一覧

| kind | 用途 |
| --- | --- |
| `network` | 通信失敗（DNS / コネクション失敗） |
| `timeout` | 応答待ち時間超過 |
| `http` | 上記分類に当てはまらない HTTP 失敗 |
| `auth` | 認証失効・未ログイン |
| `permission` | 認可不足 |
| `validation` | 入力検証失敗 |
| `business` | 業務ルール起因 |
| `conflict` | 同時更新の競合 |
| `notFound` | リソース未検出 |
| `system` | サーバー内部例外 |
| `unknown` | 分類不能 |

## `defaultRetryable` の挙動

| kind | status 未指定 | status=408/409/429/5xx | その他の status |
| --- | --- | --- | --- |
| `network` / `timeout` / `conflict` | true | true | true |
| その他 | false | true | false |

> **注**: `conflict` は楽観ロック / バージョン衝突の自動再試行を想定し、kind 単独（status 未指定）でも `defaultRetryable("conflict") === true` を返します。HTTP 409 経由で正規化された場合も同じく `retryable=true` のままです。`business` / `validation` / `auth` / `permission` / `notFound` は kind 単独では `false` ですが、HTTP セマンティクス上リトライ可能な status (408 / 409 / 429 / 5xx) を渡せば `true` に切り替わります。

## API

### `normalizeError(error, options?)`

任意の例外値を `AppError` に変換します。`options` には `ErrorContext` のフィールド (`operation`, `component`, `requestId`, `traceId`, `tags`, `metadata`) に加え、以下を渡せます:

- `defaultKind?: AppErrorKind` — 分類不能時の fallback (`"unknown"`)
- `defaultUserMessage?: string` — ユーザーメッセージの fallback
- `includeCause?: boolean` — `false` で `cause` を破棄 (循環参照の回避に使用)

### `createAppError(input)`

`AppError` を直接組み立てます。未指定フィールドは `defaultUserMessage` / `defaultSeverity` / `defaultRetryable` / `defaultReportable` で補完されます。

### `isAppError(value)`

任意の値が `AppError` 形状を満たすかを判定します。`name === "AppError"` 且つ `kind` が `AppErrorKind` の許容値に含まれることまで厳密にチェックします。

### `serializeError(error)`

`AppError` を `SerializedAppError` に変換します。`cause` は除外され、JSON 化可能な構造になります。

### `toLogRecord(error)` / `toNotification(error)`

構造化ログ / 通知アダプタ向けの payload を生成します。

### `validateAppErrorInput(input)` / `safeValidateAppErrorInput(input)`

zod schema を使った `AppErrorInput` の検証。`validateAppErrorInput` は失敗時に throw、`safeValidateAppErrorInput` は `{ success, data | error }` の discriminated union を返します。

## 注意点

### `cause` の循環参照

`AppError.cause` には任意の値を保持できますが、`JSON.stringify(appError)` などでシリアライズする場合は循環参照に注意してください。`serializeError` / `toLogRecord` は `cause` を意図的に除外するため安全です。原因例外を確実に追跡したい場合は `Error` インスタンスを `cause` として渡すことを推奨します。

### `AppError` が `Error` を継承しない理由

JSON シリアライズ・構造化ログ・transport 経由送信 (Web Worker / IPC / SSR) との相性を優先しました。スタックトレースが必要な場合は `cause` に `Error` インスタンスを保持してください。
