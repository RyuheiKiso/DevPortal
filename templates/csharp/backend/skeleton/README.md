# ${{ values.app_title }}

${{ values.description }}

C# (.NET 10) の **Minimal API** で構成したバックエンド Web API サービスです。DevPortal の Backstage テンプレート `csharp/backend` から生成されています。

## クイックスタート

> **前提**: .NET 10 SDK（`global.json` で `10.0.x` にピン）。

```bash
# 依存を復元してビルドする
dotnet build

# 開発実行（http://localhost:${{ values.http_port }}）
dotnet run --project src/Api

# OpenAPI ドキュメント（開発環境のみ）
#   http://localhost:${{ values.http_port }}/openapi/v1.json
# ヘルスチェック
#   http://localhost:${{ values.http_port }}/health
```

## ディレクトリ

| パス | 役割 |
| --- | --- |
| `src/Api` | Web API 本体（`Program.cs`、`Endpoints/`、`Models/`） |
| `src/Api/appsettings*.json` | 構成（ログレベル・許可ホストなど） |
| `Directory.Build.props` | 全プロジェクト共通のビルド設定（`net10.0` / Nullable / ImplicitUsings） |
| `Backend.slnx` | ソリューション（.NET 10 の XML 形式） |
| `Dockerfile` | コンテナイメージ（multi-stage ビルド） |

詳細な手順・エンドポイント・カスタマイズ方法は [`docs/index.md`](docs/index.md)（TechDocs）を参照してください。

## 主な技術スタック

- .NET 10（`net10.0`）/ ASP.NET Core Minimal API
- 組み込み OpenAPI（`Microsoft.AspNetCore.OpenApi`）/ ヘルスチェック / ProblemDetails
- ルート名前空間 / アセンブリ名: `${{ values.root_namespace }}`
