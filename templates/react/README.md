# React (TypeScript) Web テンプレート

Backstage の **Software Template**（scaffolder）です。**Vite + React 19 + TypeScript** で構成した Web フロントエンドの雛形を生成します。

DevPortal の Web 基盤（`apps/frontend/web`、共有パッケージ `packages/typescript`）と同じ技術スタック（React / TypeScript）に揃えてあります。

## 構成

```text
templates/react/
├── template.yaml      # スキャフォルダーのテンプレート定義（入力フォーム・実行ステップ）
└── skeleton/          # 生成される本体（${{ ... }} を fetch:template で置換）
    ├── package.json / .nvmrc                 # 依存・スクリプトと Node バージョン
    ├── tsconfig*.json                        # TypeScript 設定（solution + app + node）
    ├── vite.config.ts / vitest.config.ts     # Vite 設定と Vitest(jsdom) 設定
    ├── eslint.config.js                      # ESLint(flat config)
    ├── index.html                            # エントリ HTML
    ├── .gitignore
    ├── catalog-info.yaml / mkdocs.yml / docs/index.md / README.md
    └── src/                                  # アプリ本体（テストも同居）
        ├── main.tsx / App.tsx                # エントリと（サンプル）ルートコンポーネント
        ├── App.test.tsx                      # サンプルコンポーネントテスト
        ├── App.css / index.css               # スタイル
        ├── test/setup.ts                     # jest-dom マッチャの読み込み
        └── vite-env.d.ts                     # Vite のクライアント型定義
```

## 入力パラメータ

| パラメータ | 用途 |
| --- | --- |
| `component_id` | カタログ識別子（kebab-case）。`package.json` の `name` にも使用 |
| `app_title` | 表示名（`index.html` の title / 画面見出し / catalog-info / TechDocs） |
| `description` | 説明（catalog-info / README） |
| `owner` | オーナー（Group/User、OwnerPicker） |
| `system` | 所属システム（任意、EntityPicker） |
| `node_version` | 対象 Node.js メジャーバージョン（20 / 22、`.nvmrc` と `engines`） |
| `dev_port` | Vite 開発サーバーのポート（既定 5173） |
| `repo_url` | 作成先 GitHub リポジトリ（RepoUrlPicker） |

## 生成されるアプリの技術軸

- **Vite** / **React 19** / **TypeScript**（`strict`）/ ESM（`"type": "module"`）
- Lint: **ESLint 9（flat config）** + `typescript-eslint` + React Hooks / Refresh プラグイン
- テスト: **Vitest** + **@testing-library/react** + **jsdom**（`src` に同居）
- パッケージマネージャは **npm** を前提（`package-lock.json`）。pnpm / yarn を使う場合は scripts と lock を読み替えてください。

> `package.json` のバージョンは生成時点の目安です（React 19 / Vite 6 / TypeScript 5.7 / ESLint 9 / Vitest 2 系）。実運用では `npm install` 後の lock とともに最新へ追従してください。

## Backstage への登録

`app-config.yaml` の `catalog.locations` にこのテンプレートを追加します（GitHub 上のパスに合わせて調整してください）。

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/<org>/DevPortal/blob/main/templates/react/template.yaml
      rules:
        - allow: [Template]
```

> ローカル検証時は `type: file` で `templates/react/template.yaml` を指すこともできます。

## 設計メモ

- **パスは固定・値は中身に埋め込む**: `templates/kotlin` / `templates/csharp` と同じ方針で、ファイル/フォルダ名に `${{ ... }}` を使いません。`package.json` の `name` は `${{ values.component_id }}`、画面見出し等は `${{ values.app_title }}` を中身に埋め込みます。
- **JSX と `{{` の衝突回避**: Backstage の `fetch:template`（Nunjucks）は `{{ ... }}` を変数展開として解釈します。そのため `.tsx` ではインラインスタイル（`style={{ ... }}`）など **`{{` を生む書き方を避け**、スタイルは CSS クラスに分離しています。値の埋め込みは Backstage 構文の `${{ values.X }}`（先頭に `$`）でのみ行います。
- **コメント規約**: 生成物の TS/TSX・設定 JS・HTML・YAML・CSS は、DevPortal の方針に従い各行（JSX は要素単位で `{/* */}`）にコメントを付けています。
- **JSON のコメント例外**: TypeScript は `tsconfig*.json` のコメント（`//`）を許容するため各行にコメントを付けています。一方 **`package.json` は JSON コメント非対応**（npm がパースに失敗する）のため、**意図的にコメントを付けていません**。
- **テストは本体に同居**: テストは別スケルトンに分けず、本体 `skeleton/src` に同居させています（`App.test.tsx` / `test/setup.ts`）。テスト設定は `vite.config.ts` を汚さないよう独立した `vitest.config.ts`（Vitest が自動で優先読み込み）に置いています。テスト用の依存・`scripts` は常に `package.json` に含めます。テストを使わない場合はファイルと依存を削除してください。
