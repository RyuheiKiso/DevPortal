# @k1s0-ts-config/core

DevPortal 共通の設定読取・管理ライブラリ（コア機能）。

- 環境別（dev / staging / prod）の設定マージ
- 機能フラグ (feature toggle)
- UI テーマ型定義
- zod による設定値スキーマ validation

このパッケージは UI フレームワーク非依存です。React 連携は `@k1s0-ts-config/react`、React Native は `@k1s0-ts-config/react-native` を利用してください。

## インストール

```bash
npm install @k1s0-ts-config/core
```

社内 Verdaccio を利用する場合は、リポジトリの `.npmrc` で registry を `http://<verdaccio-host>:<port>` に向けてください。

## 公開 API

### 環境マージ

```ts
import { mergeEnvConfig, type Env } from "@k1s0-ts-config/core";

const map = {
  dev: { apiUrl: "http://localhost:3000", logLevel: "debug" },
  staging: { apiUrl: "https://stg.example.com" },
  prod: { apiUrl: "https://example.com", logLevel: "warn" },
};

const env: Env = "staging";
const cfg = mergeEnvConfig(map, env);
// => { apiUrl: "https://stg.example.com", logLevel: "debug" }
```

### 機能フラグ

```ts
import { isFeatureEnabled, withOverrides } from "@k1s0-ts-config/core";

const flags = { newUi: false, betaSearch: true };

isFeatureEnabled(flags, "betaSearch"); // true

const overridden = withOverrides(flags, { newUi: true });
// => { newUi: true, betaSearch: true }
```

### テーマ

```ts
import { defaultTheme, type Theme } from "@k1s0-ts-config/core";

const myTheme: Theme = {
  ...defaultTheme,
  colors: { ...defaultTheme.colors, primary: "#ff6600" },
};
```

### スキーマ validation

```ts
import { createConfigSchema, validateConfig } from "@k1s0-ts-config/core";

const schema = createConfigSchema(["newUi", "betaSearch"] as const);
const config = validateConfig(schema, rawJson);
// config: BaseConfig<"newUi" | "betaSearch", Theme>
```

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

出力は `dist/`（ESM + `.d.ts`）。コメントは `removeComments: true` で除去されます。

## Verdaccio publish の順序

3 パッケージは内部依存があるため **以下の順序で publish** する必要があります。

```
1. core を npm version bump（例: npm version patch） → npm publish --registry http://<verdaccio>
2. react / react-native の version を core と一致させる（手動 or npm version で同期）
3. react を npm publish（prepublishOnly が file:../core を core のバージョン文字列に書き換え、
   postpublish で file:../core に戻す）
4. react-native を npm publish（同上）
```

**注意**: publish 失敗時は `postpublish` が走らず、`package.json` の `dependencies."@k1s0-ts-config/core"` が `"0.1.0"` のような version 文字列のまま残る可能性があります。その場合は手動で `"file:../core"` に戻してください（`git diff package.json` で確認）。

## scaffold へのローカル統合手順

`product/scaffold/react` や `product/scaffold/react_native` でローカル動作確認する場合は、以下のいずれかを利用します（推奨は 1）。

1. **tarball install（最も再現性高い）**
   ```bash
   cd product/framework/typescript/config/core
   npm pack
   # => k1s0-ts-config-core-0.1.0.tgz
   cd ../../../../scaffold/react
   npm install ../../framework/typescript/config/core/k1s0-ts-config-core-0.1.0.tgz
   ```

2. **`file:` プロトコル依存**
   ```json
   {
     "dependencies": {
       "@k1s0-ts-config/core": "file:../../framework/typescript/config/core"
     }
   }
   ```

3. **npm link**（Web/Vite では OK、Metro 経由の RN では symlink を嫌うため非推奨）
   ```bash
   cd product/framework/typescript/config/core && npm link
   cd ../../../../scaffold/react && npm link @k1s0-ts-config/core
   ```
