// config:core モジュールのビルド定義（ロジックのみ・Compose 非依存）
plugins {
    // Kotlin Multiplatform を適用する
    alias(libs.plugins.kotlinMultiplatform)
    // kotlinx.serialization を適用する
    alias(libs.plugins.kotlinSerialization)
    // Android ライブラリとしてビルドする
    alias(libs.plugins.androidLibrary)
}

// マルチプラットフォームのターゲットと依存を定義する
kotlin {
    // Java と Kotlin の JVM ターゲットを 17 に統一する（Android の Java/Kotlin 不一致を防ぐ）
    jvmToolchain(17)

    // Android ライブラリターゲット
    androidTarget()
    // Desktop(JVM) ターゲット。ソースセット名を desktop とする
    jvm("desktop")

    // ソースセットごとの依存関係
    sourceSets {
        // 共通コードの依存
        val commonMain by getting {
            dependencies {
                // コルーチン（Flow / StateFlow）
                implementation(libs.kotlinx.coroutines.core)
                // JSON シリアライズ
                implementation(libs.kotlinx.serialization.json)
            }
        }
        // テストコードの依存
        val commonTest by getting {
            dependencies {
                // Kotlin 標準のマルチプラットフォームテストフレームワーク
                implementation(kotlin("test"))
                // コルーチンのテストユーティリティ（runTest / backgroundScope）
                implementation(libs.kotlinx.coroutines.test)
            }
        }
        // Desktop 固有コード（標準ライブラリのみで足りるため追加依存なし）
        val desktopMain by getting
        // Android 固有コード（android.* は SDK が提供するため追加依存なし）
        val androidMain by getting
    }
}

// Android ライブラリの設定
android {
    // ライブラリの名前空間（R クラス・Manifest package の代替）
    namespace = "com.devportal.config"
    // コンパイルに使う Android SDK のバージョン
    compileSdk = 34
    // 既定の構成
    defaultConfig {
        // サポートする最小 SDK
        minSdk = 24
    }
}
