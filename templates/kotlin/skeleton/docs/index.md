# ${{ values.app_title }}

${{ values.description }}

Kotlin Multiplatform（KMP）＋ Compose Multiplatform（CMP）で、**Android** と **Windows（デスクトップ/JVM）** の両方で動作するクライアントアプリです。DevPortal の Backstage テンプレート `kotlin` から生成されています。

## 構成

単一の `composeApp` モジュールに、共通コードとプラットフォーム別コードをまとめています。

```text
${{ values.component_id }}/
├── settings.gradle.kts          # ルート設定（:composeApp を include）
├── build.gradle.kts             # ルートのプラグイン宣言（apply false）
├── gradle.properties            # Gradle/Android のビルド設定
├── gradle/
│   └── libs.versions.toml       # バージョンカタログ（依存・プラグイン）
└── composeApp/
    ├── build.gradle.kts         # KMP ターゲット・依存・配布設定
    └── src/
        ├── commonMain/          # 全プラットフォーム共通（App.kt / リソース）
        ├── androidMain/         # Android 固有（MainActivity / Manifest / res）
        └── desktopMain/         # デスクトップ固有（main.kt）
```

## 前提環境

- **JDK 17**（AGP 8.5 系のビルド実行と、Windows インストーラ生成 `jpackage` に必須）
- Android 向けには **Android SDK**（`compileSdk` / `targetSdk` = 34）
- Windows インストーラ（MSI/EXE）生成は **Windows 上**で行う

## バージョン

DevPortal リポジトリのルート `gradle/libs.versions.toml` と揃えています。

| 項目 | バージョン |
| --- | --- |
| Kotlin | 2.1.0 |
| Compose Multiplatform | 1.7.1 |
| Android Gradle Plugin | 8.5.2 |
| Gradle | 8.7 |
| kotlinx.coroutines | 1.9.0 |
| kotlinx.serialization | 1.7.3 |

> バージョンを上げる場合は **Kotlin / CMP / AGP / Gradle を 4 点セットで同時に**更新してください。単一 `composeApp` モジュール構成は AGP 8.x 専用で、AGP 9.0 以降では成立しません（AGP 9 はマルチプラットフォームモジュールへの `com.android.application` 適用を禁止し、`shared + androidApp + desktopApp` の複数モジュール構成を要求します）。

## ビルドと実行

すべて同梱の Gradle Wrapper（`./gradlew`、Windows は `gradlew.bat`）から実行します。

### デスクトップ（Windows）

```bash
# デスクトップアプリを起動する
./gradlew :composeApp:run

# Windows インストーラ（MSI）を生成する（出力: composeApp/build/compose/binaries/main/msi/）
./gradlew :composeApp:packageMsi

# 実行ファイル形式（EXE）を生成する
./gradlew :composeApp:packageExe
```

### Android

```bash
# デバッグ APK を生成する（出力: composeApp/build/outputs/apk/debug/）
./gradlew :composeApp:assembleDebug

# 接続中の端末/エミュレータにインストールする
./gradlew :composeApp:installDebug
```

## 補足・カスタマイズ

- **パッケージとソースの配置**: 共通コードのパッケージは `${{ values.package_name }}` です。本テンプレートはソースをパッケージ階層のサブフォルダに分けず、`src/<target>/kotlin/` 直下に配置しています（Kotlin はディレクトリ構造とパッケージ宣言の一致を強制しないため問題なくビルドできます）。必要に応じてパッケージ階層のフォルダへ移動してください。
- **アプリアイコン**: 既定ではシステムのアイコンを使います。Android は `composeApp/src/androidMain/res/mipmap-*` にランチャーアイコンを追加し、Manifest に `android:icon` を設定してください。デスクトップ配布のアイコンは `nativeDistributions` の `windows { iconFile.set(...) }` で指定できます。
- **共有設定パッケージ（config）の利用**: DevPortal には設定ロード用の共有パッケージ `packages/kotlin/config`（`:config:core` / `:config:ui`）があります。本リポジトリは独立リポのため、利用するには **composite build**（`includeBuild`）か **Maven 公開物の参照**のいずれかで取り込んでください。
- **通信（gRPC / GraphQL / REST）**: API/イベントの契約は DevPortal の `contracts/`（`proto` / `graphql` / `openapi`）に集約されています。クライアント SDK は `packages/kotlin` 側で生成・公開される方針です。本テンプレートはネットワーク実装を含みません。
{%- if values.include_serialization %}
- **設定サンプル**: `composeApp/src/commonMain/kotlin/AppSettings.kt` に kotlinx.serialization を使った設定スキーマのサンプルを同梱しています。実際の設定項目に合わせて拡張してください。
{%- endif %}
