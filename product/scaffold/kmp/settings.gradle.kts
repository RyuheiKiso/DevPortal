// ============================================================================
// Gradle プロジェクト全体の設定ファイル
// ルートプロジェクト名・含めるサブモジュール・依存解決リポジトリを宣言する
// ============================================================================

// プラグイン解決時に参照するリポジトリ宣言ブロック
pluginManagement {
    // プラグイン取得元リポジトリの優先順位を定義
    repositories {
        // Google 製プラグイン (Android Gradle Plugin など) の取得元
        google {
            // パフォーマンス向上のため、取得対象を Android / AndroidX / Google 配下に限定
            content {
                // androidx.* のグループだけを許可
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        // Maven Central (Kotlin / Compose 公式プラグインなど)
        mavenCentral()
        // Gradle 公式プラグインポータル (gradle.plugin.* など)
        gradlePluginPortal()
    }
}

// 依存ライブラリ解決時に参照するリポジトリ宣言ブロック
dependencyResolutionManagement {
    // 個別モジュールでの repositories 宣言を禁止し、ここに集約する
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    // ライブラリ取得元リポジトリの優先順位を定義
    repositories {
        // Google 製ライブラリ (AndroidX など)
        google()
        // Maven Central (Kotlin / Compose / 一般ライブラリ)
        mavenCentral()
    }
}

// ルートプロジェクト名 (IDE 表示やアーティファクト名に使用)
rootProject.name = "kmp-scaffold"

// マルチモジュール構成として含めるサブプロジェクト群
include(":composeApp")
