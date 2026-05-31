// ルートプロジェクトでは各プラグインを「宣言のみ」行い、適用は各モジュールに委ねる
plugins {
    // Kotlin Multiplatform プラグイン（ここでは適用しない）
    alias(libs.plugins.kotlinMultiplatform) apply false
    // kotlinx.serialization プラグイン（ここでは適用しない）
    alias(libs.plugins.kotlinSerialization) apply false
    // Android ライブラリプラグイン（ここでは適用しない）
    alias(libs.plugins.androidLibrary) apply false
}
