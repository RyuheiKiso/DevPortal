---
name: kotlin-config
description: >-
  DevPortal の KMP 共有パッケージ packages/kotlin/config（config:core / config:ui）の使い方。
  Android / Windows(Desktop) クライアントで「アプリ設定」を 3層（既定→システム→ユーザー）で
  ロード・ディープマージ・監視・保存したいとき、ConfigStore<T> / ConfigSources / ConfigScreen を
  使う実装手順とお約束を示す。Kotlin の設定読み込み・設定画面・StateFlow ベースの構成を扱う作業で参照する。
---

# packages/kotlin/config の使い方

DevPortal の **アプリ設定**を、3層（既定 `default` → システム `system` → ユーザー `user`）で
ロード・ディープマージ・変更監視・保存するための KMP 共有パッケージ。対象は **Android / Windows(Desktop/JVM)**。

- `config:core` … ロジックのみ（Compose 非依存）。`ConfigStore<T>` / `ConfigSources` / `Layer` / `WritableScope`。
- `config:ui` … Compose Multiplatform の **ドロップイン設定画面** `ConfigScreen<T>(store)`。`core` に一方向依存。

> このパッケージの責務は「ロード・マージ・監視・保存」と「型安全アクセス」まで。**設定スキーマ `T` は利用者（各アプリ）が所有**する。
> 詳細な設計判断・プラットフォーム別ファイル配置・マージ仕様は `packages/kotlin/config/README.md` を参照。

---

## いつ使うか

- KMP（Android/Desktop）クライアントに**ユーザーが編集できる設定**を入れたいとき。
- 設定を**ファイル変更に追従してリアクティブ**に反映したいとき（`StateFlow<T>`）。
- 「ゲームのコンフィグ画面」のような**設定画面を自動生成**したいとき（`ConfigScreen`）。

---

## 手順

### 1. 依存を追加する

```kotlin
// 利用側モジュールの build.gradle.kts（commonMain）
dependencies {
    // ロジックだけ欲しい場合
    implementation(project(":packages:kotlin:config:core"))
    // 自動生成の設定画面も欲しい場合は追加で依存する
    implementation(project(":packages:kotlin:config:ui"))
}
```

### 2. 設定スキーマ `T` を定義する（利用者が所有）

スキーマは config ではなく**アプリ側**で定義する。必ず次を守る。

- `@Serializable` を付ける。
- **全フィールドにデフォルト値を持たせる**（各層は部分 JSON・空 JSON になり得るため）。
- ネストした設定もデフォルト値付きのデータクラスにする。

```kotlin
// 【アプリ側で定義】アプリ固有の設定スキーマ。config はこの型を所有せずジェネリック T として受け取る
@Serializable
data class MyAppConfig(
    // API 接続設定（デフォルト値を持つので bundle が無くても動く）
    val api: ApiConfig = ApiConfig(),
    // UI 設定
    val ui: UiConfig = UiConfig(),
    // 利用者が自由に足せる項目の例
    val featureX: Boolean = false,
)

// API 接続に関する設定群
@Serializable
data class ApiConfig(
    // 接続先のベース URL
    val baseUrl: String = "https://localhost",
    // 通信タイムアウト（秒）
    val timeoutSec: Int = 30,
)

// 画面表示に関する設定群
@Serializable
data class UiConfig(
    // テーマ名（例: light / dark）
    val theme: String = "light",
)
```

> ⚠️ 全フィールドにデフォルトが無いと、空設定からの初期化時に `IllegalArgumentException`（「空の設定からデコードできません」）になる。

### 3. プラットフォーム別に `ConfigSources` を生成する

`ConfigSources` はファイル入出力・監視を担う供給元。Android / Desktop で実装が分かれる（`expect/actual` ではなくプラットフォーム別クラスを直接生成）。

```kotlin
// Android（androidMain）: 既定層=assets、システム/ユーザー層=filesDir/config/*.json
val sources = AndroidConfigSources(
    // assets と filesDir へのアクセスに使う Context
    context = context,
    // 既定設定の assets パス（既定値: "config/default.json"）
    // defaultAssetName = "config/default.json",
)
```

```kotlin
// Desktop/Windows（desktopMain）: exe と同じフォルダの config/*.json に 3層を集約
val sources = DesktopConfigSources(
    // 省略時は ProcessHandle から exe 隣の config/ を自動解決（IDE 実行時は user.dir にフォールバック）
    // configDir = DesktopConfigSources.defaultConfigDir(),
)
```

ファイル配置（既定）:
- Desktop: `<exe>/config/{default,system,user}.json`（`default.json` のみ読取専用扱い）
- Android: 既定=`assets/config/default.json`（読取専用）、システム/ユーザー=`filesDir/config/{system,user}.json`

### 4. `ConfigStore<T>` を生成する

```kotlin
// reified で KSerializer<T> を内部取得するため、serializer の明示は不要
val store = ConfigStore.create<MyAppConfig>(
    // 手順 3 で作った供給元
    sources = sources,
    // 初回ロードとファイル監視を回すスコープ（ライフサイクルは利用者が制御）
    coroutineScope = appScope,
    // JSON 設定は任意（既定: ignoreUnknownKeys=true, encodeDefaults=true）
)
```

`create` 直後に初回ロードと各層の監視が **非同期で**始まる。確定値が要るなら `store.reload().getOrThrow()` で同期する（テスト等）。

### 5. 設定を読む（リアクティブ）

```kotlin
// Compose から購読（ファイル変更・保存で自動更新される）
val cfg by store.config.collectAsState()
// 例: テーマ名を使う
val theme = cfg.ui.theme

// Compose 外で現在値が欲しいとき
val now = store.config.value
```

### 6. 非致命的エラーを購読する（任意）

破損ファイルや型不一致は**例外を投げず**、直前の有効値を維持したまま `errors` に流れる。

```kotlin
// 警告表示やロギングに使う
appScope.launch {
    store.errors.collect { e -> showWarning(e.message) }
}
```

### 7. 設定を保存する（層を指定して書き込む）

`update(scope, transform)` の `transform` は **その層の現在の生 JSON（`JsonObject`）を受け取り、その層の新しい全 JSON を返す**。
返した内容で層が**丸ごと置き換わる**ため、他キーを残したいときは受け取った `current` を土台にする。

```kotlin
// ユーザー層の featureX だけ true にする（他キーは保持）
store.update(WritableScope.USER) { current ->
    // 現在のユーザー層をコピーして 1 キーだけ差し替える
    JsonObject(current.toMutableMap().apply { put("featureX", JsonPrimitive(true)) })
}

// 該当層を空にして下位層/既定へ戻す
store.update(WritableScope.USER) { JsonObject(emptyMap()) }
```

- 書込先は `WritableScope.SYSTEM` / `WritableScope.USER`（既定層は書込対象外）。
- 書込→アトミック保存（temp 書込→rename）→再マージ→`config` 更新、までを内部で行う。
- 書込不可（読取専用フォルダ等）でも**クラッシュせず `Result.failure`** を返す。`getOrThrow()` せずに結果を見ること。

### 8. 設定画面を出す（config:ui・任意）

`T` の構造を `SerialDescriptor` で走査し、型ごとの編集部品（Switch / TextField / Dropdown / ネストはセクション）を**自動生成**する。「適用 / 取消 / デフォルトに戻す」を内蔵し、**変更項目だけを差分保存**する。

```kotlin
// これ 1 行で設定画面が出る（既定の保存先はユーザー層）
ConfigScreen(store)

// 保存先の層を変えることもできる
ConfigScreen(store, scope = WritableScope.SYSTEM)
```

ラベルや並びは `@ConfigLabel("表示名")` をスキーマのプロパティに付けて調整（無ければフィールド名）。
List / Map など未対応の型は読み取り表示にフォールバックする。

---

## マージ仕様（覚えておくこと）

低い層から順にディープマージする（**既定 < システム < ユーザー**）。

| 種別 | 挙動 |
| --- | --- |
| オブジェクト `{}` | キー単位で**再帰マージ**（上位に無いキーは下位を保持） |
| スカラー（文字列/数値/真偽） | 上位層の値で**置換** |
| 配列 `[]` | **丸ごと置換**（連結しない） |
| `null` | キーがあれば「null で上書き」、キー自体が無ければ下位を保持 |

---

## お約束・つまずきどころ

- **スキーマの全フィールドにデフォルト値**を必ず付ける（空設定デコードのため）。
- `update` の `transform` は**層の全内容を返す**。他キーを残すなら受け取った `current` を土台にする。
- 破損・型不一致は**例外で落とさない**設計。`errors`（Flow）と `reload()/update()` の `Result` で扱う。
- `coroutineScope` のライフサイクルは**利用者が管理**する（破棄時にキャンセルして監視を止める）。
- 機密情報は現状**平文保存**（OS のファイル権限が唯一の防御線）。将来 Keystore / DPAPI 暗号化に差し替え予定。
- 公開 API は `ConfigStore<T>` / `ConfigStore.create` / `WritableScope` / `ConfigSources`（`AndroidConfigSources` / `DesktopConfigSources`）/ `ConfigScreen` / `@ConfigLabel`。

## 参照

- 設計判断・配置・仕様の詳細: `packages/kotlin/config/README.md`
- 公開 API 実体: `packages/kotlin/config/core/src/commonMain/kotlin/com/devportal/config/`
- 設定画面: `packages/kotlin/config/ui/src/commonMain/kotlin/com/devportal/config/ui/ConfigScreen.kt`
