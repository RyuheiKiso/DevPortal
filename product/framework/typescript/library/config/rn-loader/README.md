# @k1s0-ts-config/rn-loader

DevPortal 設定管理ライブラリの **React Native / React Native for Windows 向けファイルローダ**。`@k1s0-ts-config/loader` が Node 専用 (`fs` 直接利用) なのに対し、本パッケージは RN/RNW のファイルシステム API を抽象化し、`react-native-fs` または `expo-file-system` をバックエンドとして利用します。

- 対応形式: **JSON** + **YAML** (`js-yaml`)、拡張子 (`.json` / `.yaml` / `.yml`) で自動判別
- バックエンド: `react-native-fs` / `expo-file-system` (いずれも **peerDependency optional**)
- API は **非同期のみ**（RN/Expo の FS API がそもそも async）
- core の `validateConfig` / `mergeEnvConfig` と組み合わせて使う前提
- 環境別マージ (dev/staging/prod) サポート
- 環境変数展開（`${VAR}`）はサポートしません

Node やブラウザで使う場合は本パッケージ不要です。Node は [`@k1s0-ts-config/loader`](../loader/README.md)、ブラウザは `core` のみで完結します。

## 制約・対応プラットフォーム

| Platform.OS | `createRNFSLoader` (react-native-fs) | `createExpoLoader` (expo-file-system) |
|-------------|--------------------------------------|--------------------------------------|
| `ios`       | ✅ 対応 | ✅ 対応 |
| `android`   | ✅ 対応 | ✅ 対応 |
| `windows` (RNW)   | ✅ 対応 | ❌ **非対応** (Expo SDK が RNW 公式サポート外) |
| `macos`     | ✅ 対応 (`react-native-macos`) | ❌ 非対応 |
| `web`       | ❌ 非対応 (`react-native-fs` に Web 実装なし) | ❌ 非対応 (`documentDirectory` が null) |

**バックエンドの選び方**:

- **RNW で使うなら `createRNFSLoader` 一択**。`createExpoLoader` を呼ぶと `BACKEND_UNAVAILABLE` で失敗します（Expo SDK 自体が RNW を公式サポートしていないため）
- bare RN は `react-native-fs` または手動セットアップした `expo-file-system` のどちらでも可
- Expo 管理プロジェクト (managed workflow) では `expo-file-system` を使う
- Web 共有コードで設定読込が必要な場合は Platform 分岐で `fetch` などを使う（または `@k1s0-ts-config/react-native` の `mergePlatformConfig` で `web` 分岐に静的設定を渡す）

**Web は両バックエンドとも非対応**:
- `react-native-fs` は Web で実装されていない
- `expo-file-system` は Web で `documentDirectory` / `cacheDirectory` が `null` を返す → `BACKEND_UNAVAILABLE` が投げられる

## RNW でのパス解決

RNFS バックエンドは Windows の `DocumentDirectoryPath` (例: `C:\Users\<user>\AppData\Local\Packages\<app>\LocalState`) を検出し、**バックスラッシュ区切りで一貫してパスを結合**します。POSIX 環境では従来通りフォワードスラッシュで結合されるので、`Platform.OS` 分岐は不要です。

```ts
// RNW: RNFS.DocumentDirectoryPath が "C:\\Users\\..\\LocalState" のとき
loader.loadConfig("config.json")
// → "C:\\Users\\..\\LocalState\\config.json" を読む

// iOS/Android: RNFS.DocumentDirectoryPath が "/var/mobile/.../Documents" のとき
loader.loadConfig("config.json")
// → "/var/mobile/.../Documents/config.json" を読む
```

絶対パス指定の場合は `baseDir` を無視するルールも RNW で利用できます:

```ts
const loader = createRNFSLoader({ baseDir: "documents" });
loader.loadConfig("C:\\ProgramData\\MyApp\\config.json");
// → そのまま読む (baseDir は無視)
```

## 絶対パスの扱い

`baseDir` を指定していても、`filePath` が絶対パス/URI 指定なら **baseDir は無視**され `filePath` がそのまま使われます:

- RNFS バックエンド: POSIX 絶対パス (`/...`)、Windows ドライブレター (`C:\\...`)、UNC (`\\\\server\\...`) を検出
- Expo バックエンド: `file://` / `https://` / `http://` / `content://` / `asset://` / `ph://` スキームを検出

```ts
const loader = createRNFSLoader({ baseDir: "documents" });
await loader.loadConfig("app.json");          // → /docs/app.json
await loader.loadConfig("/etc/app.json");     // → /etc/app.json (baseDir 無視)
```

## Expo SDK 互換性

`expo-file-system` は **SDK 52+ の新 File API** と **SDK <52 の legacy API** の両方に対応しています。本パッケージは import 時に `File` クラスの有無で自動判別し、適切な API を使います。`peerDependencies` は `expo-file-system >=16.0.0` を指定していますが、新旧どちらでも動作します。

### Expo 新 File API での並列性能

`loadEnvConfigMap` は dev 確定後に staging/prod を **並列読込** します。新 File API (`new File(uri).text()`) を 3 並列で実行する設計ですが、Expo のネイティブ FS 実装がメインスレッドをブロックするケースでは順次実行より遅くなる可能性があります。**並列性能は実機 (iOS / Android) で計測することを推奨**します。並列が逆効果な場合は `loadConfig` を直接 await で順次呼ぶ形でラップしてください。

## インストール

```bash
npm install @k1s0-ts-config/rn-loader
# 用途に応じて以下のいずれか(または両方)を別途インストール:
npm install react-native-fs    # bare RN / RNW
npm install expo-file-system   # Expo
```

`@k1s0-ts-config/core` と `zod` は peerDependency。core を別途インストールしてください。

## クイックスタート

### `react-native-fs` バックエンド（RN / RNW 両対応）

```ts
import { createRNFSLoader } from "@k1s0-ts-config/rn-loader";
import { createConfigSchema } from "@k1s0-ts-config/core";

// 永続データディレクトリ (RNFS.DocumentDirectoryPath) を基準にロード
const loader = createRNFSLoader({ baseDir: "documents" });

const schema = createConfigSchema(["newUi"] as const);
const config = await loader.loadAndValidate("app.json", schema);
// config: BaseConfig<"newUi", Theme>
```

`baseDir` は次の 3 種類:
- `"documents"` — `RNFS.DocumentDirectoryPath` (永続データ、ユーザーデータ向け)
- `"cache"` — `RNFS.CachesDirectoryPath` (キャッシュ、OS が消す可能性あり)
- 省略 — `filePath` を絶対パスとして扱う

### `expo-file-system` バックエンド（Expo）

```ts
import { createExpoLoader } from "@k1s0-ts-config/rn-loader";

const loader = createExpoLoader({ baseDir: "document" });
const config = await loader.loadAndValidate("app.json", schema);
```

`baseDir` は次の 2 種類（Expo の用語に合わせて単数形）:
- `"document"` — `FileSystem.documentDirectory`
- `"cache"` — `FileSystem.cacheDirectory`
- 省略 — `filePath` を絶対 URI として扱う

### 環境別マージ（dev/staging/prod）

ディレクトリ配下の `dev.{json|yaml|yml}` / `staging.*` / `prod.*` を読み、core の `mergeEnvConfig` にそのまま渡せる形を返します。

```ts
import { createRNFSLoader } from "@k1s0-ts-config/rn-loader";
import { mergeEnvConfig, validateConfig, createConfigSchema } from "@k1s0-ts-config/core";

const loader = createRNFSLoader({ baseDir: "documents" });
const map = await loader.loadEnvConfigMap("config");
// map: { dev, staging, prod }

const raw = mergeEnvConfig(map, env);
const config = validateConfig(createConfigSchema(["newUi"] as const), raw);
```

`dev` は必須。`staging` / `prod` が無ければ `{}` に補完されます。

### 低レベル API

スキーマ検証を伴わない素のロード:

```ts
const raw = await loader.loadConfig("app.json"); // Promise<unknown>
const exists = await loader.exists?.("app.json"); // ※ backend に直接アクセスする場合
```

### 自前のバックエンド

`FileSystemBackend` を実装すれば、OTA 配信や custom ストレージにも対応できます:

```ts
import { createLoader, type FileSystemBackend } from "@k1s0-ts-config/rn-loader";

const customBackend: FileSystemBackend = {
  async readFile(path) { /* ... */ },
  async exists(path) { /* ... */ },
};
const loader = createLoader(customBackend);
```

## エラーハンドリング

すべての失敗は `ConfigLoaderError` に包まれ、`code` フィールドで分岐できます（`cause` には元例外を保持）。

| code                  | 発生条件                                              |
| --------------------- | ----------------------------------------------------- |
| `FILE_NOT_FOUND`      | 対象ファイル / dev 環境ファイルが無い                 |
| `IO_ERROR`            | バックエンドの read 失敗                              |
| `UNSUPPORTED_EXT`     | `.json` / `.yaml` / `.yml` 以外を指定                 |
| `PARSE_ERROR`         | JSON / YAML パース失敗、または top-level がオブジェクトでない |
| `BACKEND_UNAVAILABLE` | peerDep 未インストール、または Web 環境で documentDirectory が null |

```ts
import { ConfigLoaderError } from "@k1s0-ts-config/rn-loader";

try {
  await loader.loadConfig("app.json");
} catch (e) {
  if (e instanceof ConfigLoaderError && e.code === "BACKEND_UNAVAILABLE") {
    // インストールガイドを表示
  } else {
    throw e;
  }
}
```

zod 検証エラーは `ZodError` がそのまま透過します。

## `mergePlatformConfig` との合わせ技

`@k1s0-ts-config/react-native` の `mergePlatformConfig` と組み合わせて、OS 別のオーバーライドも実現できます:

```ts
import { mergePlatformConfig } from "@k1s0-ts-config/react-native";

const raw = (await loader.loadConfig("app.json")) as PlatformConfigMap<MyConfig>;
const cfg = mergePlatformConfig(raw); // ios / android / windows / macos の差分を適用
```

## ビルド

```bash
npm install
npm run typecheck
npm run build   # ESM (dist/esm) + CJS (dist/cjs) の dual build
```

ビルド完了後、`dist/cjs/package.json` に `{"type":"commonjs"}` が埋め込まれます（Node が CJS として正しく解決するために必須）。

## テスト・カバレッジ

```bash
npm test              # 1 回だけ走らせる
npm run test:watch    # 監視
npm run test:coverage # カバレッジ計測
```

`react-native-fs` / `expo-file-system` は `vi.doMock` で完全にモックしています。閾値はすべて 100%。

## scaffold/react_native での実機検証

```bash
cd product/framework/typescript/library/config/rn-loader
npm pack
# k1s0-ts-config-rn-loader-0.1.0.tgz が生成される

cd ../../../../../scaffold/react_native
npm install ../framework/typescript/library/config/rn-loader/k1s0-ts-config-rn-loader-0.1.0.tgz --no-save
# tsc --noEmit で型解決を確認
```

実機での読み書きテストは scaffold 側のデモ画面を用意してから行ってください。

## Verdaccio publish の順序

`config` パッケージ群は内部依存があるため **以下の順序で publish** します:

```
1. core を npm version bump → npm publish
2. loader / rn-loader / react / react-native の version を core と一致
3. loader を npm publish
4. rn-loader を npm publish (prepublishOnly が file:../core を version 文字列に書換)
5. react を npm publish
6. react-native を npm publish
```

publish 失敗時は `postpublish` が走らず、`package.json` の `dependencies."@k1s0-ts-config/core"` が `"0.1.0"` のような文字列のまま残る可能性があります。`git diff package.json` を確認し、必要なら `"file:../core"` に戻してください。
