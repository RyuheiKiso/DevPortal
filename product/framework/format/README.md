# framework/format — ツール別ファイルフォーマット雛形

DevPortal で使う各種ツールの設定ファイル / メタデータファイルの **最小限の雛形** を集めたディレクトリです。`framework/typescript` (TypeScript ライブラリ群) / `framework/rust` (Rust ライブラリ群) と並ぶカテゴリとして、特定言語ではなく特定ツール用のフォーマットをまとめます。

## 収録ツール

| ディレクトリ | 対象ツール | 内容 |
|---|---|---|
| [backstage/](backstage/README.md) | Backstage Software Catalog | `catalog-info.yaml` の Component / API / System / Domain / Resource / Group / User / Location 各種別の最小雛形 |

## 今後追加候補

GitHub Actions ワークフロー、MkDocs / TechDocs 設定 (`mkdocs.yml`)、Backstage Software Templates (`template.yaml`)、Backstage 本体設定 (`app-config.yaml`) などの雛形を、需要に応じて同じ粒度で追加していきます。
