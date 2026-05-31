# C# (.NET 10) Web API テンプレート

Backstage の **Software Template**（scaffolder）です。**.NET 10** の **Minimal API** で構成したバックエンド Web API サービスの雛形を生成します。

DevPortal のサーバーサイド基盤（`apps/backend`、共有パッケージ `packages/csharp`）と同じ技術スタック（C# / .NET 10）に揃えてあります。

## 構成

```text
templates/csharp/backend/
├── template.yaml      # スキャフォルダーのテンプレート定義（入力フォーム・実行ステップ）
└── skeleton/          # 生成される本体（${{ ... }} を fetch:template で置換）
    ├── global.json / Directory.Build.props   # SDK ピン（.NET 10）と共通ビルド設定
    ├── Backend.slnx                          # XML ベースのソリューション（.NET 10）
    ├── Dockerfile / .dockerignore            # コンテナイメージ（multi-stage）
    ├── .gitignore / .editorconfig
    ├── catalog-info.yaml / mkdocs.yml / docs/index.md / README.md
    ├── src/Api/                              # Web API 本体プロジェクト
    │   ├── Api.csproj / Program.cs
    │   ├── Endpoints/ / Models/              # サンプルエンドポイントとモデル
    │   ├── appsettings*.json
    │   └── Properties/launchSettings.json
    └── tests/Api.Tests/                      # WebApplicationFactory による統合テスト
```

## 入力パラメータ

| パラメータ | 用途 |
| --- | --- |
| `component_id` | カタログ識別子（kebab-case） |
| `app_title` | 表示名（catalog-info / README / TechDocs） |
| `description` | 説明（catalog-info / README） |
| `owner` | オーナー（Group/User、OwnerPicker） |
| `system` | 所属システム（任意、EntityPicker） |
| `root_namespace` | ルート名前空間。`RootNamespace` / `AssemblyName` / DLL 名・テストの名前空間に使用（例 `Devportal.InventoryApi`） |
| `http_port` | Kestrel が待ち受ける HTTP ポート（launchSettings / Dockerfile 共通、既定 8080） |
| `use_https_redirection` | `app.UseHttpsRedirection()` を含めるか（boolean、既定 false） |
| `repo_url` | 作成先 GitHub リポジトリ（RepoUrlPicker） |

## 生成されるサービスの技術軸

- .NET **10**（`net10.0`）/ C# **latest** / ASP.NET Core **Minimal API**
- API ドキュメント: 組み込み **OpenAPI**（`Microsoft.AspNetCore.OpenApi`、開発環境で `/openapi/v1.json` を配信）
- ヘルスチェック: `/health`、エラー応答: **ProblemDetails**（RFC 9457）
- ソリューション: **`.slnx`**（.NET 10 の XML 形式）。コンテナ: **multi-stage Dockerfile**
- テスト: **xUnit** + **WebApplicationFactory**（インメモリ統合テスト、`tests/Api.Tests` に同居）

> パッケージのバージョン（`Microsoft.AspNetCore.OpenApi` ほか）は `skeleton/src/Api/Api.csproj` と `skeleton/tests/Api.Tests/Api.Tests.csproj` で **`10.0.0` 系**に固定しています。.NET のパッチ更新に合わせて見直してください。

## Backstage への登録

`app-config.yaml` の `catalog.locations` にこのテンプレートを追加します（GitHub 上のパスに合わせて調整してください）。

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/<org>/DevPortal/blob/main/templates/csharp/backend/template.yaml
      rules:
        - allow: [Template]
```

> ローカル検証時は `type: file` で `templates/csharp/backend/template.yaml` を指すこともできます。

## 設計メモ

- **パスは固定・値は中身に埋め込む**: 本テンプレートはクライアント用 `templates/kotlin` の方針に倣い、ファイル/フォルダ名に `${{ ... }}` を使いません。プロジェクトフォルダは汎用名 `src/Api`（テストは `tests/Api.Tests`）に固定し、サービス固有の名前は `Api.csproj` の `RootNamespace` / `AssemblyName` に `${{ values.root_namespace }}` として埋め込みます。生成後、必要に応じてフォルダ/ファイル名を実サービス名へ変更してください。
- **コメント規約**: 生成物の C# / MSBuild(XML) / Dockerfile / YAML は、DevPortal の方針に従い各行の上に日本語コメントを付けています。`${{ values.X }}` は 1 行に 1 つだけ値の途中へ埋め込み、行・コメントの対応が崩れないようにしています。
- **JSON のコメント例外**: `appsettings*.json` は ASP.NET Core の構成プロバイダがコメント（`//`）を許容するため各行にコメントを付けています。一方 **`global.json` と `launchSettings.json` は JSON コメント非対応**（SDK / `dotnet run` がパースに失敗する）のため、**意図的にコメントを付けていません**。正しくビルド・起動できることを優先しています。
- **テストは本体に同居**: テストは別スケルトンに分けず、本体 `skeleton/tests/Api.Tests` に同居させ、`Backend.slnx` からも常に参照します。テストを使わない場合は `tests/` と slnx の該当参照を削除してください。`Program.cs` の `use_https_redirection` は `{%- if %}` で行単位に出し分け、生成後も「1 行 = 1 コメント」が保たれるようにしています。
- **`public partial class Program`**: `Program.cs` 末尾に公開部分クラスを置き、テスト側の `WebApplicationFactory<Program>` から参照できるようにしています。
