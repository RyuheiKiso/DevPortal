# プライベートレジストリ セットアップスクリプト

DevPortal の共有パッケージ（`packages/kotlin` / `packages/csharp` / `packages/typescript`）を
社内限定で配布・取得するためのプライベートレジストリを、Windows へセットアップ／アンインストール
する PowerShell スクリプト群。

レジストリは「1 台の汎用製品に統合せず、言語（フォーマット）ごとに専用の軽量 OSS を個別構築」する方針。

| 言語 / フォーマット | 製品 | 既定ポート | 役割 |
| --- | --- | --- | --- |
| Kotlin / Maven | [Reposilite](https://reposilite.com/) | 8080 | hosted（releases/snapshots）。Maven Central プロキシは任意で後追い設定※ |
| C# / NuGet | [BaGetter](https://www.bagetter.com/) | 5000 | hosted ＋ nuget.org ミラー（設定済み） |
| TypeScript / npm | [Verdaccio](https://verdaccio.org/) | 4873 | hosted ＋ npmjs プロキシ（uplink、設定済み） |

> ※ Reposilite のリポジトリ・プロキシ設定は「共有設定」として DB に保存され、ダッシュボード/REST API で編集する仕様。
> そのためスクリプトは hosted（releases/snapshots）までを構成し、Maven Central のプロキシ追加は任意の後追い手順とする（下記）。

いずれも無料 OSS。3 製品は同一サーバーに同居（ポート違い）でも別サーバーでも構わない。
Windows サービス常駐には [NSSM](https://nssm.cc/) を使い、セットアップ時に自動取得する。

## ディレクトリ構成

```
scripts/private-registry/
├── common/
│   └── PrivateRegistryCommon.ps1   共通ヘルパー（ログ/DL/NSSM/HTTP待機 など）
├── maven-reposilite/
│   ├── Setup-Reposilite.ps1        Maven レジストリ導入
│   └── Uninstall-Reposilite.ps1    Maven レジストリ削除
├── nuget-bagetter/
│   ├── Setup-BaGetter.ps1          NuGet レジストリ導入
│   └── Uninstall-BaGetter.ps1      NuGet レジストリ削除
├── npm-verdaccio/
│   ├── Setup-Verdaccio.ps1         npm レジストリ導入
│   └── Uninstall-Verdaccio.ps1     npm レジストリ削除
├── Test-PrivateRegistries.ps1      動作確認（隔離環境で publish/consume 往復）
└── README.md
```

> スクリプトは `common/` を相対参照する。サーバーへ持ち込む際は本フォルダ構成のまま配置すること。

## 前提

| 製品 | 必要なランタイム | 備考 |
| --- | --- | --- |
| Reposilite | **Java 17 以上** | `JAVA_HOME` か一般的な JDK 配置を自動検出。`-JavaExe` で明示も可 |
| BaGetter | **.NET（ASP.NET Core）8 以降のランタイム** | 新しいメジャーでも `DOTNET_ROLL_FORWARD=LatestMajor` で起動 |
| Verdaccio | **Node.js 18 以上**（npm 同梱） | 本体はインストール先配下にローカル導入（グローバルを汚さない） |

- セットアップ（サービス登録）は**管理者権限**の PowerShell が必要。
- 初回はインターネット接続が必要（各製品・NSSM をダウンロードするため）。
- スクリプトの実行が拒否される場合は実行ポリシーを緩和する:
  `powershell -ExecutionPolicy Bypass -File .\maven-reposilite\Setup-Reposilite.ps1`

## 使い方

### セットアップ（サービス常駐）

管理者 PowerShell で、必要な製品のスクリプトを実行する。

```powershell
# Maven（Kotlin）
.\maven-reposilite\Setup-Reposilite.ps1

# NuGet（C#）
.\nuget-bagetter\Setup-BaGetter.ps1

# npm（TypeScript）
.\npm-verdaccio\Setup-Verdaccio.ps1
```

主なオプション（各スクリプト共通の考え方）:

| オプション | 説明 |
| --- | --- |
| `-InstallRoot <path>` | インストール先（既定 `C:\devportal-registry\<製品>`） |
| `-Port <n>` | 待ち受けポート |
| `-ServiceName <name>` | Windows サービス名 |
| `-NoService` | サービス登録せず手動起動用 `start.cmd` のみ生成（検証・お試し用） |

製品固有オプション:

- `Setup-Reposilite.ps1` : `-Version`（既定 latest）/ `-AdminToken name:secret` / `-JavaExe`
- `Setup-BaGetter.ps1` : `-Version`（既定 latest）/ `-ApiKey`
- `Setup-Verdaccio.ps1` : `-Version`（既定 latest）/ `-Scope`（既定 `@devportal`）/ `-DisableSignup`

セットアップ完了時に、各クライアント（Gradle / nuget.config / .npmrc）の設定例と
認証情報（トークン / API キー）が表示される。

### アンインストール

```powershell
# 完全削除（確認あり）
.\maven-reposilite\Uninstall-Reposilite.ps1

# データを残して本体とサービスのみ削除
.\nuget-bagetter\Uninstall-BaGetter.ps1 -KeepData

# 確認なしで削除
.\npm-verdaccio\Uninstall-Verdaccio.ps1 -Force
```

### 動作確認

3 製品を**一時ディレクトリ**へ `-NoService` で導入し、フォアグラウンド起動して以下を検証する。
終了時にプロセス停止と一時ディレクトリ削除まで自動で行うため、ユーザー環境を汚さない（管理者権限は不要）。

- **hosted**: publish→consume の往復（Reposilite=PUT/GET、BaGetter=`dotnet nuget push`、Verdaccio=`npm publish`）
- **プロキシ/ミラー**: BaGetter は nuget.org から Newtonsoft.Json、Verdaccio は npmjs から is-number を取得できること

```powershell
# すべて検証（hosted ＋ プロキシ）
.\Test-PrivateRegistries.ps1

# 個別に検証（maven / nuget / npm）
.\Test-PrivateRegistries.ps1 -Only npm

# NSSM による Windows サービス登録/削除のライフサイクルも検証する（要管理者）
#   Verdaccio をサービス登録→自動起動確認→アンインストール→残存しないことまで確認する
.\Test-PrivateRegistries.ps1 -IncludeService
```

> `-IncludeService` は管理者 PowerShell が必要。非管理者で実行した場合はその項目を [SKIP] 表示して続行する。

## クライアント設定の要点

### Kotlin / Gradle（Reposilite）

```kotlin
// settings.gradle.kts などに追記
maven {
    url = uri("http://<HOST>:8080/releases")   // 取得・公開（snapshots は /snapshots）
    isAllowInsecureProtocol = true              // HTTP の間のみ。HTTPS 化後に削除
    credentials { username = "<tokenName>"; password = "<tokenSecret>" }
}
```

> **Maven Central プロキシ（任意）**: 既定では hosted のみ。外部依存も同じ URL で取得したい場合は、
> ダッシュボード（`http://<HOST>:8080/#/dashboard`）に管理トークンでログインし、
> Configuration → Repositories で対象リポジトリの `proxied` に
> `https://repo.maven.apache.org/maven2` を追加する（共有設定は DB 管理のため後追い設定になる）。

### C# / NuGet（BaGetter）

```xml
<!-- nuget.config -->
<!-- HTTP の間は allowInsecureConnections="true" が必須（近年の NuGet は HTTP ソースを既定でブロック） -->
<configuration>
  <packageSources>
    <add key="devportal" value="http://<HOST>:5000/v3/index.json" allowInsecureConnections="true" />
  </packageSources>
</configuration>
```
```powershell
# named source 経由で公開（HTTP 許可は上記 nuget.config が担う）
dotnet nuget push *.nupkg --source devportal --api-key <ApiKey>
```

> HTTPS 化後は `allowInsecureConnections` 属性を外す。

### TypeScript / npm（Verdaccio）

```ini
# .npmrc
@devportal:registry=http://<HOST>:4873/
registry=http://<HOST>:4873/   # 全体を向ける場合（npmjs はプロキシ）
```
```powershell
npm adduser --registry http://<HOST>:4873/   # ユーザー登録
npm publish --registry http://<HOST>:4873/   # 公開
```

## 本番運用の注意

- **HTTPS 化必須**: 初期は HTTP（平文）で動くが、認証情報が平文で流れるため、本番では
  リバースプロキシ（IIS ARR / nginx 等）で TLS を終端する。HTTPS 化後はクライアント設定から
  `isAllowInsecureProtocol`（Gradle）を外す。
- **認証情報の管理**: トークン / API キーはコミットせず、シークレットストアや
  ユーザー単位の設定ファイル（`%USERPROFILE%\.gradle\gradle.properties` など）で扱う。
- **Reposilite の管理トークン**: セットアップ時の `--token` は起動毎に再生成される一時トークン。
  本番ではダッシュボードで永続トークンを作成し、サービス引数から `--token` を外す。
- **バックアップ**: 各 `InstallRoot\data`（パッケージ実体・DB・設定）をバックアップ対象にする。
