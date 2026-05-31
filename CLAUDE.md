# DevPortal

業務システムを開発するための、開発者向けプラットフォーム（Developer Portal）。
システム開発を担うチームが開発しやすい環境を整えることを目的とする。

## コーディング規約

- **コードの各行の上に日本語でコメントを記載することを徹底する**（参画者の理解を助けるため）。

## 技術スタック

| レイヤー | 技術 |
| --- | --- |
| クライアント（ネイティブ） | Kotlin Multiplatform (KMP) + Compose Multiplatform (CMP)。Android / Windows で動作 |
| Web 画面 | React |
| サーバーサイド | C# (.NET 10) |
| サービス間通信 | gRPC / GraphQL（予定） |
| 外部提供 API | REST API（予定） |
| データベース | SQL Server（予定） |

## リポジトリ構成（モノレポ）

| ディレクトリ | 用途 |
| --- | --- |
| `apps/backend` | サーバーサイド（C# / .NET 10） |
| `apps/bff` | BFF（Backend for Frontend） |
| `apps/frontend/web` | Web フロントエンド（React） |
| `apps/frontend/native` | ネイティブクライアント（KMP + CMP） |
| `contracts/` | サービス間・チーム間のインターフェース（API/イベントの「契約」）。言語非依存のスキーマ定義を置き、各言語のSDKは `packages/` 側で生成・公開する |
| `contracts/proto` | gRPC / Protocol Buffers。**現時点で実際に利用しているのはここのみ** |
| `contracts/openapi` | REST の OpenAPI スキーマ（未使用） |
| `contracts/graphql` | GraphQL スキーマ SDL（未使用） |
| `contracts/events` | 非同期メッセージングのイベントスキーマ（未使用） |
| `packages/kotlin` | Kotlin 向け共有パッケージ（`config` など） |
| `packages/csharp` | C# 向け共有パッケージ |
| `packages/typescript` | TypeScript 向け共有パッケージ |
| `templates/` | 新規プロジェクト用 Backstage スキャフォールドテンプレート（`kotlin` / `csharp` / `react`） |
| `database/auth` | 認証・認可スキーマ（SQL Server）とシードデータ |
| `docs/` | ドキュメント |

## ビルド

- ルートは Gradle マルチプロジェクト（`settings.gradle.kts`）。依存バージョンは `gradle/libs.versions.toml` で集中管理する。
- 現在 Gradle に含まれるモジュール: `:packages:kotlin:config:core`、`:packages:kotlin:config:ui`。
- Kotlin クライアントは単一 `composeApp` / AGP 8.x 軸で構成し、バージョンはルートの version catalog と統一する。

## ドキュメント運用

- 模索段階のため、ドキュメントに変更履歴・バージョン表記は付けない。

## その他
作業が完了したら自身の作業が完璧かどうかを自己監査して修正すべき箇所があれば修正することを徹底する。