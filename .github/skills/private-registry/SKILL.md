---
name: private-registry
description: >-
  DevPortal の共有パッケージ（packages/kotlin / packages/csharp / packages/typescript）を
  社内配布するプライベートレジストリの使い方。言語ごとの専用OSS（Maven=Reposilite /
  NuGet=BaGetter / npm=Verdaccio）を Windows へ導入・撤去するスクリプト（scripts/private-registry/）の
  実行手順と、Gradle / nuget.config / .npmrc から公開(publish)・取得(consume)するクライアント設定を示す。
  プライベートレジストリの構築・運用・利用、社内パッケージの配信を扱う作業で参照する。
---

# プライベートレジストリの使い方

DevPortal の共有パッケージを社内限定で配布・取得するためのプライベートレジストリ。
**1台の汎用製品に統合せず、言語（フォーマット）ごとに専用の軽量OSSを個別構築**する方針。

| 言語 / フォーマット | 製品 | 既定ポート | 役割 |
| --- | --- | --- | --- |
| Kotlin / Maven | Reposilite | 8080 | hosted（releases/snapshots）。Maven Central プロキシは任意で後追い※ |
| C# / NuGet | BaGetter | 5000 | hosted ＋ nuget.org ミラー（設定済み） |
| TypeScript / npm | Verdaccio | 4873 | hosted ＋ npmjs プロキシ（uplink、設定済み） |

> スクリプト実体は `scripts/private-registry/`。詳細・前提・本番運用の注意は同ディレクトリの `README.md`。
> サービス常駐には NSSM を使い、セットアップ時に自動取得する。名前空間は `com.devportal` / `DevPortal.*` / スコープ `@devportal`。
> 初期は HTTP（平文）で動くが、**本番はリバースプロキシで HTTPS 化必須**。

---

## いつ使うか

- 社内サーバーに Maven / NuGet / npm のプライベートレジストリを**新規構築・撤去**したいとき。
- 共有パッケージを社内レジストリへ**公開(publish)**、または社内レジストリから**取得(consume)**したいとき。
- レジストリの**動作確認**をしたいとき。

---

## 構成（scripts/private-registry/）

```
scripts/private-registry/
├── common/PrivateRegistryCommon.ps1   共通ヘルパー（ログ/DL/HTTP待機/NSSMサービス管理）
├── maven-reposilite/   Setup-Reposilite.ps1 / Uninstall-Reposilite.ps1
├── nuget-bagetter/     Setup-BaGetter.ps1   / Uninstall-BaGetter.ps1
├── npm-verdaccio/      Setup-Verdaccio.ps1  / Uninstall-Verdaccio.ps1
├── Test-PrivateRegistries.ps1   動作確認（hosted往復＋プロキシ取得＋サービスLC）
└── README.md
```

前提ランタイム（各 Setup が検出・案内する）:

- **Reposilite** … Java 17 以上（`JAVA_HOME` や一般的な JDK 配置を自動検出。`-JavaExe` で明示も可）
- **BaGetter** … .NET（ASP.NET Core）8 以降のランタイム（新しいメジャーは `DOTNET_ROLL_FORWARD=LatestMajor` で起動）
- **Verdaccio** … Node.js 18 以上（本体はインストール先配下にローカル導入しグローバルを汚さない）

セットアップ（サービス登録）は**管理者 PowerShell**が必要。初回はインターネット接続が必要。
実行が拒否される場合: `powershell -ExecutionPolicy Bypass -File .\maven-reposilite\Setup-Reposilite.ps1`

---

## 手順

### 1. セットアップ（Windows サービス常駐）

管理者 PowerShell で、必要な製品のスクリプトを実行する。完了時に**認証情報（トークン / API キー）と
クライアント設定例**が表示される。

```powershell
.\maven-reposilite\Setup-Reposilite.ps1   # Maven（Kotlin）
.\nuget-bagetter\Setup-BaGetter.ps1        # NuGet（C#）
.\npm-verdaccio\Setup-Verdaccio.ps1        # npm（TypeScript）
```

主なオプション:

- 共通: `-InstallRoot <path>` / `-Port <n>` / `-ServiceName <name>` / `-NoService`（サービス化せず手動起動用 `start.cmd` のみ生成＝検証・お試し用）
- 製品固有: Reposilite `-Version` `-AdminToken name:secret` `-JavaExe` / BaGetter `-Version` `-ApiKey` / Verdaccio `-Version` `-Scope`（既定 `@devportal`）`-DisableSignup`

### 2. アンインストール

```powershell
.\maven-reposilite\Uninstall-Reposilite.ps1 -Force      # サービス・ファイルを完全削除
.\nuget-bagetter\Uninstall-BaGetter.ps1 -KeepData       # データを残し本体とサービスのみ削除
.\npm-verdaccio\Uninstall-Verdaccio.ps1                 # 確認プロンプトあり
```

### 3. 動作確認

```powershell
.\Test-PrivateRegistries.ps1                  # hosted publish→consume ＋ 外部プロキシ取得
.\Test-PrivateRegistries.ps1 -Only npm        # 個別（maven / nuget / npm / none）
.\Test-PrivateRegistries.ps1 -IncludeService  # NSSMサービス登録→自動起動→削除も検証（要管理者）
```

一時ディレクトリへ導入して検証し、終了時にプロセス停止・削除まで自動で行う（`-IncludeService` 以外は管理者不要）。

### 4. クライアント設定 — Kotlin / Gradle（Reposilite）

```kotlin
// settings.gradle.kts などに追記（取得・公開とも）
maven {
    url = uri("http://<HOST>:8080/releases")   // snapshots は /snapshots
    isAllowInsecureProtocol = true              // HTTP の間のみ。HTTPS化後に削除
    credentials { username = "<tokenName>"; password = "<tokenSecret>" }
}
```

```powershell
# 公開（対象モジュールに maven-publish を適用したうえで）
.\gradlew :packages:kotlin:config:core:publish
```

> 認証情報はコミットせず `%USERPROFILE%\.gradle\gradle.properties` などユーザー単位で持つ。

### 5. クライアント設定 — C# / NuGet（BaGetter）

```xml
<!-- nuget.config（HTTP の間は allowInsecureConnections="true" が必須） -->
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

### 6. クライアント設定 — TypeScript / npm（Verdaccio）

```ini
# .npmrc
@devportal:registry=http://<HOST>:4873/
registry=http://<HOST>:4873/   # 全体を向ける場合（npmjs はプロキシ）
```

```powershell
npm adduser --registry http://<HOST>:4873/   # ユーザー登録（htpasswd 認証）
npm publish --registry http://<HOST>:4873/   # 公開（@devportal スコープ推奨）
```

---

## お約束・つまずきどころ

- **NuGet は HTTP ソースへの push/restore を既定でブロック**する。HTTP の間は nuget.config に `allowInsecureConnections="true"` が必須。HTTPS 化後は外す。
- **Reposilite は Java 17+ 必須**。PATH の `java` が 8 でも `JAVA_HOME` 等から自動検出する。
- **Reposilite の Maven Central プロキシは「共有設定」で DB 管理**＝ダッシュボード（Configuration → Repositories で対象リポジトリの `proxied` に `https://repo.maven.apache.org/maven2`）で後追い設定する。スクリプトは hosted（releases/snapshots）まで構成する。
- **BaGetter は同梱 `appsettings.json` を残し、上書き分だけ `appsettings.Production.json` に重ねる**。丸ごと置換すると `HealthCheck`/`Statistics` 欠落で起動時 NullReferenceException になる。.NET 8 ターゲットを新しいランタイムで動かすため `DOTNET_ROLL_FORWARD=LatestMajor`。
- **認証**: Reposilite=管理トークン（起動時 `--token` は再起動毎に再生成される一時トークン。本番はダッシュボードで永続トークンを作り `--token` を外す）/ BaGetter=API キー / Verdaccio=htpasswd（`npm adduser`、`-DisableSignup` で自己登録禁止）。
- **本番は HTTPS 必須**（HTTP だと認証情報が平文で流れる）。リバースプロキシ（IIS ARR / nginx 等）で TLS 終端し、HTTPS 化後は Gradle の `isAllowInsecureProtocol` / NuGet の `allowInsecureConnections` を外す。
- **バックアップ対象**は各 `InstallRoot\data`（パッケージ実体・DB・設定）。
- スクリプト(.ps1)は **PowerShell 5.1 対策で UTF-8 BOM 保存**（日本語コメント入り BOM 無しは PS5.1 で文字化け・パースエラーになる。編集後は BOM 再正規化＋構文チェック）。

## 参照

- 使い方・前提・本番運用の注意: `scripts/private-registry/README.md`
- スクリプト実体: `scripts/private-registry/`（`Setup-*.ps1` / `Uninstall-*.ps1` / `Test-PrivateRegistries.ps1` / `common/PrivateRegistryCommon.ps1`）
