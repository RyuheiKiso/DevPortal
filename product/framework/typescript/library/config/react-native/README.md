# @k1s0-ts-config/react-native

DevPortal 設定管理ライブラリの React Native 連携。

`@k1s0-ts-config/core` の機能に加え、React Native 固有の `Platform.OS` 別マージユーティリティ (`mergePlatformConfig`) を提供します。

## インストール

```bash
npm install @k1s0-ts-config/core @k1s0-ts-config/react-native
```

`react` / `react-native` は peerDependencies です。

## 使い方

```tsx
import { defaultTheme } from "@k1s0-ts-config/core";
import {
  ConfigProvider,
  useConfig,
  useFeatureFlag,
  useTheme,
  mergePlatformConfig,
} from "@k1s0-ts-config/react-native";

const config = {
  env: "dev" as const,
  featureFlags: { newUi: true },
  theme: mergePlatformConfig({
    default: defaultTheme,
    windows: { colors: { ...defaultTheme.colors, primary: "#0078D4" } },
    ios: { colors: { ...defaultTheme.colors, primary: "#007AFF" } },
  }),
};

function App() {
  return (
    <ConfigProvider config={config}>
      <Screen />
    </ConfigProvider>
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

### mergeEnvConfig / mergePlatformConfig は浅いマージ

`mergeEnvConfig` (core) と `mergePlatformConfig` は浅いマージで、**ネストオブジェクトは map 側と参照を共有します**。
返り値の `result.colors` を mutate すると `map.default.colors` も書き換わるので、必要なら呼び出し側で `structuredClone` してください。

## ビルド & テスト

dual build（ESM + CJS）で出力します。

- `dist/esm/`: ESM + `.d.ts`（バンドラ経由・型解決用、`package.json` の `"type": "module"` で `.js` を ESM 解決）
- `dist/cjs/`: CJS（Metro / Jest が `require()` で取得する経路、ビルド時に `dist/cjs/package.json` へ `{"type":"commonjs"}` を書き出して CJS 解決に切替）

```bash
npm install                      # 初回のみ依存解決
npm run typecheck                # tsconfig.typecheck.json（sibling core を paths で直結）
npm run test                     # Vitest + react-test-renderer
npm run test:coverage            # statements/branches/functions/lines = 100% 強制（autoUpdate: false）
npm run build                    # esm + cjs を生成（dist/cjs/package.json も自動生成）
```

## scaffold へのローカル統合

`product/scaffold/react_native` で動作確認する場合の推奨は **tarball install**:

```bash
cd product/framework/typescript/config/core
npm pack
cd ../react-native
npm pack
cd ../../../../scaffold/react_native
npm install ../../framework/typescript/config/core/k1s0-ts-config-core-0.1.0.tgz \
            ../../framework/typescript/config/react-native/k1s0-ts-config-react-native-0.1.0.tgz
```

Metro は symlink を嫌うため `npm link` は非推奨です。`file:` 指定でもコピーが入るので安定動作します。

## Verdaccio publish の順序と自動化

`@k1s0-ts-config/react-native` は `@k1s0-ts-config/core` に依存するため、**core を先に publish** する必要があります。

```
1. core を npm publish
2. このパッケージの version を core と一致させる
3. npm publish を実行
   - prepublishOnly が "@k1s0-ts-config/core": "file:../core" を
     自身と同じ version 文字列（例 "0.1.0"）に書き換え
   - publish 完了後、postpublish が "file:../core" に自動復元
```

**publish 失敗時**: `postpublish` が走らないため `package.json` が書き換わったまま残る可能性があります。`git diff package.json` で確認し、`"@k1s0-ts-config/core": "file:../core"` に手動復元してください。
