// プラグインの解決方法を設定する
pluginManagement {
    // プラグインを取得するリポジトリ
    repositories {
        // Android 系プラグイン用
        google()
        // 一般的な OSS ライブラリ用
        mavenCentral()
        // Gradle プラグインポータル
        gradlePluginPortal()
    }
}

// 依存ライブラリの解決方法を設定する
dependencyResolutionManagement {
    // ライブラリを取得するリポジトリ
    repositories {
        // Android 系アーティファクト用
        google()
        // 一般的な OSS ライブラリ用
        mavenCentral()
    }
}

// ルートプロジェクト名（Backstage のコンポーネント ID と一致させる）
rootProject.name = "${{ values.component_id }}"

// クライアントアプリ（Android + Windows デスクトップ）のモジュールを含める
include(":composeApp")
