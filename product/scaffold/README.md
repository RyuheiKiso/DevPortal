# scaffold — 社内アプリ用スターターキット

DevPortal で配布する社内アプリ向けの **スターター雛形** を集めたディレクトリです。`framework/typescript` 配下の本番ライブラリ群 (`@k1s0-ts-*`) を組み込んだサンプルアプリ実装で、新規プロジェクトを起こす際の出発点として使います。

## 収録テンプレ

| ディレクトリ | スタック | Backstage 上の Component |
|---|---|---|
| [react/](react/) | React 19 + TypeScript + Vite (Web SPA) | `k1s0-scaffold-react` |
| [react_native/](react_native/) | React Native 0.84 + Windows ネイティブ (VS2026) | `k1s0-scaffold-react-native` |

両者を束ねる System として `k1s0-scaffold` も登録されます。

## Backstage カタログ登録

`framework/typescript/` と同じく、Backstage Catalog にエンティティ登録する仕組みを同梱しています。

### 登録される 5 エンティティの構成

| ファイル | 種別 | 名前 | 役割 |
|---|---|---|---|
| `catalog-info.yaml` | System | `k1s0-scaffold` | 配下 2 Component を束ねる System |
| `react/catalog-info.yaml` | Component | `k1s0-scaffold-react` | React SPA スターター (type=website, lifecycle=experimental) |
| `react_native/catalog-info.yaml` | Component | `k1s0-scaffold-react-native` | React Native Windows スターター (同上) |
| `react/template.yaml` | Template | `k1s0-scaffold-react-template` | Scaffolder 雛形 (`/create/templates` に表示) |
| `react_native/template.yaml` | Template | `k1s0-scaffold-react-native-template` | Scaffolder 雛形 (同上) |

owner は `k1s0-framework-team`、domain は `k1s0-framework` で、いずれも `framework/typescript` 側で登録済みの Group / Domain を流用します。Template は `catalog.rules[0].allow` に `Template` を追加する処理が register-locations.py に入っています。

### 前提

**先に `framework/typescript/register-all.bat` を実行して Group `k1s0-framework-team` と Domain `k1s0-framework` を Backstage に登録済みにしておく必要があります。** 未登録のまま scaffold を register すると owner 参照が dangling となり、Backstage UI で警告が出ます。

その他の前提:

- 管理者 PowerShell (または UAC 経由の elevation) — ConfigFile モードのサービス再起動に必要
- Python 3 + PyYAML — `register-locations.py` が app-config.yaml を編集するのに使う
- `DevPortal-Backstage` サービスが起動済みであること

### 登録手順 (推奨: バッチ一発 + 管理者権限)

```cmd
cd C:\work\github\DevPortal\product\scaffold
:: 管理者 PowerShell で実行
register-all.bat
```

これだけで以下が自動実行されます。

1. **前提確認**: 管理者権限、`app-config.yaml` 存在、Python + PyYAML の利用可否
2. **バックアップ**: `app-config.yaml.bak.YYYYMMDD-HHMMSS` にコピー
3. **YAML マージ** (`register-locations.py`): `catalog.locations` に 3 件の `type: file` エントリ追記 (重複は SKIP)
4. **サービス再起動**: `Restart-Service DevPortal-Backstage`
5. **起動待ち**: `/api/auth/guest/refresh` の 200 を最大 120 秒ポーリング
6. **取り込み確認**: `k1s0-scaffold-*` 3 件 (System 1 / Component 2) が見えるまで最大 90 秒ポーリング

実測値: 初回 約 35 秒、再実行時は added=0 / skipped=3 で idempotent。

### オプション

`framework/typescript/register-all.bat` と同じパラメータが使えます。

| パラメータ | 既定値 | 適用モード | 説明 |
|---|---|---|---|
| `-Method` | `ConfigFile` | 共通 | `ConfigFile` (app-config.yaml 編集 + 再起動) / `ApiPost` (REST API POST) |
| `-BackstageUrl` | `http://localhost:7007` | 共通 | Backstage の baseUrl |
| `-AppConfig` | `%ProgramData%\DevPortal\backstage\app\app-config.yaml` | ConfigFile | 編集対象の app-config.yaml |
| `-ServiceName` | `DevPortal-Backstage` | ConfigFile | 再起動する Windows サービス名 |
| `-SkipRestart` | (なし) | ConfigFile | サービス再起動をスキップ |
| `-LocationType` | `file` | ApiPost | `file` / `url` |
| `-UrlBase` | (なし) | ApiPost | `url` モード時の必須 base URL |
| `-Token` | (なし) | ApiPost | permission 有効時の Bearer トークン (未指定なら guest 自動取得) |
| `-MaxParallel` | `4` | ApiPost | 1 ラウンド内の並列度 |
| `-LogFile` | (なし) | 共通 | タイムスタンプ付きで全イベントを追記出力 |

```cmd
:: dry-run でログだけ確認 (Restart はスキップ)
register-all.bat -SkipRestart -LogFile scaffold-dry.log

:: 別マシン Backstage に GitHub raw URL 経由で登録
register-all.bat -Method ApiPost ^
                 -BackstageUrl http://192.168.0.10:7007 ^
                 -LocationType url ^
                 -UrlBase https://raw.githubusercontent.com/myorg/DevPortal/main/product/scaffold
```

### トラブルシュート

| 症状 | 確認ポイント |
|---|---|
| owner `k1s0-framework-team` 未解決の警告 | 先に `framework/typescript\register-all.bat` を実行する |
| `Access to the path ... is denied` | 管理者 PowerShell で再実行 (`Start-Process powershell -Verb RunAs`) |
| `Backstage に到達できません` | `Get-Service DevPortal-Backstage` で起動確認 |
| 取り込み後にエンティティが見えない | `%ProgramData%\DevPortal\backstage\logs\backstage-stdout.log` を確認 |

## Software Templates として使う

register-all.bat の実行後、Backstage の `http://localhost:7007/create/templates` に以下 2 つの新カードが表示されます。

| カード | スタック | metadata.name |
|---|---|---|
| **React 19 SPA (Vite)** | React 19 + TypeScript + Vite | `k1s0-scaffold-react-template` |
| **React Native Windows (VS2026)** | React Native 0.84 + Windows ネイティブ | `k1s0-scaffold-react-native-template` |

### 利用手順

1. ブラウザで `http://localhost:7007/create/templates` を開く
2. 使いたいカードの「Choose」ボタンを押下
3. 必須項目を入力:
   - React 19 SPA: `プロジェクト名` (kebab-case、必須) と `説明` (任意)
   - React Native Windows: 上記に加え `パッケージ名` (reverse-DNS、例 `com.example.myapp`) が必須
4. 「Create」を押下 → Scaffolder が `fetch:template` で `scaffold/skeleton/<sub>/` 配下のみを新規プロジェクトにコピーし、`${{ values.* }}` プレースホルダを自動展開する

### skeleton 化の概要

`scaffold/skeleton/{react,react_native}/` に **git 管理対象だけを抽出した最小雛形** を配置しており、生成物は数十 MB 程度に収まります (旧 `fetch:plain` 時代は約 2 GB)。プレースホルダ置換も同時に行われるため、生成後の手作業 (package.json 書き換え、ファイル名変更等) は不要です。

主な置換内容:

| 項目 | 置換結果 |
|---|---|
| `package.json` `name` | プロジェクト名 |
| `index.html` `<title>` (react) | プロジェクト名 |
| `app.json` `name` / `displayName` (RN) | プロジェクト名 |
| Android `applicationId` / `namespace` | パッケージ名 |
| Android Java パッケージパス (RN) | `android/app/src/main/java/com/example/myapp/` のように展開 |
| iOS xcodeproj / ディレクトリ名 (RN) | `ios/<プロジェクト名>.xcodeproj` 等にリネーム |

### 既知の制約

- **Windows プロジェクト名 (RN) は "ReactNative" 固定**: `windows/` 配下の vcxproj / sln / Identity Name は固定です。Visual Studio は GUID で識別するため動作には支障ありません。表示名を変更したい場合は生成後に `windows/ReactNative.Package/Package.appxmanifest` の `<DisplayName>` を手で編集してください。

### 将来の改良候補

- `publish:github` action でリポジトリ作成 + プッシュまで自動化
- `catalog:register` step で生成直後に Backstage Catalog にも登録

## 関連

- フレームワーク本体: [../framework/typescript/README.md](../framework/typescript/README.md)
- 雛形 YAML: [../framework/format/backstage/README.md](../framework/format/backstage/README.md)
- 公式 Descriptor Format: https://backstage.io/docs/features/software-catalog/descriptor-format
- 公式 Scaffolder (Software Templates): https://backstage.io/docs/features/software-templates/
