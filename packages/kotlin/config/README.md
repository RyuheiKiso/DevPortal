# config (KMP 設定ロードパッケージ)

アプリケーションの設定を **3層（既定 → システム → ユーザー）** で読み込み、マージし、変更を監視し、保存するための Kotlin Multiplatform 共有パッケージ。

- 対象プラットフォーム: **Android** / **Windows (Desktop/JVM)**
- 構成: **`config:core`（ロジック・Compose非依存）** と **`config:ui`（設定画面・Compose MP）** の2モジュール。利用者は必要な方だけ依存する。
- 依存元: `apps/frontend/native`（および設定を必要とする各クライアント）

> このパッケージの責務は「設定のロード・マージ・監視・保存」と「型安全なアクセス」まで。設定値の**意味**（認証やテーマの実装）は利用側アプリが担当する。
>
> また、**設定スキーマ（項目定義）も利用者が所有**し、config はジェネリック `T` として受け取る。これにより利用者は独自の設定項目を型安全に追加できる。

---

## 1. 決定サマリ

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | 領域モデル | **3層** `既定(bundle) → システム → ユーザー` を deep merge |
| 2 | フォーマット | **JSON**（kotlinx.serialization） |
| 3 | 反映方式 | **リアクティブ** `StateFlow<AppConfig>`（ファイル監視で自動再マージ） |
| 4 | スキーマ | **利用者定義のジェネリックスキーマ**（`ConfigStore<T>`。config は型を所有せず、利用者が `@Serializable` な `T` を定義。各利用者にとっては型安全な固定スキーマ） |
| 5 | 書き込み | **全領域 読み書き** |
| 6 | システム書込 | Desktop・Android とも **編集可能**（system.json は通常のファイル）。書込不可の場所に置かれたときのみ `Result.failure` |
| 7 | 機密情報 | **設定に平文で含める**（`Secrets` 型に分離・将来暗号化に差替可） |
| 8 | 配置(Desktop) | **exe と同じフォルダの `config/`** に3層を集約（ポータブル）。Windows のインストール先はユーザーが自由に選択 |
| 9 | モジュール分割 | **`config:core`（ロジック・Compose非依存）** と **`config:ui`（設定画面・CMP）** に分離。依存は ui → core の一方向。利用者は必要な方だけ依存 |
| 10 | 設定画面 | `config:ui` は **`ConfigScreen(store)` 1行で出るドロップイン画面**（`T` の構造から自動生成＝方式B）。ゲームのコンフィグ画面のように使える |

---

## 2. 用語・領域定義

| 層 | 由来 | 優先度 | 書込 |
| --- | --- | --- | --- |
| 既定 (bundle) | アプリ同梱の出荷時設定 | 低 | ❌ 不可（読取専用リソース） |
| システム | 組織/管理者が配布する設定 | 中 | ⚠️ 権限がある時のみ |
| ユーザー | ユーザーごとの個人設定 | 高 | ✅ 可 |

優先度は **既定 < システム < ユーザー**。上位層が下位を上書きし、上位に無い項目は下位層で補完する。

> **Android の注意**: Android には「マシン全体のシステム設定」という概念が無いため、システム層も `filesDir/config/system.json`（アプリ専用領域内のファイル）として持ち、Desktop と同様に**編集可能**にする。ただし `filesDir` はアプリのサンドボックス内のため、「システム＝管理者のみ変更可」という保護は付かず、system / user の差は物理的なファイル分割のみとなる。管理者配布が必要になった場合は MDM Managed Config を読取の上書きソースとして将来追加できる。

---

## 3. ファイル配置（プラットフォーム別）

**Desktop(Windows) は exe と同じフォルダの `config/` に3層を集約する（ポータブル方式）。**

```
<MyApp.exe のあるフォルダ>/
├── MyApp.exe
└── config/
    ├── default.json   ← 既定（出荷時・読取専用扱い）
    ├── system.json    ← システム層
    └── user.json      ← ユーザー層
```

| 層 | Windows (Desktop/JVM) | Android | 書込 |
| --- | --- | --- | --- |
| 既定 | `<exe>/config/default.json` | assets 同梱 | ❌ 読取専用扱い |
| システム | `<exe>/config/system.json` | `filesDir/config/system.json` | ✅ |
| ユーザー | `<exe>/config/user.json` | `filesDir/config/user.json` | ✅ |

- **Windows のインストール先はユーザーが自由に選択**し、書込可能な場所に置く前提。これにより `config/` 配下は通常読み書き可能になる（読取専用フォルダに置かれた場合のみ書込が失敗）。
- **exe フォルダの解決**: `ProcessHandle.current().info().command()` の親フォルダを基点にする。取得できない場合（IDEからのJVM実行など開発時）は `user.dir` にフォールバックする。
- **Android** は exe の概念が無いため、`filesDir/config/`（システム・ユーザー層）＋ assets（既定層）に配置する。filesDir はアプリ専用領域のため両層とも編集可能だが、system / user に権限的な保護差は付かない。
- パス解決は `expect`/`actual` でプラットフォーム別に実装する。

---

## 4. マージ仕様（deep merge）

3層を **低い層から順に** deep merge する。種別ごとの挙動は以下。

| 種別 | 挙動 |
| --- | --- |
| オブジェクト `{}` | **キー単位で再帰マージ**。上位に無いキーは下位を保持 |
| スカラー（文字列/数値/真偽） | 上位層の値で**置換** |
| 配列 `[]` | **丸ごと置換**（連結はしない＝予測しやすさ優先） |
| `null` | キーが存在すれば「null で上書き」、キー自体が無ければ「下位を保持」 |

### マージ例

```text
優先度 低 ───────────────────────► 高
[既定]          [システム]        [ユーザー]
timeoutSec=30   timeoutSec=60     theme=dark
theme=light     theme=light
                          ↓ deep merge
結果: timeoutSec=60, theme=dark
```

---

## 5. フォーマットと型付け（2段デシリアライズ）

deep merge と型安全を両立するため、**JsonElement でマージしてから型付きデータクラスへ変換**する。

```text
各層の部分JSON（欠損OK）
  → JsonObject に parse
  → deep merge して完成した JsonObject を生成
  → Json.decodeFromJsonElement<T>(merged)   // T は利用者定義の型。既定値はデータクラスのデフォルト引数で吸収
```

これにより「各層は一部のキーだけ書けばよい」「最終型は完全に型安全」を両立する。

### 利用者スキーマの要件

設定スキーマは **config パッケージではなく利用者（各アプリ）が定義**する。config は型を所有せず、ジェネリック `T` として受け取る。利用者が定義する `T` は以下を満たすこと。

- `@Serializable` を付与する（kotlinx.serialization の対象にする）。
- **全フィールドにデフォルト値を持たせる**（各層は部分JSON・空JSONになり得るため、欠損時もデシリアライズ可能にする）。
- ネストした設定もデータクラスにする。

### スキーマ定義（利用者側の例）

```kotlin
// 【利用者側で定義する】アプリ固有の設定スキーマ。
// config パッケージはこの型を所有せず、ジェネリック T として受け取る。
@Serializable
data class MyAppConfig(
    // API接続設定。既定値を持たせ、bundle層が無くても動作する
    val api: ApiConfig = ApiConfig(),
    // UI設定
    val ui: UiConfig = UiConfig(),
    // 機密情報。平文保存だが将来の暗号化に備え独立した型に分離
    val secrets: Secrets = Secrets(),
    // 利用者が自由に追加できる独自項目の例
    val featureX: Boolean = false,
)

// API接続に関する設定群
@Serializable
data class ApiConfig(
    // 接続先のベースURL
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

// 機密情報。OSのファイル権限が唯一の防御線になる点に注意
@Serializable
data class Secrets(
    // 認証トークン。未設定時はnull。将来は暗号化層経由で読み書きする
    val authToken: String? = null,
)
```

---

## 6. ロード／リアクティブ仕様

- 公開する設定は `StateFlow<AppConfig>`。**ファイル変更を監視して自動再マージ**する。
- 監視実装: Desktop = `java.nio WatchService`、Android = `FileObserver`（または DataStore の Flow）。
- 破損ファイルは**無視して直前の有効値を維持**する（「8. エラー・フォールバック」参照）。

---

## 7. 書き込み仕様

- `update(scope, transform)` で指定領域の生JSONを書き換え → **アトミック保存**（temp書込 → rename）→ 再マージ → `StateFlow` 更新。
- 同時書込はライブラリ内で **Mutex により直列化**する。
- **書き込み権限が無い場合**は **クラッシュさせず `Result.failure` を返す**。
  - Windows: インストール先はユーザーが選択し書込可能な場所に置く前提のため、`config/` 配下は通常読み書き可能。読取専用フォルダ（例: Program Files 配下）に置かれた場合のみ書込が失敗する。
  - Android: `filesDir/config/` はアプリ専用領域のため system / user とも書込可能。

---

## 8. 機密情報の扱い

- `Secrets` は **平文で設定ファイルに保存**する（決定 #7）。
- ⚠️ この場合、保存ファイルの **OS権限 / ACL が唯一の防御線**になる。ディスクの抜き取りやバックアップ流出には無防備である点に留意する。
- 将来 **Android Keystore / Windows DPAPI** による暗号化に移行できるよう、`Secrets` を独立した型に分離し、読み書きを暗号化層に差し替え可能な構造にしておく。

---

## 9. エラー・フォールバック

| 事象 | 方針 |
| --- | --- |
| ファイル無し | その層を空 `{}` 扱いで続行 |
| JSON破損 | その層を無視＋警告ログ。直前の有効値を維持 |
| 型不一致 | デシリアライズ失敗を `Result` で返却、`StateFlow` は更新しない |
| 書込権限なし | `Result.failure` を返す（クラッシュさせない） |

---

## 10. 公開API

```kotlin
// 利用者が定義したスキーマ型 T を3層マージしてリアクティブに提供する汎用ストア
interface ConfigStore<T> {
    // 現在のマージ済み設定（利用者が定義した型 T）。ファイル変更や書き込みで自動更新される
    val config: StateFlow<T>

    // 指定領域の生JSONを編集して保存する（保存→再マージ→config更新）
    // システム領域で権限が無い場合は Result.failure を返し、クラッシュしない
    suspend fun update(scope: WritableScope, transform: (JsonObject) -> JsonObject): Result<Unit>

    // 全領域を手動で再読込する（通常はファイル監視で自動。明示再読込用）
    suspend fun reload()

    companion object {
        // 利用者の型 T を指定してストアを生成するファクトリ。
        // reified により KSerializer<T> を内部で自動取得するため、利用者はserializerを明示しなくてよい。
        inline fun <reified T> create(
            // プラットフォーム別のファイル供給元（領域ごとのパス解決・IO・監視）
            sources: ConfigSources,
        ): ConfigStore<T>
    }
}

// 書き込み可能な領域。既定(bundle)は同梱リソースのため書込対象外
enum class WritableScope { SYSTEM, USER }
```

### 設定画面（config:ui）

`config:ui` は「呼べば出る」**ドロップイン設定画面**を提供する。利用者は1行置くだけで、ゲームのコンフィグ画面のように設定を変更できる。

```kotlin
// これ1つで設定画面が丸ごと出る（T の構造から自動生成）
@Composable
inline fun <reified T> ConfigScreen(
    // core のストア。表示する値と保存先を司る
    store: ConfigStore<T>,
    // 編集して保存する層（既定はユーザー層）
    scope: WritableScope = WritableScope.USER,
)
```

- スキーマ `T` のフィールドを `SerialDescriptor` で走査し、型ごとの編集部品（Switch / TextField / Dropdown…）を自動配置する。
- ネストしたデータクラスはカテゴリ（セクション/タブ）になる。
- 「適用 / デフォルトに戻す」を内蔵し、**変更した項目のみ該当層へ差分保存**する。
- ラベルや並び順は `@ConfigLabel` 等のアノテーションで調整する（任意。無ければフィールド名を表示）。
- `reified T` により ui 側だけで `serializer<T>()` から descriptor を取得し、`store.config` の値を JSON 化して編集 → `store.update(scope){…}` で保存する。**core 側の追加は不要**。

利用側の使い方：
```kotlin
// 設定画面を開くだけ。あとはユーザーがゲーム設定のように変更・保存できる
ConfigScreen(store)
```

---

## 11. モジュール構成

config パッケージは **ロジック（core）** と **設定画面（ui）** の2モジュールに分かれる。利用者は必要な方だけ依存する。

```text
packages/kotlin/config/
├── core/                     # ① ロジックのみ（Compose非依存）
│   ├── build.gradle.kts      #   KMP: androidTarget()+jvm("desktop"), kotlinx-serialization, coroutines
│   └── src/
│       ├── commonMain/   # ConfigStore<T>, deep mergeロジック, JSON処理（スキーマは利用者が T として定義）
│       ├── androidMain/  # パス解決(filesDir/config), FileObserver監視
│       └── desktopMain/  # パス解決(exe隣config), WatchService監視
└── ui/                       # ② 設定画面（Compose Multiplatform）
    ├── build.gradle.kts      #   依存: :config:core, Compose Multiplatform
    └── src/
        └── commonMain/   # 設定画面コンポーネント / 設定項目の部品（core の StateFlow を購読し update を呼ぶ）
```

依存方向は **ui → core の一方向**（core は UI を知らない）。

- ロジックだけ欲しい利用者: `implementation(project(":packages:kotlin:config:core"))`
- 設定画面も欲しい利用者: 上記に加え `implementation(project(":packages:kotlin:config:ui"))`

### プラットフォーム別実装方針（expect/actual）

- `core/commonMain`: マージロジック・スキーマ・JSON処理・`ConfigStore` 本体（プラットフォーム非依存）。
- `core/androidMain` / `core/desktopMain`: パス解決とファイルIO・ファイル監視を `actual` で実装。
- `ui/commonMain`: Compose Multiplatform の設定画面。`core` の `StateFlow<T>` を `collectAsState()` で購読し、編集結果を `update()` で保存する。

---

## 12. 未決事項 / 次のアクション

- [ ] Android のシステム層に管理者保護が必要になった場合、MDM Managed Config を読取の上書きソースとして追加するか検討する。
- [ ] 利用者スキーマ `T`（例: `MyAppConfig`）の具体的な項目を各アプリの業務要件に合わせて定義する（本書の例は最小サンプル）。
- [ ] テスト方針（マージ仕様のユニットテスト、プラットフォーム別IOのテスト）を決める。
- [ ] 機密情報の暗号化（Android Keystore / Windows DPAPI）への移行時期を検討する。
- [ ] `config:ui` のドロップイン画面の細部（層切替UI、Apply/即時反映、`@ConfigLabel` 等アノテーションのセット、List など複雑型の扱い）を詰める。
- [ ] 実装スケルトン（`build.gradle.kts` ＋ `commonMain` 骨組み）の作成。
