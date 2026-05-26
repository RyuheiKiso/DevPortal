# @k1s0-ts-config/loader

DevPortal 設定管理ライブラリの **Node 向けファイルローダ**。`@k1s0-ts-config/core` がブラウザ/RN でも動く in-memory ライブラリであるのに対し、本パッケージは `fs` を使って **JSON / YAML 設定ファイルを読み込む** 役割を担います。

- 対応形式: **JSON**（標準 `JSON.parse`、追加依存ゼロ）/ **YAML**（`js-yaml`）
- 拡張子で自動判別: `.json` / `.yaml` / `.yml`
- 同期 (`*Sync`) と非同期 (Promise) の両 API
- core の `validateConfig` / `mergeEnvConfig` と組み合わせて使う前提
- 環境変数展開（`${VAR}`）は **サポートしません**（必要なら呼び出し側で処理）

ブラウザや React Native で使う場合は、本パッケージは不要です。`@k1s0-ts-config/core` のみで完結します。

## インストール

```bash
npm install @k1s0-ts-config/loader
```

`@k1s0-ts-config/core` と `zod` は peerDependency（core 経由の zod インスタンスを共有）。core を別途インストールしてください。

## 公開 API

### 低レベル: ファイル → unknown

```ts
import { loadConfig, loadConfigSync } from "@k1s0-ts-config/loader";

const raw = await loadConfig("/etc/myapp/config.json"); // Promise<unknown>
const raw2 = loadConfigSync("/etc/myapp/config.yaml");  // unknown
```

拡張子で自動判別され、`unknown` として返ります。**検証は呼び出し側で `validateConfig` を通してください**。

### 高レベル: ファイル → 検証済み T

```ts
import { loadAndValidate } from "@k1s0-ts-config/loader";
import { createConfigSchema } from "@k1s0-ts-config/core";

const schema = createConfigSchema(["newUi"] as const);
const config = await loadAndValidate("/etc/myapp/config.yaml", schema);
// config: BaseConfig<"newUi", Theme>
```

検証失敗時は zod の `ZodError` がそのまま透過します（loader では包みません）。

### 環境別マージ用: ディレクトリ → EnvConfigMap

`dir` 配下の `dev.{json|yaml|yml}` / `staging.*` / `prod.*` をまとめて読み、core の `mergeEnvConfig` に直接渡せる形を返します。

```
config/
  dev.json        # 必須
  staging.yaml    # 任意 (欠けていたら {} 補完)
  prod.yml        # 任意
```

```ts
import { loadEnvConfigMap } from "@k1s0-ts-config/loader";
import { mergeEnvConfig, validateConfig, createConfigSchema } from "@k1s0-ts-config/core";

const map = await loadEnvConfigMap("./config");
const raw = mergeEnvConfig(map, process.env.APP_ENV as "dev" | "staging" | "prod");
const config = validateConfig(createConfigSchema(["newUi"] as const), raw);
```

JSON/YAML/YML の **混在も OK**（環境ごとに別形式で良い）。同名拡張子違いがある場合は `.json` → `.yaml` → `.yml` の優先順で先勝ち。

## エラーハンドリング

すべての失敗は `ConfigLoaderError` に包まれて投げられ、`code` フィールドで分岐できます（`cause` には元例外が保持されます）。

| code               | 発生条件                              |
| ------------------ | ------------------------------------- |
| `FILE_NOT_FOUND`   | 対象ファイル / dev 環境ファイルが無い |
| `IO_ERROR`         | 上記以外の I/O 失敗（EISDIR 等）      |
| `UNSUPPORTED_EXT`  | `.json` / `.yaml` / `.yml` 以外を指定 |
| `PARSE_ERROR`      | JSON.parse もしくは YAML パーサが失敗 |

```ts
import { loadConfig, ConfigLoaderError } from "@k1s0-ts-config/loader";

try {
  await loadConfig("./missing.json");
} catch (e) {
  if (e instanceof ConfigLoaderError && e.code === "FILE_NOT_FOUND") {
    // フォールバック処理
  } else {
    throw e;
  }
}
```

zod 検証エラーは loader で包まず `ZodError` をそのまま透過させます（core の `validateConfig` の挙動と一致）。

## ビルド

```bash
npm install
npm run typecheck
npm run build
```

出力は `dist/`（ESM + `.d.ts`）。コメントは `removeComments: true` で除去されます。

## テスト・カバレッジ

vitest で単体テストを実行できます。

```bash
npm test              # 1 回だけ走らせる
npm run test:watch    # ファイル変更を監視
npm run test:coverage # カバレッジ計測（@vitest/coverage-v8）
```

カバレッジ計測の方針は `vitest.config.ts` に定義しています。

- provider: `v8`（istanbul より低オーバーヘッド）
- 計測対象: `src/**/*.ts`
- 除外: `*.test.ts` / `src/types.ts`（型のみ）/ `src/index.ts`（re-export のみ）/ `__fixtures__/**`
- 閾値: `statements` / `branches` / `functions` / `lines` を **すべて 100%** に設定（後退検知のため）

`prepublishOnly` は `clean → build → test` の順で動くため、テストが落ちると publish できません。

## Verdaccio publish の順序

config パッケージ群は内部依存があるため **以下の順序で publish** します。

```
1. core を npm version bump → npm publish
2. loader / react / react-native の version を core と一致させる
3. loader を npm publish（prepublishOnly が file:../core を version 文字列に書き換え、
   postpublish で file:../core に戻す）
4. react を npm publish（同上）
5. react-native を npm publish（同上）
```

**注意**: publish 失敗時は `postpublish` が走らず、`package.json` の `dependencies."@k1s0-ts-config/core"` が `"0.1.0"` のような version 文字列のまま残る可能性があります。その場合は手動で `"file:../core"` に戻してください（`git diff package.json` で確認）。
