# ${{ values.app_title }}

${{ values.description }}

Kotlin Multiplatform（KMP）＋ Compose Multiplatform（CMP）製のクライアントアプリです。1 つのコードベースから **Android** と **Windows（デスクトップ）** の両方に対応します。

## クイックスタート

> **前提**: JDK 17 / Android SDK（compileSdk 34）。すべて同梱の Gradle Wrapper から実行します。

```bash
# デスクトップ（Windows）で起動
./gradlew :composeApp:run

# Windows インストーラ（MSI）を生成
./gradlew :composeApp:packageMsi

# Android デバッグ APK を生成
./gradlew :composeApp:assembleDebug
```

## ディレクトリ

| パス | 役割 |
| --- | --- |
| `composeApp/src/commonMain` | 全プラットフォーム共通の UI・ロジック（`App.kt`、文字列リソース） |
| `composeApp/src/androidMain` | Android 固有（`MainActivity`、`AndroidManifest.xml`、`res/`） |
| `composeApp/src/desktopMain` | デスクトップ固有（`main.kt`） |
| `gradle/libs.versions.toml` | 依存・プラグインのバージョンカタログ |

詳細な手順・バージョン・カスタマイズ方法は [`docs/index.md`](docs/index.md)（TechDocs）を参照してください。

## 主な技術スタック

- Kotlin 2.1.0 / Compose Multiplatform 1.7.1 / AGP 8.5.2 / Gradle 8.7
- 対象: Android（minSdk ${{ values.min_sdk }} / targetSdk 34）、Windows デスクトップ（JVM）
