// ルートプロジェクトでは各プラグインを「宣言のみ」行い、適用は各モジュールに委ねる
plugins {
    // Kotlin Multiplatform プラグイン（ここでは適用しない）
    alias(libs.plugins.kotlinMultiplatform) apply false
    // Android アプリプラグイン（ここでは適用しない）
    alias(libs.plugins.androidApplication) apply false
    // Compose Multiplatform プラグイン（ここでは適用しない）
    alias(libs.plugins.composeMultiplatform) apply false
    // Compose Compiler プラグイン（ここでは適用しない）
    alias(libs.plugins.composeCompiler) apply false
{%- if values.include_serialization %}
    // kotlinx.serialization プラグイン（ここでは適用しない）
    alias(libs.plugins.kotlinSerialization) apply false
{%- endif %}
}
