# ${{ values.name }}

${{ values.description }}

DevPortal の React 19 + TypeScript + Vite スターターから生成された Web SPA です。

## セットアップ

```powershell
# 依存解決
npm install

# 開発サーバ起動
npm run dev

# プロダクションビルド
npm run build

# Lint
npm run lint
```

## ディレクトリ構成

```
${{ values.name }}/
├─ index.html
├─ src/
│  ├─ main.tsx     # エントリーポイント
│  ├─ App.tsx      # メインコンポーネント
│  └─ assets/      # 画像等
├─ public/         # 静的ファイル
├─ vite.config.ts
└─ tsconfig*.json
```

## 関連リンク

- React 19: https://react.dev/
- Vite: https://vite.dev/
- TypeScript: https://www.typescriptlang.org/
