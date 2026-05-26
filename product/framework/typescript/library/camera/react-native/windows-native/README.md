# @k1s0-ts-camera/react-native — Windows Native Module サンプル

このディレクトリには、react-native-windows 上で `Windows.Media.Capture` を呼び出すための **C++/WinRT ネイティブモジュールサンプル** とそれを呼ぶ TypeScript ブリッジテンプレートが配置されています。

## ファイル構成

| ファイル | 種別 | コピー先 | 役割 |
|---|---|---|---|
| `K1s0Camera.idl` | C++/WinRT | `windows/<AppName>/K1s0Camera.idl` | MIDL3 runtimeclass 宣言 |
| `K1s0Camera.h` | C++/WinRT | `windows/<AppName>/K1s0Camera.h` | NativeModule ヘッダ（`REACT_MODULE` / `REACT_METHOD` 宣言） |
| `K1s0Camera.cpp` | C++/WinRT | `windows/<AppName>/K1s0Camera.cpp` | `Windows.Media.Capture` ラップ実装 |
| `vcxproj.snippet.xml` | スニペット | `.vcxproj` に追記 | IDL / ヘッダ / 実装ファイルの ItemGroup |
| `ReactPackageProvider.cpp.snippet` | スニペット | `ReactPackageProvider.cpp` に追記 | `AddModule(L"K1s0Camera", ...)` の登録行 |
| `Package.appxmanifest.snippet.xml` | スニペット | `Package.appxmanifest` に追記 | webcam / microphone capability |
| `cameraWindowsImpl.ts.template` | TypeScript | `src/cameraWindowsImpl.ts` （`.template` 削除） | NativeModule を呼ぶ `WindowsCameraImpl` 実装 |

## 前提条件

コピーする前に、以下の前提が利用者プロジェクトで満たされていることを確認してください。条件が満たされていないとビルドエラーまたは実行時エラーが発生します。

### 1. MSIX / UWP context

C++ 実装は `ApplicationData::Current().TemporaryFolder()` を使って一時ファイルを作成します。これは **MSIX packaged アプリ context でのみ正常動作** します。`react-native-windows` の `run-windows` 既定ビルドは MSIX パッケージとして生成されるため通常は問題ありませんが、以下の点に注意してください：

- **unpacked dev ビルド**：`%LOCALAPPDATA%\Packages\...` ではなく `%LOCALAPPDATA%\Temp` 等にフォールバックする可能性があり、ファイルパスが UI 上で期待値と異なる
- **本番デプロイ**：必ず MSIX (.msix / .msixbundle) として配布することを推奨
- **Sparse package / Unpackaged Win32 app**：未サポート（`ApplicationData::Current()` が throw する可能性あり）

### 2. pch.h の取り込み内容

`K1s0Camera.cpp` の先頭で `#include "pch.h"` を行います。利用者プロジェクトの `pch.h` に以下の WinRT ヘッダが既に取り込まれている前提です：

```cpp
// windows/<AppName>/pch.h で取り込まれているべき内容（既定の RN-Windows テンプレートなら自動）
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
```

それ以外（`Windows.Media.Capture`, `Windows.Storage` 等）は `K1s0Camera.h` で明示 include しているため pch.h への追加は不要です。

### 3. C++20 必須

`K1s0Camera.cpp` は `co_await` / `co_return` を使うため **C++20 以降** が必要です。利用者の `.vcxproj` を確認し、以下が設定されていなければ追加してください：

```xml
<!-- windows/<AppName>/<AppName>.vcxproj -->
<PropertyGroup>
  <LanguageStandard>stdcpp20</LanguageStandard>
</PropertyGroup>
```

`react-native-windows` 0.76 以降のテンプレートは既定で C++20 になっているため、新規プロジェクトなら不要です。

### 4. Windows SDK バージョン

**Windows 10 SDK 22621 以降推奨**。22000 以前では以下の差異がある可能性があります：

- `MediaEncodingProfile::CreateMp4()` のシグネチャ変更
- `ImageEncodingProperties::CreateJpeg()` の戻り値型変更
- `co_await` 周辺の標準ライブラリ実装の差

`.vcxproj` の `<WindowsTargetPlatformVersion>` を確認し、可能なら 10.0.22621.0 以上に揃えてください。

### 5. react-native-windows のバージョン

**0.76 系で動作確認済み**。0.75 以前は `MakeTurboModuleProvider` のシグネチャや `Microsoft.ReactNative` 名前空間の構成が異なる可能性があり、`ReactPackageProvider.cpp.snippet` の修正が必要になることがあります。

---

## コピー手順（最短）

PowerShell で以下を実行すると、必要なファイルが利用者プロジェクトの正しい場所にコピーされます（`<AppName>` と `<ProjectRoot>` は環境に合わせて読み替えてください）：

```powershell
# 変数定義（利用者プロジェクトのルートと Windows アプリ名）
$ProjectRoot = "C:\path\to\your\rn-windows-app"
$AppName = "MyApp"

# パッケージ配布元（node_modules 内）
$Src = "$ProjectRoot\node_modules\@k1s0-ts-camera\react-native\windows-native"

# C++/WinRT ファイル群を windows/<AppName>/ にコピー
Copy-Item "$Src\K1s0Camera.idl" "$ProjectRoot\windows\$AppName\"
Copy-Item "$Src\K1s0Camera.h"   "$ProjectRoot\windows\$AppName\"
Copy-Item "$Src\K1s0Camera.cpp" "$ProjectRoot\windows\$AppName\"

# TypeScript ブリッジを src/ にコピー（.template を外して .ts にリネーム）
Copy-Item "$Src\cameraWindowsImpl.ts.template" "$ProjectRoot\src\cameraWindowsImpl.ts"
```

## 手動でやる作業

上記コピー後、以下 3 ファイルへの追記は手動で行ってください（スニペット参照）：

1. **`windows/<AppName>/<AppName>.vcxproj`** に `vcxproj.snippet.xml` の `<ItemGroup>` 3 つを追加
2. **`windows/<AppName>/ReactPackageProvider.cpp`** の `CreatePackage` 関数本体に `ReactPackageProvider.cpp.snippet` の 2 行（`#include` + `AddModule`）を追加
3. **`windows/<AppName>/Package.appxmanifest`** の `<Capabilities>` ブロックに `Package.appxmanifest.snippet.xml` の `<DeviceCapability>` 2 行を追加

## 使い方（コピー完了後）

```tsx
// app/src/App.tsx
import { CameraProvider } from "@k1s0-ts-camera/react-native";
import { createWindowsAdapter } from "@k1s0-ts-camera/react-native/adapters/windows";
// 上でコピーした TypeScript ブリッジ
import { createWindowsNativeImpl } from "./cameraWindowsImpl";

// ネイティブモジュールを注入した adapter を生成
const adapter = createWindowsAdapter({
  mediaCapture: createWindowsNativeImpl(),
});

export function App() {
  return (
    <CameraProvider adapter={adapter}>
      <CameraScreen />
    </CameraProvider>
  );
}
```

## ビルド

```cmd
:: 通常通り run-windows
npx react-native run-windows --arch x64

:: または直接 msbuild
msbuild windows\<AppName>.sln /p:Configuration=Release /p:Platform=x64
```

初回起動時にカメラ権限のダイアログが Windows OS から表示されます。

## 動作確認した環境

- Visual Studio 2022 (17.8 以降)
- Windows 10 SDK 22621
- react-native-windows 0.76 系
- C++/WinRT 2.0.220929.3 以降

SDK バージョンや RN-Windows メジャー更新で WinRT API のシグネチャが変わる可能性があります。ビルドエラーが出た場合は `winrt::` 名前空間の型変更を疑ってください。

## 制限事項

- **バーコードスキャンは未実装**：本サンプルには `scanBarcode` の C++ 実装は含めていません。実装する場合は `MediaFrameReader` + [ZXing.Net](https://github.com/micjahn/ZXing.Net) などを追加してください
- **ライブプレビュー UI は別途**：本サンプルは「静止画 / 動画キャプチャ」のみ。`<CaptureElement>` を XAML 側に置く場合は `react-native-windows` の `ViewManager` を追加で書く必要があります
- **解像度は固定返却**：`takePicture` の戻り値 `width` / `height` はサンプルでは 1920×1080 固定。厳密値が必要なら `VideoController.GetMediaStreamProperties()` を C++ で追加してください
