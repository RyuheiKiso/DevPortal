# React Native for Windows scaffold

DevPortal が提供する **React Native for Windows** のスタータースキャフォールド。`@react-native-community/cli init` で生成した RN 0.84.1 プロジェクトに、`react-native-windows@0.84.0-preview.11` を加え、`cpp-app` テンプレートで Windows ネイティブアプリ化済み。

> 0.82 系の stable は VS2022 17.x 限定でしたが、本リポジトリは VS2026 (v18) でビルド可能な `0.84.0-preview.11` を採用しています。

## 前提環境

| 項目 | 要件 |
|---|---|
| Node.js | v20 以上（動作確認: v22.14.0） |
| パッケージマネージャ | npm 推奨（このスキャフォールドは `package-lock.json` を採用） |
| Visual Studio | 2022 以上（動作確認: 2026 Community） |
| VS ワークロード | **Desktop development with C++** ／ **Universal Windows Platform development** |
| Windows SDK | 10.0.22621 以上を 1 つ以上 |
| OS | Windows 10 19041 以上 |

> RNW 0.84.0-preview.11 は公式には VS2022（17.11 以上）を想定しています。**VS2026 を使う場合は、`run-windows` 実行前に環境変数 `MinimumVisualStudioVersion=18.0` を設定してください**（未設定だと `[17.11.0, 18.0)` の範囲しか検索せず VS2026 を検出できません）。

```powershell
# VS2026 を使う場合
$env:MinimumVisualStudioVersion = "18.0"
npx react-native run-windows
```

## セットアップ

```powershell
# 依存関係のインストール（リポジトリから clone した直後など）
npm install
```

## 起動

```powershell
# Windows ネイティブアプリのビルド & 起動
npx react-native run-windows
# 同等の npm スクリプト
npm run windows
```

初回ビルドは MSBuild による C++ ネイティブコンパイルを伴うため **10〜20 分** ほどかかります。完了後、別ウィンドウで Metro バンドラと Windows アプリが起動します。

### Metro 単独起動

```powershell
npm start
```

## ディレクトリ構成

```
react_native/
├─ App.tsx                 # ルートコンポーネント（日本語コメント付き）
├─ index.js                # エントリーポイント
├─ app.json                # アプリ名定義
├─ package.json
├─ windows/                # init-windows で生成した cpp-app テンプレート
│  ├─ ReactNative.sln
│  ├─ ReactNative/         # メイン C++ プロジェクト
│  └─ ReactNative.Package/ # MSIX パッケージプロジェクト
├─ android/                # （未対応・初期生成のまま）
├─ ios/                    # （未対応・初期生成のまま）
└─ __tests__/
```

## 既知の制約

- **VS2026 検証**: 公式サポート外の構成。autolink や MSBuild restore でエラーが出た場合は VS2022 への切替を検討してください。
- **Android / iOS**: 本スキャフォールドは Windows 向け検証のみ実施。Android / iOS のターゲットは初期生成物のまま未確認です。
