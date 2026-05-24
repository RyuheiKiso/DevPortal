# Backstage カタログエンティティ最小雛形

DevPortal の setup ツールでインストールした社内 Backstage (`http://localhost:7007`) の Software Catalog に登録するエンティティの **最小限の雛形** を集めたディレクトリです。各 YAML は必須フィールドのみを埋めた状態でコピペ可能なため、リポジトリのルートに置いて `my-*` プレースホルダを置換するだけで Backstage に登録できます。

## 雛形一覧

`catalog-info/` 配下に Backstage の主要 8 種別を 1 ファイルずつ用意しています。

| ファイル | 種別 | 必須 spec フィールド | 主な用途 |
|---|---|---|---|
| [catalog-info/component.yaml](catalog-info/component.yaml) | Component | `type`, `lifecycle`, `owner` | サービス / Web サイト / ライブラリの登録 |
| [catalog-info/api.yaml](catalog-info/api.yaml) | API | `type`, `lifecycle`, `owner`, `definition` | OpenAPI / GraphQL / gRPC 等の API 定義 |
| [catalog-info/system.yaml](catalog-info/system.yaml) | System | `owner` | 関連する Component / API / Resource をまとめる単位 |
| [catalog-info/domain.yaml](catalog-info/domain.yaml) | Domain | `owner` | 複数 System を束ねる業務領域 |
| [catalog-info/resource.yaml](catalog-info/resource.yaml) | Resource | `type`, `owner` | DB / S3 / k8s クラスタ等のインフラ資源 |
| [catalog-info/group.yaml](catalog-info/group.yaml) | Group | `type`, `children` | チーム / 部署 / 組織単位 |
| [catalog-info/user.yaml](catalog-info/user.yaml) | User | `memberOf` | 個人ユーザー |
| [catalog-info/location.yaml](catalog-info/location.yaml) | Location | (空でも可、実用上 `targets`) | 他カタログファイルへのポインタ |

共通の envelope はいずれも `apiVersion: backstage.io/v1alpha1` + `kind` + `metadata.name`。

## 使い方

1. **コピー**: `catalog-info/<種別>.yaml` を登録対象リポジトリのルート (または任意のパス) にコピーします。慣例的に `catalog-info.yaml` というファイル名にします。
2. **置換**: `my-component` / `my-api` / `my-team` / `my-system` / `my-domain` / `my-user` 等の `my-*` プレースホルダを実際の値に置換します。YAML 内のキーには日本語コメントを付けてあるので、各フィールドの役割を見ながら編集できます。
3. **登録 (UI)**: Backstage を開き、左メニュー「Create」→ 右上「Register Existing Component」から、コミット済み YAML の URL (GitHub raw もしくは Web URL) を入力すると Software Catalog に取り込まれます。
4. **登録 (config)**: または DevPortal の `%ProgramData%\DevPortal\backstage\app\app-config.yaml` の `catalog.locations` に下記を追記してサービス再起動でも取り込めます。

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/my-org/my-repo/blob/main/catalog-info.yaml
```

## 注意点

- `owner` で参照する Group / User エンティティが先に登録されている必要があります。新規組織であれば `group.yaml` と `user.yaml` を先に Location 経由で登録してください。
- `name` は kebab-case 必須で、namespace (既定 `default`) 内で衝突できません。
- API の `definition` は雛形ではダミーの 1 行 OpenAPI を入れています。実際の定義は `$text: ./openapi.yaml` 形式で外部ファイル参照することも可能です。

## 関連

- 公式仕様 (Descriptor Format): https://backstage.io/docs/features/software-catalog/descriptor-format
- DevPortal setup ツール: [../../../setup/README.md](../../../setup/README.md) で Backstage の Windows サービス化手順を案内
- プラグイン管理 GUI: DevPortal setup GUI から `@backstage/plugin-*` のインストールが可能
