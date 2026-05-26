# @k1s0-ts-config パッケージ群

DevPortal 共通の設定管理ライブラリ群の入口です。利用シーンに応じて以下から選んでください。

## パッケージ一覧

| パッケージ | 動作環境 | 役割 |
|-----------|---------|------|
| [`@k1s0-ts-config/core`](./core/README.md) | Node / ブラウザ / RN / RNW すべて | 検証 (zod) / 環境マージ (`mergeEnvConfig`) / 機能フラグ / Theme 型 |
| [`@k1s0-ts-config/react`](./react/README.md) | ブラウザ | `ConfigProvider` / `useConfig` / `useFeatureFlag` / `useTheme` |
| [`@k1s0-ts-config/react-native`](./react-native/README.md) | RN / RNW | react 版 API + `mergePlatformConfig` (Platform 別マージ、Windows 含む) |
| [`@k1s0-ts-config/loader`](./loader/README.md) | **Node 専用** | ファイル I/O (`fs`) + JSON/YAML 自動判別 + zod 検証 |
| [`@k1s0-ts-config/rn-loader`](./rn-loader/README.md) | **RN / RNW 専用** | `react-native-fs` / `expo-file-system` バックエンドのファイルローダ |

## 典型的な組み合わせ

- **Web フロントエンド**: `core` + `react`
- **bare React Native**: `core` + `react-native` + `rn-loader`（`react-native-fs` バックエンド）
- **Expo アプリ**: `core` + `react-native` + `rn-loader`（`expo-file-system` バックエンド）
- **React Native for Windows**: `core` + `react-native` + `rn-loader`（`react-native-fs` バックエンド）
- **Node CLI / バックエンド**: `core` + `loader`

`core` はすべての構成で必須です。

## 設計方針

- **`core` はプラットフォーム非依存**: Node 固有 API（`fs` など）を持たないため、ブラウザ・Node・RN のいずれでも動きます。
- **I/O は別パッケージに分離**: ファイル読込が必要なときだけ `loader` か `rn-loader` を追加。`core` の純粋性は壊さない。
- **環境変数展開はサポートしない**: 設定値の中で `${VAR}` を展開する処理は提供しません。必要なら呼び出し側で前処理してください。
- **`zod` は peerDep**: `core` が direct dep で持ち、loader / rn-loader は peerDep として共有。zod インスタンスが分裂すると `instanceof` 検査が壊れるため。

## publish 順序（Verdaccio）

```
1. core を npm version bump → npm publish
2. loader / rn-loader / react / react-native の version を core と一致
3. loader → rn-loader → react → react-native の順に publish
```

各 React/RN 系パッケージは `prepublishOnly` で `file:../core` を version 文字列に書き換え、`postpublish` で `file:../core` に戻します。publish 失敗時は `git diff package.json` を確認し、必要なら手動で戻してください。
