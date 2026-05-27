// ============================================================================
// ルートビルドスクリプト
// 全モジュールで利用する Gradle プラグインを「apply false」で宣言し、
// 実体のバージョン管理はバージョンカタログ (libs.versions.toml) に集約する
// ============================================================================

// 各プラグインを宣言するブロック
// apply false により、ルートには適用せず子モジュールから参照可能にする
plugins {
    // Android アプリ用 AGP プラグイン
    alias(libs.plugins.androidApplication) apply false
    // Android ライブラリ用 AGP プラグイン (共有モジュールを作る場合に使用)
    alias(libs.plugins.androidLibrary) apply false
    // Kotlin Multiplatform プラグイン (KMP の中核)
    alias(libs.plugins.kotlinMultiplatform) apply false
    // Compose Multiplatform プラグイン (CMP UI)
    alias(libs.plugins.composeMultiplatform) apply false
    // Kotlin コンパイラ向け Compose コンパイラプラグイン (Kotlin 2.x 以降必須)
    alias(libs.plugins.composeCompiler) apply false
}
