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

## ビルド構成

dual build（ESM + CJS）で出力します。

- `dist/esm/`: ESM + `.d.ts`（バンドラ経由・型解決用）
- `dist/cjs/`: CJS（Metro / Jest が `require()` で取得する経路）

`package.json` の `type` フィールドは **意図的に未指定**。これにより `.js` がデフォルト CJS 扱いされ、Metro が `main` フィールド経由でロードする際にトラブルが起きない構成です。

```bash
npm install
npm run typecheck
npm run build
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
