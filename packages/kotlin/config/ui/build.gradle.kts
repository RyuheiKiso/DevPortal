// config:ui モジュールのビルド定義（Compose Multiplatform の設定画面）
plugins {
    // Kotlin Multiplatform を適用する
    alias(libs.plugins.kotlinMultiplatform)
    // Android ライブラリとしてビルドする
    alias(libs.plugins.androidLibrary)
    // Compose Multiplatform を適用する
    alias(libs.plugins.composeMultiplatform)
    // Compose Compiler を適用する（Kotlin 2.x で必須）
    alias(libs.plugins.composeCompiler)
    // テスト用スキーマで @Serializable を使うため serialization を適用する
    alias(libs.plugins.kotlinSerialization)
}

// マルチプラットフォームのターゲットと依存を定義する
kotlin {
    // Java と Kotlin の JVM ターゲットを 17 に統一する
    jvmToolchain(17)
    // Android ライブラリターゲット
    androidTarget()
    // Desktop(JVM) ターゲット
    jvm("desktop")

    // ソースセットごとの依存関係
    sourceSets {
        // 共通コードの依存
        val commonMain by getting {
            dependencies {
                // ロジックモジュール（core）に依存する（ui → core の一方向）
                implementation(project(":packages:kotlin:config:core"))
                // Compose のランタイム
                implementation(compose.runtime)
                // Compose の基本レイアウト
                implementation(compose.foundation)
                // Material3 コンポーネント
                implementation(compose.material3)
                // スキーマ走査・JSON 変換に使う
                implementation(libs.kotlinx.serialization.json)
            }
        }
        // 共通テストの依存
        val commonTest by getting {
            dependencies {
                // Kotlin 標準のマルチプラットフォームテストフレームワーク
                implementation(kotlin("test"))
                // Compose の UI テスト（experimental。runComposeUiTest など）
                @OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)
                implementation(compose.uiTest)
            }
        }
        // Desktop テストの実行基盤（Skia で UI テストを動かす）
        val desktopTest by getting {
            dependencies {
                // 現在の OS 向けの Compose Desktop 実行時依存
                implementation(compose.desktop.currentOs)
            }
        }
    }
}

// Android ライブラリの設定
android {
    // ライブラリの名前空間
    namespace = "com.devportal.config.ui"
    // コンパイルに使う Android SDK のバージョン
    compileSdk = 34
    // 既定の構成
    defaultConfig {
        // サポートする最小 SDK
        minSdk = 24
    }
}
