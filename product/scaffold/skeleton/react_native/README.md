# ${{ values.name }}

${{ values.description }}

DevPortal の React Native 0.84 + Windows ネイティブ (VS2026) スターターから生成されたモバイル/デスクトップアプリです。

## 前提環境

| 項目 | 要件 |
|---|---|
| Node.js | v20 以上 |
| Visual Studio | 2022 17.11 以上、または 2026 |
| VS ワークロード | Desktop development with C++ / Universal Windows Platform development |
| Windows SDK | 10.0.22621 以上 |
| OS | Windows 10 19041 以上 |

## セットアップ

```powershell
# 依存解決
npm install
```

## Windows で起動

```powershell
# VS2026 を使う場合は環境変数を先に設定
$env:MinimumVisualStudioVersion = "18.0"

# Windows ネイティブアプリのビルド & 起動
npx react-native run-windows
```

初回ビルドは MSBuild による C++ ネイティブコンパイルを伴うため **10〜20 分** ほどかかります。

## Metro 単独起動

```powershell
npm start
```

## ディレクトリ構成

```
${{ values.name }}/
├─ App.tsx                 # ルートコンポーネント
├─ index.js                # エントリポイント
├─ app.json                # アプリ名定義
├─ package.json
├─ windows/                # Windows ネイティブ (cpp-app テンプレート)
│  ├─ ReactNative.sln      # ※ Windows プロジェクト名は固定 "ReactNative"
│  ├─ ReactNative/
│  └─ ReactNative.Package/
├─ android/                # Android 雛形
└─ ios/                    # iOS 雛形
```

## 既知の制約

- **Windows プロジェクト名は "ReactNative" 固定**: skeleton の都合上、Windows 側 (vcxproj / sln / Identity) はプロジェクト名 "ReactNative" のまま生成されます。Visual Studio は GUID で識別するため動作には支障ありません。表示名を変更したい場合は `windows/ReactNative.Package/Package.appxmanifest` の `<DisplayName>` を手で編集してください。
- **Android / iOS 検証**: 本スキャフォールドは Windows 向け検証のみ実施。Android / iOS のビルド確認は未実施です。
- **package.json の `react-native-windows.init-windows`**: `name` / `namespace` は "ReactNative" 固定です。`npx react-native init-windows` を再実行する場合に参照されます。
