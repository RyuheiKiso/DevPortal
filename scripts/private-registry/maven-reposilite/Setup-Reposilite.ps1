<#
.SYNOPSIS
    Maven プライベートレジストリ（Reposilite）を Windows にセットアップする。

.DESCRIPTION
    DevPortal の Kotlin/Gradle 共有パッケージ（packages/kotlin）を社内配布するための
    Maven リポジトリ Reposilite をインストールし、Windows サービスとして常駐させる。
    Reposilite は Java 17 以上で動作する単一 JAR の軽量 Maven リポジトリ。
    既定ではリリース用(releases)・スナップショット用(snapshots)の hosted リポジトリを提供する。

.PARAMETER InstallRoot
    インストール先ディレクトリ。既定は C:\devportal-registry\reposilite。

.PARAMETER Port
    待ち受け HTTP ポート。既定は 8080。

.PARAMETER Version
    導入する Reposilite のバージョン。'latest' なら公式 Maven メタデータから最新安定版を解決する。

.PARAMETER AdminToken
    初期管理トークン（name:secret 形式）。未指定ならランダム生成して表示する。

.PARAMETER ServiceName
    登録する Windows サービス名。既定は DevPortal-Reposilite。

.PARAMETER JavaExe
    使用する java.exe のパス。未指定なら Java 17 以上を自動検出する。

.PARAMETER NoService
    指定するとサービス登録せず、手動起動用の start.cmd のみ用意する（検証・お試し用）。

.EXAMPLE
    # 管理者 PowerShell で標準セットアップ（サービス常駐）
    .\Setup-Reposilite.ps1

.EXAMPLE
    # ポートを変えてサービス化せず準備のみ
    .\Setup-Reposilite.ps1 -Port 8090 -NoService
#>
[CmdletBinding()]
param(
    # インストール先ディレクトリ
    [string]$InstallRoot = 'C:\devportal-registry\reposilite',
    # 待ち受けポート
    [int]$Port = 8080,
    # 導入バージョン（latest で最新安定版を解決）
    [string]$Version = 'latest',
    # 初期管理トークン（name:secret）
    [string]$AdminToken = '',
    # Windows サービス名
    [string]$ServiceName = 'DevPortal-Reposilite',
    # java.exe のパス（未指定なら自動検出）
    [string]$JavaExe = '',
    # NSSM などツールの配置先
    [string]$ToolsDir = 'C:\devportal-registry\tools',
    # サービス登録を行わない（検証用）
    [switch]$NoService
)

# エラーは即座に停止させる
$ErrorActionPreference = 'Stop'
# 共通ヘルパーを読み込む
. "$PSScriptRoot\..\common\PrivateRegistryCommon.ps1"

# ----------------------------------------------------------------------------
# Java 検出ヘルパー（Reposilite は Java 17 以上が必須）
# ----------------------------------------------------------------------------

# 指定した java.exe のメジャーバージョン番号を取得する
function Get-JavaMajorVersion {
    # 対象の java 実行ファイルパス
    param([Parameter(Mandatory)][string]$JavaPath)
    try {
        # java -version は標準エラーへ出力し、かつ EAP=Stop 下では PowerShell の
        # ネイティブエラー処理で終了エラー扱いになる。これを避けるため、Process で
        # 直接 stdout / stderr を取り込む（最も確実な方法）。
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        # 実行する java 本体
        $psi.FileName = $JavaPath
        # バージョン表示オプション
        $psi.Arguments = '-version'
        # 標準出力・標準エラーをともにリダイレクトして取り込む
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        # シェルを介さずに起動する（リダイレクトに必須）
        $psi.UseShellExecute = $false
        # ウィンドウを出さない
        $psi.CreateNoWindow = $true
        # プロセスを起動する
        $proc = [System.Diagnostics.Process]::Start($psi)
        # 両ストリームを読み取って結合する（新旧 JDK で出力先が異なるため両方見る）
        $output = $proc.StandardOutput.ReadToEnd() + $proc.StandardError.ReadToEnd()
        # プロセス終了を待つ
        $proc.WaitForExit()
    }
    catch {
        # 実行できなければバージョン 0（不正）を返す
        return 0
    }
    # バージョン文字列（例: version "21.0.8" / "1.8.0_481"）を抽出する
    if ($output -match 'version\s+"(\d+)(?:\.(\d+))?') {
        # 先頭の数字を取り出す
        $first = [int]$Matches[1]
        # "1.8" 形式（旧表記）なら 2 番目の数字が実メジャー（8）
        if ($first -eq 1 -and $Matches[2]) { return [int]$Matches[2] }
        # それ以外（9 以降の新表記）は先頭がメジャー
        return $first
    }
    # 解析できなければ 0 を返す
    return 0
}

# Java 17 以上の java.exe を自動検出する
function Find-Java17 {
    # 検出候補のパス一覧を組み立てる
    $candidates = New-Object System.Collections.Generic.List[string]
    # 環境変数 JAVA_HOME 配下を最優先候補にする
    if ($env:JAVA_HOME) { $candidates.Add((Join-Path $env:JAVA_HOME 'bin\java.exe')) }
    # PATH 上の java を候補に加える
    $onPath = Get-Command java -ErrorAction SilentlyContinue
    if ($onPath) { $candidates.Add($onPath.Source) }
    # 代表的な JDK インストール先をワイルドカードで探索して候補に加える
    $globs = @(
        'C:\Program Files\Eclipse Adoptium\*\bin\java.exe',
        'C:\Program Files\Microsoft\jdk*\bin\java.exe',
        'C:\Program Files\Java\jdk*\bin\java.exe',
        'C:\Program Files\Zulu\*\bin\java.exe',
        'C:\Program Files\Amazon Corretto\*\bin\java.exe',
        'C:\Program Files\Android\Android Studio\jbr\bin\java.exe'
    )
    # 各 glob を展開して候補へ追加する
    foreach ($g in $globs) {
        Get-ChildItem -Path $g -ErrorAction SilentlyContinue | ForEach-Object { $candidates.Add($_.FullName) }
    }
    # 候補を順に検査し、最初に見つかった Java 17 以上を返す
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) {
            # メジャーバージョンを判定する
            $major = Get-JavaMajorVersion -JavaPath $c
            # 17 以上なら採用する
            if ($major -ge 17) {
                Write-Info "Java $major を使用します: $c"
                return $c
            }
        }
    }
    # 見つからなければ $null を返す
    return $null
}

# ----------------------------------------------------------------------------
# メイン処理
# ----------------------------------------------------------------------------

Write-Section "Reposilite (Maven) セットアップ開始"

# サービス登録する場合は管理者権限を要求する
if (-not $NoService) { Assert-Admin -Purpose 'Reposilite のサービス登録' }

# 1) Java 17+ を解決する -------------------------------------------------------
Write-Section "1/5 Java(17+) の確認"
# 明示指定があればそれを使い、無ければ自動検出する
if ($JavaExe) {
    # 指定された java のバージョンを確認する
    $major = Get-JavaMajorVersion -JavaPath $JavaExe
    # 17 未満なら中断する
    if ($major -lt 17) { throw "指定された Java はバージョン $major です。Reposilite には Java 17 以上が必要です。" }
}
else {
    # 自動検出を実行する
    $JavaExe = Find-Java17
    # 見つからなければ導入を促して中断する
    if (-not $JavaExe) {
        throw "Java 17 以上が見つかりません。Temurin(JDK 17+) などを導入するか、-JavaExe で明示してください。"
    }
}
Write-Ok "Java を確認しました: $JavaExe"

# 2) バージョンを解決する ------------------------------------------------------
Write-Section "2/5 バージョンの解決"
# 'latest' の場合は公式 Maven メタデータから最新安定版を取得する
if ($Version -eq 'latest') {
    # メタデータ URL
    $metaUri = 'https://maven.reposilite.com/releases/com/reposilite/reposilite/maven-metadata.xml'
    try {
        # メタデータ XML を取得して解析する
        [xml]$meta = (Invoke-WebRequest -Uri $metaUri -UseBasicParsing -TimeoutSec 20).Content
        # リリース版（安定版）を採用する
        $Version = $meta.metadata.versioning.release
    }
    catch {
        # 取得に失敗したら明示指定を促す
        throw "最新バージョンの解決に失敗しました。-Version で明示してください（例: -Version 3.5.21）。`n$($_.Exception.Message)"
    }
}
Write-Ok "導入バージョン: $Version"

# 3) JAR をダウンロードする ----------------------------------------------------
Write-Section "3/5 Reposilite JAR の取得"
# インストール先ディレクトリを作成する
if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
# データ（設定・リポジトリ実体・DB）格納ディレクトリ
$dataDir = Join-Path $InstallRoot 'data'
# データディレクトリを作成する
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
# JAR の保存先パス
$jarPath = Join-Path $InstallRoot 'reposilite.jar'
# ダウンロード元 URL（fat jar = -all.jar）
$jarUri = "https://maven.reposilite.com/releases/com/reposilite/reposilite/$Version/reposilite-$Version-all.jar"
# 既に同じ JAR があるかは問わず、確実性のため毎回取得する
Invoke-FileDownload -Uri $jarUri -OutFile $jarPath
Write-Ok "JAR を配置しました: $jarPath"

# 4) 管理トークンを決定する ----------------------------------------------------
Write-Section "4/5 管理トークンの準備"
# 未指定ならランダムなシークレットで admin トークンを生成する
if (-not $AdminToken) {
    # GUID から記号を除いた 16 文字をシークレットとして使う
    $secret = ([guid]::NewGuid().ToString('N')).Substring(0, 16)
    # name:secret 形式に整形する
    $AdminToken = "admin:$secret"
    Write-Info "管理トークンを自動生成しました"
}
# トークン名とシークレットを分解する（表示・検証用）
$tokenName, $tokenSecret = $AdminToken.Split(':', 2)
Write-Ok "管理トークン名: $tokenName"

# 5) 起動コマンドの組み立てとサービス化 ----------------------------------------
Write-Section "5/5 起動設定"
# Reposilite に渡す引数を組み立てる（作業ディレクトリ・ポート・初期トークン）
$appArgs = "-jar `"$jarPath`" --working-directory `"$dataDir`" --port $Port --token $AdminToken"
# 手動起動用 start.cmd を書き出す（検証や手動運用に使う）
$startCmd = Join-Path $InstallRoot 'start.cmd'
# バッチ内容を組み立てる
$startCmdBody = "@echo off`r`n`"$JavaExe`" $appArgs`r`n"
# start.cmd を UTF-8(BOM 無し) で書き出す
[System.IO.File]::WriteAllText($startCmd, $startCmdBody, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "手動起動スクリプトを生成しました: $startCmd"

# ログ出力先ディレクトリ
$logDir = Join-Path $InstallRoot 'logs'

# サービス化する場合
if (-not $NoService) {
    # NSSM を用意する
    $nssm = Resolve-NssmExe -ToolsDir $ToolsDir
    # NSSM で Windows サービスを作成・起動する
    New-RegistryService -NssmExe $nssm -ServiceName $ServiceName `
        -Application $JavaExe -Arguments $appArgs `
        -WorkingDirectory $dataDir -LogDir $logDir `
        -Description "DevPortal Maven private registry (Reposilite) on port $Port"
    # 起動完了（HTTP 応答）を待つ
    Write-Info "サービスの起動を待機します..."
    # ルートにアクセスして応答を確認する（認証エラーでも到達確認できれば良い）
    if (Wait-ForHttp -Uri "http://localhost:$Port/" -TimeoutSec 90 -AcceptAuthError) {
        Write-Ok "Reposilite が起動しました: http://localhost:$Port/"
    }
    else {
        Write-Warn "起動確認がタイムアウトしました。ログを確認してください: $logDir"
    }
}
else {
    # サービス化しない場合は手動起動方法を案内する
    Write-Info "サービス化はスキップしました。手動起動: `"$startCmd`" を実行してください。"
}

# 完了サマリと利用方法を表示する -----------------------------------------------
Write-Section "セットアップ完了（Reposilite / Maven）"
Write-Host ""
Write-Host "  エンドポイント : http://localhost:$Port/" -ForegroundColor White
Write-Host "  ダッシュボード : http://localhost:$Port/#/dashboard" -ForegroundColor White
Write-Host "  リリース取得/公開 : http://localhost:$Port/releases" -ForegroundColor White
Write-Host "  スナップショット  : http://localhost:$Port/snapshots" -ForegroundColor White
Write-Host "  管理トークン   : 名前=$tokenName  シークレット=$tokenSecret" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Gradle 側の設定例（settings.gradle.kts / build.gradle.kts）:" -ForegroundColor White
Write-Host "    maven {" -ForegroundColor DarkGray
Write-Host "      url = uri(`"http://localhost:$Port/releases`")" -ForegroundColor DarkGray
Write-Host "      isAllowInsecureProtocol = true   // HTTP の間のみ" -ForegroundColor DarkGray
Write-Host "      credentials { username = `"$tokenName`"; password = `"<secret>`" }" -ForegroundColor DarkGray
Write-Host "    }" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ※ 既定では hosted（releases / snapshots）のみ。Maven Central をプロキシして" -ForegroundColor White
Write-Host "     1 URL で外部依存も取得したい場合は、ダッシュボードにログインし" -ForegroundColor White
Write-Host "     Configuration → Repositories で対象リポジトリの proxied に" -ForegroundColor White
Write-Host "     https://repo.maven.apache.org/maven2 を追加する（共有設定=DB 管理のため後追い設定）。" -ForegroundColor White
Write-Host ""
Write-Warn "本番では必ずリバースプロキシで HTTPS 化し、ダッシュボードで永続トークンを作成後 --token を外してください。"
