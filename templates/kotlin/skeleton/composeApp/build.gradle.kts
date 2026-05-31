// Kotlin の JVM ターゲット指定に使う列挙型をインポートする
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
// デスクトップ配布フォーマット（MSI/EXE）を指定するための列挙型をインポートする
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

// このモジュールに適用するプラグイン群
plugins {
    // Kotlin Multiplatform を有効化する
    alias(libs.plugins.kotlinMultiplatform)
    // Android アプリ（com.android.application）を有効化する
    alias(libs.plugins.androidApplication)
    // Compose Multiplatform を有効化する
    alias(libs.plugins.composeMultiplatform)
    // Compose Compiler を有効化する（Kotlin 2.x で必須）
    alias(libs.plugins.composeCompiler)
{%- if values.include_serialization %}
    // kotlinx.serialization を有効化する（設定サンプル用）
    alias(libs.plugins.kotlinSerialization)
{%- endif %}
}

// Kotlin Multiplatform のターゲットと依存関係を構成する
kotlin {
    // Android 向けターゲット
    androidTarget {
        // Android 側のコンパイル設定
        compilerOptions {
            // 生成する JVM バイトコードを Java 11 にする
            jvmTarget.set(JvmTarget.JVM_11)
        }
    }

    // Windows などのデスクトップ（JVM）向けターゲット。ソースセット名は desktop
    jvm("desktop")

    // 各ソースセットの依存関係を定義する
    sourceSets {
        // デスクトップ用ソースセットを取得する
        val desktopMain by getting

        // 全プラットフォーム共通の依存関係
        commonMain.dependencies {
            // Compose のランタイム
            implementation(compose.runtime)
            // Compose の基本レイアウト/部品
            implementation(compose.foundation)
            // Material 3 デザイン部品
            implementation(compose.material3)
            // Compose UI 本体
            implementation(compose.ui)
            // 文字列などのマルチプラットフォームリソース
            implementation(compose.components.resources)
            // @Preview 用のツールサポート
            implementation(compose.components.uiToolingPreview)
            // コルーチン（非同期処理）
            implementation(libs.kotlinx.coroutines.core)
{%- if values.include_serialization %}
            // JSON シリアライズ（設定サンプル用）
            implementation(libs.kotlinx.serialization.json)
{%- endif %}
        }

        // Android 専用の依存関係
        androidMain.dependencies {
            // Android Studio の Compose プレビュー
            implementation(compose.preview)
            // Activity と Compose を接続する
            implementation(libs.androidx.activity.compose)
        }

        // デスクトップ専用の依存関係
        desktopMain.dependencies {
            // 現在の OS 向け Compose デスクトップランタイム
            implementation(compose.desktop.currentOs)
            // デスクトップのメインディスパッチャ（Swing）用コルーチン
            implementation(libs.kotlinx.coroutines.swing)
        }
    }
}

// Compose リソース（Res クラス）の生成方法を設定する
compose.resources {
    // 生成する Res クラスを公開（public）にする
    publicResClass = true
    // Res クラスを配置するパッケージを固定する（インポートを決定的にするため）
    packageOfResClass = "${{ values.package_name }}.resources"
    // Res クラスを常に生成する（always は compose.resources DSL が公開する定数。import 不要）
    generateResClass = always
}

// Android アプリのビルド設定
android {
    // R クラスや Manifest のベースとなる名前空間
    namespace = "${{ values.package_name }}"
    // コンパイルに使う Android SDK（AGP 8.5 系の上限は 34）
    compileSdk = 34

    // 既定のビルド構成
    defaultConfig {
        // アプリのアプリケーション ID（パッケージ名と同一）
        applicationId = "${{ values.package_name }}"
        // 動作対象の最小 SDK
        minSdk = ${{ values.min_sdk }}
        // 動作対象の最大 SDK
        targetSdk = 34
        // 内部バージョン番号
        versionCode = 1
        // 表示用バージョン名
        versionName = "${{ values.package_version }}"
    }

    // Java の互換性レベルを指定する
    compileOptions {
        // ソース互換性を Java 11 にする
        sourceCompatibility = JavaVersion.VERSION_11
        // ターゲット互換性を Java 11 にする
        targetCompatibility = JavaVersion.VERSION_11
    }
}

// Compose デスクトップアプリ（Windows 配布など）の設定
compose.desktop {
    // デスクトップアプリ本体の設定
    application {
        // 起動エントリポイント（main.kt のトップレベル main → MainKt）
        mainClass = "${{ values.package_name }}.MainKt"

        // ネイティブ配布（インストーラ）の設定
        nativeDistributions {
            // 生成する配布フォーマット（Windows 向けに MSI と EXE）
            targetFormats(TargetFormat.Msi, TargetFormat.Exe)
            // インストーラの製品名
            packageName = "${{ values.windows_product_name }}"
            // 配布バージョン
            packageVersion = "${{ values.package_version }}"
        }
    }
}
