# Kotlin (KMP + CMP) クライアントテンプレート

Backstage の **Software Template**（scaffolder）です。Kotlin Multiplatform（KMP）＋ Compose Multiplatform（CMP）で、**Android** と **Windows（デスクトップ/JVM）** の両方で動くクライアントアプリの雛形を生成します。

DevPortal のクライアント基盤（`apps/frontend/native`、共有パッケージ `packages/kotlin/config`）と同じ技術スタック・同じバージョン軸に揃えてあります。

## 構成

```text
templates/kotlin/
├── template.yaml     # スキャフォルダーのテンプレート定義（入力フォーム・実行ステップ）
└── skeleton/         # 生成されるプロジェクトの中身（${{ ... }} を fetch:template で置換）
    ├── settings.gradle.kts / build.gradle.kts / gradle.properties
    ├── gradle/libs.versions.toml / gradle/wrapper/*  （Gradle 8.7 wrapper を同梱）
    ├── gradlew / gradlew.bat
    ├── composeApp/   # 単一モジュール（commonMain / androidMain / desktopMain）
    ├── catalog-info.yaml / mkdocs.yml / docs/index.md / README.md / .gitignore
```

## 入力パラメータ

| パラメータ | 用途 |
| --- | --- |
| `component_id` | カタログ識別子（kebab-case）。`rootProject.name` にも使用 |
| `app_title` | 表示名（ウィンドウタイトル・`app_name`・見出し） |
| `description` | 説明（catalog-info / README） |
| `owner` | オーナー（Group/User、OwnerPicker） |
| `system` | 所属システム（任意、EntityPicker） |
| `package_name` | ベースパッケージ（namespace / applicationId / package 宣言・`mainClass` の土台） |
| `windows_product_name` | MSI/EXE インストーラの製品名 |
| `package_version` | 配布バージョン（x.y.z） |
| `min_sdk` | Android 最小 SDK（24/26/28） |
| `include_serialization` | kotlinx.serialization のサンプルを含めるか（boolean） |
| `repo_url` | 作成先 GitHub リポジトリ（RepoUrlPicker） |

## 生成されるアプリのバージョン軸

DevPortal ルートの `gradle/libs.versions.toml` と一致させています。

- Kotlin **2.1.0** / Compose Multiplatform **1.7.1** / AGP **8.5.2** / Gradle **8.7** / JDK **17**
- 対象: Android（compileSdk/targetSdk 34）、Windows デスクトップ（JVM）
- 構成: **単一 `composeApp` モジュール**（`androidTarget()` + `jvm("desktop")`）

> この単一モジュール構成は AGP 8.x 専用です。AGP 9.0 以降は別構成（`shared + androidApp + desktopApp`）が必要になるため、バージョンを上げる際は Kotlin / CMP / AGP / Gradle をまとめて見直してください。

## Backstage への登録

`app-config.yaml` の `catalog.locations` にこのテンプレートを追加します（GitHub 上のパスに合わせて調整してください）。

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/<org>/DevPortal/blob/main/templates/kotlin/template.yaml
      rules:
        - allow: [Template]
```

> ローカル検証時は `type: file` で `templates/kotlin/template.yaml` を指すこともできます。

## 設計メモ

- **テンプレート化されないファイル**: `gradlew` / `gradlew.bat` / `gradle/wrapper/*` は `fetch:template` の `copyWithoutTemplating` で内容を変換せずコピーします（Nunjucks 構文の混入とバイナリ jar の破損を防ぐため。なお旧 `copyWithoutRender` は Backstage 1.40 以降ハンドラに無視されるため使用しません）。
- **コメント規約**: 生成物の Kotlin / Gradle / XML / YAML は、DevPortal の方針に従い各行の上に日本語コメントを付けています。`${{ values.X }}` は 1 行に 1 つだけ値の途中へ埋め込み、行・コメントの対応が崩れないようにしています。
- **任意機能の出し分け**: `include_serialization` などの条件分岐は `{%- if %}` で行・ファイル単位に出し分け、生成後も「1 行 = 1 コメント」が保たれるようにしています。
