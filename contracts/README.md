# contracts

サービス間・チーム間のインターフェース（API / イベントの「契約」）を集約するディレクトリ。
言語非依存のスキーマ定義をここに置き、各言語向けのクライアントSDKは `package/`（または `packages/`）側で生成・公開する。

## サブディレクトリ

| ディレクトリ | 用途 |
| --- | --- |
| `proto/` | gRPC / Protocol Buffers (`.proto`)。サービス間RPCの契約であり、SDK生成元。 |
| `openapi/` | OpenAPI / Swagger。REST API のスキーマ。 |
| `graphql/` | GraphQL スキーマ (SDL)。BFFが公開するクエリ/ミューテーションの契約。 |
| `events/` | AsyncAPI / Avro / JSON Schema。非同期メッセージング（イベント駆動）の契約。 |

> 現時点で実際に利用しているのは `proto/` のみ。残りは将来の拡張に備えた置き場。
