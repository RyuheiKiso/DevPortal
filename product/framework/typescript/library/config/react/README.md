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

## 利用上の注意

### theme は事前に検証してから渡す

`useTheme()` は `BaseConfig.theme` を `as Theme` でキャストするだけで、ランタイム検証は行いません。
不正な theme を `ConfigProvider` に渡すとアクセス時に undefined エラーになります。
**`ConfigProvider` に渡す前に `themeSchema.parse(theme)` で必ず検証してください**：

```tsx
import { themeSchema, validateConfig } from "@k1s0-ts-config/core";

const safeTheme = validateConfig(themeSchema, rawTheme);
const config = { env: "dev" as const, featureFlags: {}, theme: safeTheme };
```

### config は参照を安定させる（再レンダリングの抑制）

`<ConfigProvider config={...}>` の `config` は React Context の value としてそのまま流れます。
**親コンポーネントのレンダリングごとに新しい `config` オブジェクトを生成すると、配下の `useConfig` を使う全コンポーネントが再レンダリングされます**。
モジュールレベル定数で持つか、`useMemo` で参照を安定させてください：

```tsx
// ✅ モジュールレベルで一度だけ構築
const config = { env: "dev" as const, featureFlags: { newUi: true }, theme: safeTheme };

// または ✅ useMemo で安定化
const config = useMemo(
  () => ({ env, featureFlags, theme: safeTheme }),
  [env, featureFlags, safeTheme],
);
```

### useFeatureFlag は型絞り込みできる

`useFeatureFlag` はジェネリクスでフラグ名を絞り込めます。タイプミスをコンパイル時に検出するために、
アプリ側で `Flags` 型を定義して指定するのを推奨します：

```tsx
type Flags = "newUi" | "betaSearch";
const enabled = useFeatureFlag<Flags>("newUi");
// useFeatureFlag<Flags>("typoName") // ← TypeScript エラー
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
