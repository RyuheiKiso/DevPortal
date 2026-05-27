# iosApp

iOS 用 Xcode プロジェクトを配置するディレクトリ。
本スキャフォールドでは `.xcodeproj` を含めず、必要なファイルのみ提供している。
理由: `project.pbxproj` は UUID と環境依存設定の塊で、手書きすると壊れやすいため。

## 初回セットアップ手順

1. Xcode で **File → New → Project → iOS → App** を選択し、以下の値で新規作成する。
   - Product Name: `iosApp`
   - Interface: `SwiftUI`
   - Language: `Swift`
   - Bundle Identifier: `com.example.kmpapp` (任意)
   - **保存先は本ディレクトリ (`iosApp/`)** とし、`iosApp.xcodeproj` を直下に作る。

2. 自動生成された Swift ファイル (`iosAppApp.swift`, `ContentView.swift`) を破棄し、
   本ディレクトリ配下の以下ファイルを Xcode プロジェクトに追加する。
   - `iosApp/iOSApp.swift`
   - `iosApp/ContentView.swift`
   - `iosApp/Info.plist`
   - `Configuration/Config.xcconfig` (プロジェクト設定の「Configurations」で参照)

3. **Build Phases → "+ → New Run Script Phase"** を追加し、以下を入力する。
   ```sh
   # Compose Multiplatform フレームワークを Kotlin 側からビルドし、
   # 自動的に Xcode に同梱・署名する公式タスク
   cd "$SRCROOT/.."
   ./gradlew :composeApp:embedAndSignAppleFrameworkForXcode
   ```

4. **Build Settings → Framework Search Paths** に以下を追加。
   ```
   $(SRCROOT)/../composeApp/build/xcode-frameworks/$(CONFIGURATION)/$(SDK_NAME)
   ```

5. **Build Settings → Other Linker Flags** に `-framework ComposeApp` を追加。

6. **Build Settings → Enable Bitcode** を `No` にする (KMP は Bitcode 非対応)。

## 既存 Xcode プロジェクトを使う場合

JetBrains の **Kotlin Multiplatform IDE プラグイン** (Android Studio / IntelliJ) を使うと、
プロジェクトウィザードから `iosApp.xcodeproj` を含む完全なテンプレートを生成できる。
そちらで作成した `iosApp.xcodeproj` を本ディレクトリ直下に置けば、上記手順は不要。
