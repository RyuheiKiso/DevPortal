# ${{ values.app_title }}

${{ values.description }}

**Vite + React 19 + TypeScript** で構成した Web フロントエンドです。DevPortal の Backstage テンプレート `react` から生成されています。

## 構成

```text
${{ values.component_id }}/
├── index.html               # Vite のエントリ HTML
├── package.json / .nvmrc    # 依存・スクリプトと Node バージョン
├── vite.config.ts           # Vite 設定（開発ポート ${{ values.dev_port }}）
├── vitest.config.ts         # Vitest 設定（jsdom）
├── eslint.config.js         # ESLint（flat config）
├── tsconfig.json            # ソリューション（app / node を参照）
├── tsconfig.app.json        # アプリ（src）の TypeScript 設定
├── tsconfig.node.json       # ビルドツール（vite.config.ts）の TypeScript 設定
└── src/
    ├── main.tsx             # エントリポイント（#root への描画）
    ├── App.tsx              # ルートコンポーネント（サンプル）
    ├── App.test.tsx         # App のコンポーネントテスト
    ├── App.css / index.css  # スタイル
    ├── test/setup.ts        # テストのセットアップ（jest-dom 読み込み）
    └── vite-env.d.ts        # Vite のクライアント型定義
```

## 前提環境

- **Node.js ${{ values.node_version }}**（`.nvmrc` でバージョンを固定。`nvm use` で切り替え可能）
- パッケージマネージャは **npm**（`package-lock.json`）。pnpm / yarn を使う場合は `scripts` と lock を読み替えてください。

## 開発と実行

```bash
# 依存をインストールする
npm install

# 開発サーバーを起動する（http://localhost:${{ values.dev_port }}）
npm run dev

# Lint を実行する
npm run lint

# 本番ビルド（tsc による型チェック + Vite バンドル）
npm run build

# ビルド結果をローカルサーバーで確認する
npm run preview
```

## TypeScript 設定

Vite 公式の構成にならい、3 ファイルに分割しています。

- `tsconfig.json`: 参照だけを持つソリューション（`tsc -b` の起点）
- `tsconfig.app.json`: `src`（ブラウザ DOM 環境）の設定
- `tsconfig.node.json`: `vite.config.ts`（Node 環境）の設定

`npm run build` は `tsc -b`（プロジェクト参照ビルドで型チェック）→ `vite build`（バンドル）の順で実行します。

## Lint

ESLint 9 の **flat config**（`eslint.config.js`）を使用し、`typescript-eslint` の推奨ルールに加えて React Hooks / React Refresh のルールを適用します。

## テスト

`src/App.test.tsx` に **Vitest + @testing-library/react** によるコンポーネントテストを同梱しています。設定は `vitest.config.ts`（`jsdom` 環境、`src/test/setup.ts` で jest-dom マッチャを読み込み）です。

```bash
# テストを一度だけ実行する
npm run test

# 変更を監視しながらテストを実行する
npm run test:watch
```

## 補足・カスタマイズ

- **インラインスタイルと Backstage テンプレート**: 本テンプレートは Backstage 生成時の `{{ ... }}` 衝突を避けるため、`.tsx` でインラインスタイル（`style={{ ... }}`）を使わず CSS クラスに分離しています。生成後は通常どおりインラインスタイルを利用して構いません。
- **API との通信**: API/イベントの契約は DevPortal の `contracts/`（`proto` / `graphql` / `openapi`）に集約されています。TypeScript 向けの共有 SDK は `packages/typescript` 側で生成・公開される方針です。本テンプレートはネットワーク実装を含みません。
- **環境変数**: Vite では `import.meta.env` から参照します。クライアントへ露出する変数は `VITE_` プレフィックスを付け、`.env` ファイルで管理してください（秘密情報は置かないこと）。
