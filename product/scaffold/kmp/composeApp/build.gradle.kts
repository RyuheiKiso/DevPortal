// ============================================================================
// composeApp モジュール ビルドスクリプト
// Android / iOS / Desktop (JVM) / Web (wasmJs) を単一モジュールで扱う
// KMP の階層構造でソースを共有し、Compose Multiplatform で UI を共通化する
// ============================================================================

// Compose Multiplatform 公式 DSL を取り込むためのインポート
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

// 適用プラグイン宣言
plugins {
    // Kotlin Multiplatform プラグイン (KMP の中核)
    alias(libs.plugins.kotlinMultiplatform)
    // Android Application プラグイン (APK 生成)
    alias(libs.plugins.androidApplication)
    // Compose Multiplatform プラグイン (CMP ランタイム + Gradle DSL)
    alias(libs.plugins.composeMultiplatform)
    // Kotlin Compose コンパイラプラグイン (Kotlin 2.0 以降必須)
    alias(libs.plugins.composeCompiler)
    // Kotlinx Serialization プラグイン (JSON シリアライズで使用)
    alias(libs.plugins.kotlinSerialization)
}

// ----------------------------------------------------------------------------
// Kotlin Multiplatform 設定
// ----------------------------------------------------------------------------
kotlin {
    // --- Android ターゲット ----------------------------------------------
    androidTarget {
        // Android 用 JVM ターゲット (Java 17)
        compilerOptions {
            // Kotlin から生成する JVM バイトコードのバージョン
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    // --- iOS ターゲット (x64 / arm64 / シミュレータ arm64) ----------------
    listOf(
        // Intel Mac シミュレータ用
        iosX64(),
        // 実機 (iPhone / iPad) 用
        iosArm64(),
        // Apple Silicon Mac シミュレータ用
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        // 各 iOS ターゲットに対し、Xcode から参照するフレームワークを定義
        iosTarget.binaries.framework {
            // Xcode から `import ComposeApp` で参照する名前
            baseName = "ComposeApp"
            // すべての依存を 1 フレームワークに束ねる (Static)
            isStatic = true
        }
    }

    // --- Desktop (JVM) ターゲット ----------------------------------------
    jvm("desktop")

    // --- Web (Wasm/JS) ターゲット ----------------------------------------
    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs {
        // ブラウザ向け実行環境
        browser {
            // 開発時 / 本番時のビルド出力ディレクトリ調整
            commonWebpackConfig {
                // 開発サーバの出力名 (index.html から参照)
                outputFileName = "composeApp.js"
            }
        }
        // wasmJs バイナリは実行可能形式とする
        binaries.executable()
    }

    // ------------------------------------------------------------------------
    // ソースセット定義
    // ------------------------------------------------------------------------
    sourceSets {
        // 全プラットフォーム共通ソース
        val commonMain by getting {
            dependencies {
                // Compose ランタイム (一般 API)
                implementation(compose.runtime)
                // Compose Foundation (Layout, Modifier など)
                implementation(compose.foundation)
                // Material3 デザインシステム
                implementation(compose.material3)
                // ベクター ImageVector / リソースアクセス
                implementation(compose.ui)
                // composeResources (画像・文字列リソース) サポート
                implementation(compose.components.resources)
                // ViewModel 用ライフサイクル API (KMP 対応)
                implementation(compose.components.uiToolingPreview)
                // Coroutines (commonMain 用)
                implementation(libs.kotlinx.coroutines.core)
                // Serialization JSON
                implementation(libs.kotlinx.serialization.json)
            }
        }
        // Android プラットフォーム固有
        val androidMain by getting {
            dependencies {
                // Activity と Compose の統合 (setContent {} を提供)
                implementation(libs.androidx.activity.compose)
                // Android Core KTX (拡張関数群)
                implementation(libs.androidx.core.ktx)
                // Lifecycle ランタイム
                implementation(libs.androidx.lifecycle.runtime)
                // Coroutines Android ディスパッチャ
                implementation(libs.kotlinx.coroutines.android)
            }
        }
        // iOS は 3 ターゲットをひとまとめにする中間ソースセット
        val iosX64Main by getting
        val iosArm64Main by getting
        val iosSimulatorArm64Main by getting
        // iOS 共通ソース (3 ターゲットから依存)
        val iosMain by creating {
            // commonMain → iosMain → 各 iosXXMain の階層構造を作る
            dependsOn(commonMain)
            iosX64Main.dependsOn(this)
            iosArm64Main.dependsOn(this)
            iosSimulatorArm64Main.dependsOn(this)
        }
        // Desktop (JVM) プラットフォーム固有
        val desktopMain by getting {
            dependencies {
                // Compose Desktop ランタイム (Window / Tray など)
                implementation(compose.desktop.currentOs)
                // Coroutines Swing (Main ディスパッチャ実体)
                implementation(libs.kotlinx.coroutines.swing)
            }
        }
        // Web (wasmJs) プラットフォーム固有
        val wasmJsMain by getting {
            dependencies {
                // 現時点ではブラウザ拡張依存なし (将来の DOM 連携などで追加)
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Android ビルド設定
// ----------------------------------------------------------------------------
android {
    // Android リソース名前空間 (R クラスのパッケージ)
    namespace = "com.example.kmpapp"
    // コンパイル時に使用する Android SDK バージョン
    compileSdk = libs.versions.androidCompileSdk.get().toInt()

    // ソースセットマッピング (KMP 既定の Java/Kotlin/リソース配置に合わせる)
    sourceSets["main"].apply {
        // AndroidManifest.xml の位置
        manifest.srcFile("src/androidMain/AndroidManifest.xml")
        // Android リソース (drawable, layout, values) の位置
        res.srcDirs("src/androidMain/res")
        // ネイティブ JNI ライブラリの位置 (使用しない場合も宣言)
        jniLibs.srcDirs("src/androidMain/jniLibs")
    }

    // デフォルト設定 (全ビルドバリアントの共通設定)
    defaultConfig {
        // パッケージ名 (Play Store / 端末上の識別子)
        applicationId = "com.example.kmpapp"
        // サポートする最小 Android API レベル
        minSdk = libs.versions.androidMinSdk.get().toInt()
        // ターゲット Android API レベル (互換動作の基準)
        targetSdk = libs.versions.androidTargetSdk.get().toInt()
        // アプリのバージョンコード (数値, Play Store 識別用)
        versionCode = 1
        // アプリのバージョン名 (ユーザー表示用)
        versionName = "1.0.0"
    }

    // ビルドバリアント設定
    buildTypes {
        // リリースビルド用設定
        getByName("release") {
            // ProGuard / R8 によるコード縮小 (Compose では false で開始するのが安全)
            isMinifyEnabled = false
        }
    }

    // Java / Kotlin の互換バージョン
    compileOptions {
        // ソースコードの Java バージョン互換
        sourceCompatibility = JavaVersion.VERSION_17
        // ターゲット Java バージョン互換
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// ----------------------------------------------------------------------------
// Compose Desktop アプリ設定
// ----------------------------------------------------------------------------
compose.desktop {
    // ネイティブアプリ配布パッケージ設定
    application {
        // Desktop モジュールの main 関数 (kt ファイル名 + Kt 接尾辞)
        mainClass = "com.example.kmpapp.MainKt"

        // OS ごとのインストーラ生成設定
        nativeDistributions {
            // 生成するインストーラ形式 (Win: msi, macOS: dmg, Linux: deb)
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            // アプリ名 (実行ファイル名・ショートカット名)
            packageName = "kmp-scaffold"
            // パッケージのバージョン
            packageVersion = "1.0.0"
        }
    }
}
