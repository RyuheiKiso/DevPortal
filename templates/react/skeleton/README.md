# ${{ values.app_title }}

${{ values.description }}

**Vite + React 19 + TypeScript** で構成した Web フロントエンドです。DevPortal の Backstage テンプレート `react` から生成されています。

## クイックスタート

> **前提**: Node.js ${{ values.node_version }}（`.nvmrc` 参照）。パッケージマネージャは npm を前提としています。

```bash
# 依存をインストールする
npm install

# 開発サーバーを起動する（http://localhost:${{ values.dev_port }}）
npm run dev

# 本番ビルド（型チェック + バンドル）
npm run build

# ビルド結果をローカルで確認する
npm run preview
```

## ディレクトリ

| パス | 役割 |
| --- | --- |
| `src/main.tsx` | エントリポイント（`#root` への描画） |
| `src/App.tsx` | ルートコンポーネント（サンプル） |
| `src/*.css` | スタイル（`index.css` はグローバル、`App.css` はコンポーネント用） |
| `index.html` | Vite のエントリ HTML |
| `vite.config.ts` | Vite 設定（開発ポート ${{ values.dev_port }}） |
| `eslint.config.js` | ESLint（flat config） |
| `tsconfig*.json` | TypeScript 設定（solution / app / node） |

詳細な手順・カスタマイズ方法は [`docs/index.md`](docs/index.md)（TechDocs）を参照してください。

## 主な技術スタック

- Vite / React 19 / TypeScript（`strict`）/ ESM
- Lint: ESLint 9（flat config） + typescript-eslint
- 表示名 / 説明: `${{ values.app_title }}` / `${{ values.description }}`
