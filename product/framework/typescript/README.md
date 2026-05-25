# @k1s0-ts-* TypeScript フレームワークパッケージ

DevPortal の TypeScript 共通基盤ライブラリ群を格納するディレクトリです。各サブディレクトリにはプラットフォーム別 (core / react / react-native) の npm パッケージが配置されており、社内 Verdaccio (`http://localhost:4873`) に publish して利用します。

## パッケージ一覧

| ディレクトリ | パッケージ名 | 用途 |
|---|---|---|
| `library/auth/core` | `@k1s0-ts-auth/core` | 認証・認可コア (session / role / permission / token store / HTTP auth headers) |
| `library/auth/react` | `@k1s0-ts-auth/react` | React 向け認証 Provider / Hook / 表示ガード |
| `library/auth/react-native` | `@k1s0-ts-auth/react-native` | React Native 向け認証 Provider / Hook / native token store |
| `library/config/core` | `@k1s0-ts-config/core` | 設定管理コア (環境変数 / JSON / バリデーション) |
| `library/config/react` | `@k1s0-ts-config/react` | React 向け設定 Provider / Hook |
| `library/config/react-native` | `@k1s0-ts-config/react-native` | React Native 向け設定 Provider / Hook |
| `library/logger/core` | `@k1s0-ts-logger/core` | ロガーコア (level / transport / 構造化ログ) |
| `library/logger/react` | `@k1s0-ts-logger/react` | React 向けロガー Provider / Hook |
| `library/logger/react-native` | `@k1s0-ts-logger/react-native` | React Native 向けロガー Provider / Hook |
| `library/http/core` | `@k1s0-ts-http/core` | HTTP クライアントコア (REST / gRPC-web / retry / requestId) |
| `library/http/react` | `@k1s0-ts-http/react` | React 向け HTTP Hooks (Query / Mutation) |
| `library/http/react-native` | `@k1s0-ts-http/react-native` | React Native 向け HTTP Hooks (NetInfo 連携) |
| `library/notification/core` | `@k1s0-ts-notification/core` | 通知コア (headless / toast / dialog / confirm / HttpError 連携) |
| `library/notification/react` | `@k1s0-ts-notification/react` | React 向け通知 Provider / Hook |
| `library/notification/react-native` | `@k1s0-ts-notification/react-native` | React Native 向け通知 Provider / Hook |

依存関係は `react` / `react-native` が同グループの `core` を参照する形です (`file:../core` 開発参照 → publish 時に `^<version>` に自動書き換え)。

## publish スクリプト

このディレクトリには 15 パッケージを Verdaccio へ一括 publish するためのスクリプトを同梱しています。

| ファイル | 役割 |
|---|---|
| `publish-all.bat` | ダブルクリック / コマンドプロンプトから起動するための実行ポリシーバイパス付きラッパー |
| `publish-all.ps1` | 本体。Verdaccio 認証 / 依存順 publish / バージョン重複スキップを行う PowerShell スクリプト |

### 前提条件

- 本端末で setup GUI から **Verdaccio がインストール済み** であること (`DevPortal-Verdaccio` サービスが起動状態)
- `http://localhost:4873/-/ping` が HTTP 200 で応答すること
- Node.js / npm が PATH に通っていること
- Verdaccio に publish 権限を持つユーザー (既定 `admin` / `admin`) が存在すること

### 基本的な使い方

```cmd
cd C:\work\github\DevPortal\product\framework\typescript
publish-all.bat
```

これだけで以下が自動実行されます。

1. Verdaccio (`http://localhost:4873`) の死活確認
2. `admin` / `admin` で htpasswd 認証 → publish 用 JWT を取得
3. 取得トークンを `%TEMP%` 配下の使い捨て `.npmrc` に書き出し、`NPM_CONFIG_USERCONFIG` 環境変数で npm に読み込ませる (ユーザーの `~/.npmrc` は汚染されません)
4. 第 1 ラウンドで `*/core` 4 パッケージを並列 publish (既定 4 並列、`-MaxParallel` で変更可)
5. 第 2 ラウンドで `*/react` `*/react-native` 8 パッケージを並列 publish
6. 集計結果 (パッケージごとの所要時間 + トータル) を OK / SKIP / FAIL の色付きで表示
7. 一時 `.npmrc` を削除して終了

終了コードは「FAIL が 1 件でもあれば 1、それ以外 0」です。

### オプション

```cmd
publish-all.bat -DryRun
publish-all.bat -Registry http://192.168.0.10:4873 -User dev -Password secret
```

| パラメータ | 既定値 | 説明 |
|---|---|---|
| `-Registry` | `http://localhost:4873` | publish 先 Verdaccio URL |
| `-User` | `admin` | htpasswd ユーザー名 |
| `-Password` | `admin` | htpasswd パスワード |
| `-DryRun` | (なし) | 指定時は `npm publish --dry-run` を実行し、実 publish は行わない |
| `-MaxParallel` | `4` | 1 ラウンド内で並行 publish するパッケージ数 (1〜16)。`1` で逐次実行 (Phase 1 互換) |
| `-LogFile` | (なし) | 指定したパスにタイムスタンプ付きで全イベントを追記出力 (例: `-LogFile publish.log`) |

引数は `.bat` から `.ps1` にそのまま転送されます。

```cmd
publish-all.bat -MaxParallel 8 -LogFile publish.log
publish-all.bat -DryRun -MaxParallel 1
```

### バージョン重複の扱い

publish 前に各パッケージで `npm view <name>@<version>` を実行し、既に同一バージョンが Verdaccio に存在する場合は **SKIP** として次のパッケージに進みます。再実行時の安全装置として機能するほか、新しい version を上げたパッケージだけを差分 publish する用途にも使えます。

新しいバージョンを publish したい場合は、対象パッケージの `package.json` の `version` を上げてから再実行してください。

### 失敗時のトラブルシュート

| 症状 | 確認ポイント |
|---|---|
| `Verdaccio に到達できません` | `Get-Service DevPortal-Verdaccio` で起動状態を確認。停止していたら `Start-Service DevPortal-Verdaccio` |
| `認証に失敗しました` | 既定 `admin` / `admin` を変更している場合は `-User` / `-Password` を渡す |
| ある `core` パッケージで FAIL → 後続の同グループ react が FAIL | core を先に正常 publish してから再実行。バージョン重複が原因のときは version を上げる |
| `prepublishOnly` の `test:coverage` が失敗 | 各パッケージで個別に `npm test` を実行して原因特定 |
| Verdaccio が応答しない / publish が固まる | 管理者権限で `Restart-Service DevPortal-Verdaccio` を実行 → `publish-all.bat` を再実行 |
| `-MaxParallel` を大きくしたら CPU が張り付く | `prepublishOnly` で test が同時実行されるため、`-MaxParallel 1` or `2` に下げる |

## 実行例

`publish-all.bat -MaxParallel 4 -LogFile publish.log` を実行したときの出力例 (色は省略、行数は短縮):

```text
[INFO] Registry    : http://localhost:4873
[INFO] User        : admin
[INFO] DryRun      : False
[INFO] MaxParallel : 4
[INFO] LogFile     : C:\work\github\DevPortal\product\framework\typescript\publish.log
[INFO] Verdaccio の死活確認中...
[ OK ] Verdaccio に到達可能
[INFO] Verdaccio に認証要求中...
[ OK ] 認証成功 (token 長 148)
[INFO] 一時 .npmrc を作成: C:\Users\you\AppData\Local\Temp\npmrc-publish-xxxx.ini
[INFO] ===== Round 1 開始 =====
[INFO] [R1] @k1s0-ts-config/core を投入 (running=1/4 pending=3)
[INFO] [R1] @k1s0-ts-logger/core を投入 (running=2/4 pending=2)
[INFO] [R1] @k1s0-ts-http/core を投入 (running=3/4 pending=1)
[INFO] [R1] @k1s0-ts-notification/core を投入 (running=4/4 pending=0)
[SKIP] @k1s0-ts-http/core@0.1.0 [00:00:00.42] スキップ (already published)
[ OK ] @k1s0-ts-logger/core@0.1.0 [00:00:28.41] publish 成功
[ OK ] @k1s0-ts-config/core@0.1.0 [00:00:31.07] publish 成功
[ OK ] @k1s0-ts-notification/core@0.1.0 [00:00:34.92] publish 成功
[INFO] ===== Round 1 完了 =====
[INFO] ===== Round 2 開始 =====
...
[INFO] ===== Summary =====
[ OK ] @k1s0-ts-config/core@0.1.0                   00:00:31.07
[SKIP] @k1s0-ts-http/core@0.1.0                     00:00:00.42
[ OK ] @k1s0-ts-logger/core@0.1.0                   00:00:28.41
[ OK ] @k1s0-ts-notification/core@0.1.0             00:00:34.92
[ OK ] @k1s0-ts-config/react@0.1.0                  00:00:12.18
...
[INFO] Total: 00:01:48.62  (OK 11 / SKIP 1 / FAIL 0)
```

`-LogFile` を指定すると、上と同じ内容が `[2026-05-24T19:33:41+09:00] [ OK ] ...` 形式でファイルに追記されます (既存ログには末尾追記)。

## バージョンの取り下げ (unpublish)

同一バージョンは上書き publish できません。修正版を出すには、(1) `package.json` の `version` を上げて再実行するか、(2) 以下のいずれかで既存バージョンを取り下げます。

### A. npm CLI で取り下げる (推奨)

```cmd
npm unpublish @k1s0-ts-http/core@0.1.0 --registry http://localhost:4873 --force
```

`--force` を付けないと「24 時間以内のパッケージしか削除できない」というガードに引っかかる場合があるため、社内 Verdaccio では `--force` 付きで実行します。実行後に `publish-all.bat` を再実行すれば再 publish されます。

### B. Verdaccio Web UI で確認する

`http://localhost:4873/` をブラウザで開くと、publish 済みパッケージとバージョン一覧を確認できます。Web UI 自体は閲覧専用 (削除 UI はありません) のため、削除は CLI で実施してください。

### C. 最終手段: storage の直接削除

CLI でも消えない場合は、管理者権限で以下を実行します (サービス停止 → ディレクトリ削除 → サービス再開)。

```powershell
Stop-Service DevPortal-Verdaccio
Remove-Item -Recurse -Force "$env:ProgramData\DevPortal\verdaccio\storage\@k1s0-ts-http\core"
Start-Service DevPortal-Verdaccio
```

通常は (A) を使い、(C) は他に手段がない場合のみ実施してください。

## 利用側 (アプリケーション) の設定

publish 済みパッケージを別アプリから利用するには、利用側プロジェクトの `.npmrc` に Verdaccio を指定します。

```ini
@k1s0-ts-config:registry=http://localhost:4873/
@k1s0-ts-auth:registry=http://localhost:4873/
@k1s0-ts-logger:registry=http://localhost:4873/
@k1s0-ts-http:registry=http://localhost:4873/
@k1s0-ts-notification:registry=http://localhost:4873/
//localhost:4873/:_authToken=<npm login で取得したトークン>
```

その後 `npm install @k1s0-ts-http/core` のように通常通りインストール可能です。

## 各パッケージの個別ドキュメント

API リファレンスや使用例は各パッケージ配下の README を参照してください。

- [config/core/README.md](library/config/core/README.md)
- [auth/core/README.md](library/auth/core/README.md)
- [logger/core/README.md](library/logger/core/README.md)
- [http/core/README.md](library/http/core/README.md)
- [notification/core/README.md](library/notification/core/README.md)

`react` / `react-native` 版の README もそれぞれのディレクトリ直下にあります。

## Backstage カタログ登録

このディレクトリ配下のパッケージ群は、社内 Backstage (DevPortal の setup ツールでインストール、`http://localhost:7007`) の Software Catalog に登録できる状態にしてあります。登録すると依存関係グラフや所有者一覧が Backstage UI 上で可視化されます。

### 登録される 22 エンティティの構成

| ファイル | 種別 | 名前 | 役割 |
|---|---|---|---|
| `catalog-info.yaml` | Location | `k1s0-ts-framework` | 配下 21 ファイルの一括取り込みエントリポイント |
| `owners.yaml` | Group + Domain | `k1s0-framework-team` / `k1s0-framework` | 所有チームとフレームワーク領域 |
| `<domain>/catalog-info.yaml` | System | `k1s0-ts-<domain>` | 5 ドメイン (auth / config / http / logger / notification) |
| `<domain>/<platform>/catalog-info.yaml` | Component | `k1s0-ts-<domain>-<platform>` | 15 パッケージ (core / react / react-native) |

`react` / `react-native` 版 Component は `spec.dependsOn` で同ドメインの `core` を参照しているため、Backstage UI の「Dependency Graph」タブで `core → react / react-native` の矢印が表示されます。

### 登録手順 (推奨: バッチ一発 + 管理者権限)

`publish-all.bat` と同じ要領で、`register-all.bat` 一発で 21 ファイルを Backstage の `app-config.yaml` に追記し、サービスを自動再起動して取り込みまで完了させます。

```cmd
cd C:\work\github\DevPortal\product\framework\typescript
:: 管理者 PowerShell で実行 (サービス再起動に必要)
register-all.bat
```

これだけで以下が自動実行されます。

1. **前提確認**: 管理者権限、`app-config.yaml` 存在、Python + PyYAML の利用可否
2. **バックアップ**: `app-config.yaml.bak.YYYYMMDD-HHMMSS` にコピー
3. **YAML マージ** (`register-locations.py`): `catalog.locations` に 21 件の `type: file` エントリ追記、`catalog.rules[0].allow` に `Group` / `Domain` 追加 (重複は SKIP)
4. **サービス再起動**: `Restart-Service DevPortal-Backstage`
5. **起動待ち**: `/api/auth/guest/refresh` の 200 を最大 120 秒ポーリング
6. **取り込み確認**: guest トークンで `/api/catalog/entities` を取得し、`k1s0-*` 22 件 (Group 1 / Domain 1 / System 5 / Component 15) が見えるまで最大 90 秒ポーリング

実測値: 初回 約 36 秒、再実行時は added=0 / skipped=21 で idempotent。終了コードは ConfigFile モードでは 0 (成功) のみ、例外発生時 1。

> **管理者権限について**: `app-config.yaml` (`%ProgramData%\DevPortal\backstage\app\`) の上書きと `Restart-Service` に必要です。`Start-Process powershell -Verb RunAs` で UAC 経由実行も可能。

### 別方式: REST API POST モード (GitHub raw URL 用)

リポジトリを GitHub に push 済みで、HTTP URL 経由で別マシン Backstage に登録したい場合は ApiPost モードを使います:

```cmd
register-all.bat -Method ApiPost ^
                 -BackstageUrl http://192.168.0.10:7007 ^
                 -LocationType url ^
                 -UrlBase https://raw.githubusercontent.com/myorg/DevPortal/main/product/framework/typescript
```

ApiPost モードは `POST /api/catalog/locations` 経由で動作し、ローカルファイルパス (file://) は default の Backstage backend が読めないため使えません。**ローカル開発では ConfigFile モード (デフォルト) を使ってください。**

#### オプション

| パラメータ | 既定値 | 適用モード | 説明 |
|---|---|---|---|
| `-Method` | `ConfigFile` | 共通 | `ConfigFile` (app-config.yaml 編集 + 再起動) / `ApiPost` (REST API POST) |
| `-BackstageUrl` | `http://localhost:7007` | 共通 | Backstage の baseUrl |
| `-AppConfig` | `%ProgramData%\DevPortal\backstage\app\app-config.yaml` | ConfigFile | 編集対象の app-config.yaml |
| `-ServiceName` | `DevPortal-Backstage` | ConfigFile | 再起動する Windows サービス名 |
| `-SkipRestart` | (なし) | ConfigFile | サービス再起動をスキップ (手動で `Restart-Service` する場合) |
| `-LocationType` | `file` | ApiPost | `file` (backend filesystem パス) / `url` (HTTP URL) |
| `-UrlBase` | (なし) | ApiPost | `url` モード時の必須 base URL |
| `-OnConflict` | `refresh` | ApiPost | 既存 location の挙動 (`refresh` / `reject`) |
| `-Token` | (なし) | ApiPost | permission 有効時の Bearer トークン (未指定なら guest 自動取得) |
| `-DryRun` | (なし) | ApiPost | 実 POST せず SKIP 表示のみ |
| `-MaxParallel` | `4` | ApiPost | 1 ラウンド内の並列度 (1〜16) |
| `-LogFile` | (なし) | 共通 | タイムスタンプ付きで全イベントを追記出力 |

```cmd
:: ローカルファイル直接 (デフォルト、同一マシンに Backstage がある場合)
register-all.bat -DryRun -MaxParallel 2 -LogFile register.log

:: 別マシンの Backstage に対し、GitHub raw URL 経由で登録
register-all.bat -BackstageUrl http://192.168.0.10:7007 ^
                 -LocationType url ^
                 -UrlBase https://raw.githubusercontent.com/myorg/DevPortal/main/product/framework/typescript ^
                 -Token <bearer>
```

引数は `.bat` から `.ps1` にそのまま転送されます。

#### publish-all との対比

| 項目 | publish-all | register-all |
|---|---|---|
| 対象 | 15 npm パッケージ | 21 catalog-info.yaml |
| 送信先 | Verdaccio (`/-/ping`, npm publish) | Backstage (`/api/catalog/health`, `POST /locations`) |
| 認証 | htpasswd Basic auth (`_auth=Base64`) | optional Bearer (permission 有効時のみ) |
| Round 構造 | Round 1 = core 5 / Round 2 = react・react-native 10 | Round 1 = owners + 5 System / Round 2 = 15 Component |
| 重複検出 | `npm view <name>@<ver>` で SKIP | 既存 locations の target 一致で SKIP / 409 を SKIP 扱い |

### 失敗時のトラブルシュート

| 症状 | 確認ポイント |
|---|---|
| `Backstage に到達できません` | `Get-Service DevPortal-Backstage` で起動状態を確認、停止していたら `Start-Service DevPortal-Backstage` |
| `HTTP 401` / `HTTP 403` | Backstage の permission framework が有効化されている可能性。`-Token <bearer>` で service-to-service トークンを渡す |
| `HTTP 400` でファイルが見つからない | `-LocationType file` の場合、Backstage backend が動いている Windows ホスト上の絶対パスとして解決される。共有マシン以外で動かす場合は GitHub に push して `-LocationType url` に切り替える |
| `HTTP 409` で全件 SKIP | 既に登録済み。`-OnConflict refresh` で強制リフレッシュ (デフォルト)。完全に消したい場合は Backstage UI の「Unregister」を使う |

### 手動登録 (バッチを使わない場合)

1. Backstage 左メニュー「Create」→ 右上「Register Existing Component」を開きます。
2. このリポジトリの `product/framework/typescript/catalog-info.yaml` の URL (GitHub の Web URL または raw URL) を入力し、Analyze → Import を実行します。
3. もしくは `%ProgramData%\DevPortal\backstage\app\app-config.yaml` の `catalog.locations` に以下を追記して `DevPortal-Backstage` サービスを再起動しても取り込めます。

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/<org>/DevPortal/blob/main/product/framework/typescript/catalog-info.yaml
```

### 雛形・公式仕様

- 各種別の最小雛形: [../format/backstage/README.md](../format/backstage/README.md)
- 公式 Descriptor Format: https://backstage.io/docs/features/software-catalog/descriptor-format
- Catalog REST API (Create Location): https://backstage.io/docs/features/software-catalog/api/create-location
