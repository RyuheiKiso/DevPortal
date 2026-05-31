# ${{ values.app_title }}

${{ values.description }}

C# (.NET 10) の **Minimal API** で構成したバックエンド Web API サービスです。DevPortal の Backstage テンプレート `csharp/backend` から生成されています。

## 構成

```text
${{ values.component_id }}/
├── global.json              # .NET SDK のバージョンピン（10.0.x）
├── Directory.Build.props    # 全プロジェクト共通のビルド設定
├── Backend.slnx             # ソリューション（XML 形式）
├── Dockerfile               # コンテナイメージ（multi-stage）
├── src/
│   └── Api/
│       ├── Api.csproj                  # プロジェクト定義（RootNamespace / AssemblyName / OpenAPI）
│       ├── Program.cs                  # アプリのエントリポイント（DI・ミドルウェア・ルーティング）
│       ├── Endpoints/                  # エンドポイント定義（拡張メソッド）
│       ├── Models/                     # リクエスト/レスポンスのモデル
│       ├── appsettings.json            # 共通の構成
│       ├── appsettings.Development.json# 開発環境の構成
│       └── Properties/launchSettings.json # ローカル実行プロファイル
└── tests/
    └── Api.Tests/                      # WebApplicationFactory による統合テスト
```

## 前提環境

- **.NET 10 SDK**（`global.json` で `10.0.x` にピン。未導入だと `dotnet` コマンドがエラーになります）
- コンテナビルドは Docker（`mcr.microsoft.com/dotnet/sdk:10.0` / `aspnet:10.0` を使用）

## ビルドと実行

```bash
# 依存を復元してビルドする
dotnet build

# 開発実行（既定では http://localhost:${{ values.http_port }}）
dotnet run --project src/Api
```

実行後のエンドポイント:

| メソッド / パス | 説明 |
| --- | --- |
| `GET /health` | ヘルスチェック（200 OK + `Healthy`） |
| `GET /weatherforecast` | サンプルのレスポンス（5 日分の天気予報） |
| `GET /openapi/v1.json` | OpenAPI ドキュメント（**開発環境のみ**公開） |

## API ドキュメント（OpenAPI）

`Microsoft.AspNetCore.OpenApi` による組み込み生成を使用しています。`Program.cs` で `AddOpenApi()` を登録し、開発環境でのみ `MapOpenApi()` により `/openapi/v1.json` を配信します。

Swagger UI / Scalar などの UI が必要な場合は、対応する NuGet パッケージを追加し、開発環境のブロック内でマッピングを追加してください（例: `Scalar.AspNetCore` の `app.MapScalarApiReference()`）。

## エラー応答（ProblemDetails）

`AddProblemDetails()` と `UseExceptionHandler()` / `UseStatusCodePages()` により、エラー時に RFC 9457 準拠の `application/problem+json` を返します。

{%- if values.use_https_redirection %}
## HTTPS

`use_https_redirection` を有効にして生成したため、`Program.cs` に `app.UseHttpsRedirection()` を含めています。リバースプロキシ / イングレスで TLS を終端する構成では、二重リダイレクトを避けるため無効化を検討してください。
{%- else %}
## HTTPS

本サービスは既定で **HTTP のみ**（`app.UseHttpsRedirection()` なし）です。TLS はリバースプロキシ / イングレス側で終端する想定です。アプリ内で HTTPS リダイレクトが必要なら `Program.cs` に `app.UseHttpsRedirection()` を追加してください。
{%- endif %}

## コンテナ

```bash
# イメージをビルドする
docker build -t ${{ values.component_id }} .

# コンテナを起動する（ホスト側 ${{ values.http_port }} 番に公開）
docker run --rm -p ${{ values.http_port }}:${{ values.http_port }} ${{ values.component_id }}
```

コンテナ内の Kestrel は `ASPNETCORE_HTTP_PORTS=${{ values.http_port }}` で待ち受けます。

## テスト

`tests/Api.Tests` に `WebApplicationFactory<Program>` を使ったインメモリ統合テストを同梱しています。

```bash
# テストを実行する
dotnet test
```

## 補足・カスタマイズ

- **プロジェクト名とフォルダ**: 本テンプレートはフォルダ名を汎用名 `src/Api`（テストは `tests/Api.Tests`）に固定し、サービス固有の名前は `Api.csproj` の `RootNamespace` / `AssemblyName`（= `${{ values.root_namespace }}`）として埋め込んでいます。必要に応じてフォルダ/ファイル名を実サービス名へ変更してください。
- **契約（gRPC / GraphQL / REST）**: API/イベントの契約は DevPortal の `contracts/`（`proto` / `graphql` / `openapi`）に集約されています。C# 向けの共有 SDK は `packages/csharp` 側で生成・公開される方針です。本テンプレートはサンプルエンドポイントのみで、契約由来のコードは含みません。
- **共有パッケージ**: DevPortal の C# 共有パッケージ（`packages/csharp`）を利用する場合は、NuGet 参照またはプロジェクト参照で取り込んでください。
