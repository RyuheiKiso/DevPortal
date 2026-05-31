# contracts/proto

gRPC / Protocol Buffers の `.proto` 定義を置く。
サービス間RPCの契約であり、各言語のクライアントSDK（`packages/csharp`・`packages/kotlin`・`packages/typescript`）の生成元。

- `.proto` を変更したら、各言語のコード生成を再実行して `packages/` 配下を更新する。
- 後方互換を壊す変更（フィールド番号の再利用・削除など）は避ける。
