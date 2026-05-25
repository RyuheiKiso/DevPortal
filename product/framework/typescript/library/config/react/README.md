# @k1s0-ts-config/react

DevPortal 設定管理ライブラリの React 連携。

`@k1s0-ts-config/core` で構築した設定オブジェクトを React Context 経由でアプリ全体に提供し、`useConfig` / `useFeatureFlag` / `useTheme` hook で取り出せます。

## インストール

```bash
npm install @k1s0-ts-config/core @k1s0-ts-config/react
```

`react` は peerDependencies です（`>=18.0.0`）。

## 使い方

```tsx
import { mergeEnvConfig, defaultTheme } from "@k1s0-ts-config/core";
import { ConfigProvider, useConfig, useFeatureFlag, useTheme } from "@k1s0-ts-config/react";

const config = {
  env: "dev" as const,
  featureFlags: { newUi: true },
  theme: defaultTheme,
};

function App() {
  return (
    <ConfigProvider config={config}>
      <Page />
    </ConfigProvider>
  );
}

function Page() {
  const cfg = useConfig();
  const newUi = useFeatureFlag("newUi");
  const theme = useTheme();
  return (
    <div style={{ background: theme.colors.background, color: theme.colors.text }}>
      env: {cfg.env}, newUi: {String(newUi)}
    </div>
  );
}
```

## ビルド & テスト

- `npm install` — 初回のみ依存解決
- `npm run typecheck` — `tsconfig.typecheck.json`（sibling `@k1s0-ts-config/core` を `paths` で直結）
- `npm run test` / `npm run test:coverage` — Vitest + react-test-renderer（coverage **statements/branches/functions/lines = 100% 強制**、`autoUpdate: false`）
- `npm run build` — ESM 出力（`dist/`）

`@k1s0-ts-config/core` は **モノレポを採用していないため `dependencies` で `file:../core` を直接参照**しています。

### Verdaccio publish の順序と自動化

`@k1s0-ts-config/react` は `@k1s0-ts-config/core` に依存するため、**core を先に publish** する必要があります。

```
1. core を npm publish（core/README.md の手順を参照）
2. このパッケージの version を core と一致させる
3. npm publish を実行
   - prepublishOnly が "@k1s0-ts-config/core": "file:../core" を
     自身と同じ version 文字列（例 "0.1.0"）に書き換え
   - publish 完了後、postpublish が "file:../core" に自動復元
```

**publish 失敗時**: `postpublish` が走らないため `package.json` が書き換わったまま残る可能性があります。`git diff package.json` で確認し、`"@k1s0-ts-config/core": "file:../core"` に手動復元してください。

## scaffold へのローカル統合

`@k1s0-ts-config/core` の README に記載した 3 方式（tarball / file: / npm link）と同じ手順を、`@k1s0-ts-config/react` についても適用してください。
