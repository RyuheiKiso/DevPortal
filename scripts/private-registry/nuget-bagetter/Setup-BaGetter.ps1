<#
.SYNOPSIS
    NuGet プライベートレジストリ（BaGetter）を Windows にセットアップする。

.DESCRIPTION
    DevPortal の C#/.NET 共有パッケージ（packages/csharp）を社内配布するための
    NuGet サーバー BaGetter をインストールし、Windows サービスとして常駐させる。
    BaGetter は .NET 製の軽量 NuGet サーバーで、自社 hosted と nuget.org のミラー
    （upstream プロキシ）を兼ねる。アーティファクトは FileSystem、メタデータは SQLite に保存する。

.PARAMETER InstallRoot
    インストール先ディレクトリ。既定は C:\devportal-registry\bagetter。

.PARAMETER Port
    待ち受け HTTP ポート。既定は 5000。

.PARAMETER ApiKey
    パッケージ公開(push)に必要な API キー。未指定ならランダム生成して表示する。

.PARAMETER ServiceName
    登録する Windows サービス名。既定は DevPortal-BaGetter。

.PARAMETER Version
    導入する BaGetter のリリースタグ。'latest' なら GitHub の最新リリースを使用する。

.PARAMETER NoService
    指定するとサービス登録せず、手動起動用の start.cmd のみ用意する（検証・お試し用）。

.EXAMPLE
    .\Setup-BaGetter.ps1
#>
[CmdletBinding()]
param(
    # インストール先ディレクトリ
    [string]$InstallRoot = 'C:\devportal-registry\bagetter',
    # 待ち受けポート
    [int]$Port = 5000,
    # 公開用 API キー
    [string]$ApiKey = '',
    # Windows サービス名
    [string]$ServiceName = 'DevPortal-BaGetter',
    # 導入バージョン（latest で最新リリース）
    [string]$Version = 'latest',
    # NSSM などツールの配置先
    [string]$ToolsDir = 'C:\devportal-registry\tools',
    # サービス登録を行わない（検証用）
    [switch]$NoService
)

# エラーは即座に停止させる
$ErrorActionPreference = 'Stop'
# 共通ヘルパーを読み込む
. "$PSScriptRoot\..\common\PrivateRegistryCommon.ps1"

Write-Section "BaGetter (NuGet) セットアップ開始"

# サービス登録する場合は管理者権限を要求する
if (-not $NoService) { Assert-Admin -Purpose 'BaGetter のサービス登録' }

# 1) .NET ランタイムの確認 -----------------------------------------------------
Write-Section "1/5 .NET ランタイムの確認"
# dotnet コマンドの存在を確認する
if (-not (Test-CommandExists -Name 'dotnet')) {
    throw ".NET ランタイムが見つかりません。.NET 8 以降の ASP.NET Core ランタイムを導入してください。"
}
# dotnet 実行ファイルのフルパスを取得する（サービス登録に使う）
$dotnetExe = (Get-Command dotnet).Source
# インストール済みランタイム一覧を取得する
$runtimes = & dotnet --list-runtimes 2>$null
# ASP.NET Core ランタイムの有無を確認する（BaGetter は ASP.NET Core 上で動作）
if (-not ($runtimes | Select-String -SimpleMatch 'Microsoft.AspNetCore.App')) {
    Write-Warn "ASP.NET Core ランタイムが検出できませんでした。起動に失敗する場合は ASP.NET Core Runtime を導入してください。"
}
else {
    Write-Ok ".NET / ASP.NET Core ランタイムを確認しました"
}

# 2) リリース資産の解決とダウンロード ------------------------------------------
Write-Section "2/5 BaGetter リリースの取得"
# GitHub リリース API の URL を決める（latest かタグ指定か）
if ($Version -eq 'latest') {
    # 最新リリースのメタデータ URL
    $releaseApi = 'https://api.github.com/repos/bagetter/bagetter/releases/latest'
}
else {
    # 指定タグのメタデータ URL
    $releaseApi = "https://api.github.com/repos/bagetter/bagetter/releases/tags/$Version"
}
try {
    # GitHub API はクライアント識別のため User-Agent が必須
    $release = Invoke-RestMethod -Uri $releaseApi -Headers @{ 'User-Agent' = 'DevPortal-Setup' } -TimeoutSec 30
}
catch {
    # 取得失敗時は分かりやすく中断する
    throw "BaGetter リリース情報の取得に失敗しました。`n$($_.Exception.Message)"
}
# 実タグ名を控える（表示用）
$resolvedTag = $release.tag_name
# 配布 zip 資産を選ぶ（ソースアーカイブやシンボルを除外）
$asset = $release.assets | Where-Object {
    $_.name -like '*.zip' -and $_.name -notlike '*ymbol*' -and $_.name -notlike '*ource*'
} | Select-Object -First 1
# 適切な zip が無ければ中断する
if (-not $asset) {
    throw "BaGetter リリース($resolvedTag)に配布 zip が見つかりませんでした。"
}
# インストール先ディレクトリを作成する
if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
# zip の保存先パス
$zipPath = Join-Path $InstallRoot $asset.name
# zip をダウンロードする
Invoke-FileDownload -Uri $asset.browser_download_url -OutFile $zipPath
Write-Ok "リリース $resolvedTag を取得しました: $($asset.name)"

# 3) 展開とエントリ DLL の特定 -------------------------------------------------
Write-Section "3/5 展開"
# アプリ本体の展開先ディレクトリ
$appDir = Join-Path $InstallRoot 'app'
# 再インストール時に備えて既存 app を消してから展開する
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
# zip を展開する
Expand-Archive -Path $zipPath -DestinationPath $appDir -Force
# 展開後は zip を削除する
Remove-Item $zipPath -Force
# エントリポイントの BaGetter.dll を探す（zip 構造の差異に対応）
$entryDll = Get-ChildItem -Path $appDir -Recurse -Filter 'BaGetter.dll' | Select-Object -First 1
# 見つからなければ中断する
if (-not $entryDll) {
    throw "展開結果に BaGetter.dll が見つかりませんでした: $appDir"
}
# 実際の実行ディレクトリ（DLL のある場所）
$runDir = $entryDll.Directory.FullName
# エントリ DLL のフルパス
$dllPath = $entryDll.FullName
Write-Ok "エントリ DLL: $dllPath"

# 4) 設定（appsettings.json）と API キーの準備 --------------------------------
Write-Section "4/5 設定ファイルの生成"
# データ（パッケージ実体・SQLite DB）格納ディレクトリ
$dataDir = Join-Path $InstallRoot 'data'
# パッケージ格納ディレクトリ
$packagesDir = Join-Path $dataDir 'packages'
# データ・パッケージ用ディレクトリを作成する
if (-not (Test-Path $packagesDir)) { New-Item -ItemType Directory -Path $packagesDir -Force | Out-Null }
# API キー未指定ならランダム生成する
if (-not $ApiKey) {
    # GUID（ハイフン無し）を API キーにする
    $ApiKey = [guid]::NewGuid().ToString('N')
    Write-Info "API キーを自動生成しました"
}
# SQLite の接続文字列（DB ファイルパス）
$dbPath = Join-Path $dataDir 'bagetter.db'
# 同梱の appsettings.json は変更せず、上書き分だけを appsettings.Production.json に重ねる。
# （同梱 appsettings.json には HealthCheck / Statistics など Startup が参照するキーが含まれ、
#   まるごと置き換えると起動時に NullReferenceException になるため、差分のみを上書きする）
$settings = [ordered]@{
    # 公開(push)に必要な API キー
    ApiKey   = $ApiKey
    # アーティファクトの保存先（Type=FileSystem は同梱設定のまま継承）
    Storage  = [ordered]@{
        Path = $packagesDir
    }
    # メタデータ DB の保存先（Type=Sqlite は同梱設定のまま継承）
    Database = [ordered]@{
        ConnectionString = "Data Source=$dbPath"
    }
    # nuget.org のミラー（upstream プロキシ）を有効化する
    Mirror   = [ordered]@{
        Enabled       = $true
        PackageSource = 'https://api.nuget.org/v3/index.json'
    }
}
# 出力先は環境別設定ファイル（ASPNETCORE_ENVIRONMENT=Production で同梱設定の上に読み込まれる）
$settingsPath = Join-Path $runDir 'appsettings.Production.json'
# JSON へ変換して UTF-8(BOM 無し) で書き出す
$json = $settings | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "上書き設定を書き出しました: $settingsPath"

# 5) 起動コマンドの組み立てとサービス化 ----------------------------------------
Write-Section "5/5 起動設定"
# dotnet に渡す引数（エントリ DLL と待ち受け URL）
$appArgs = "`"$dllPath`" --urls http://0.0.0.0:$Port"
# サービス/起動時に渡す環境変数
#  - DOTNET_ROLL_FORWARD: 対象 TFM より新しい .NET ランタイムでも動かす
#  - ASPNETCORE_ENVIRONMENT: 本番設定で起動する
$envVars = @{
    DOTNET_ROLL_FORWARD     = 'LatestMajor'
    ASPNETCORE_ENVIRONMENT  = 'Production'
}
# 手動起動用 start.cmd を生成する
$startCmd = Join-Path $InstallRoot 'start.cmd'
# バッチ内容（アプリディレクトリへ移動 → 環境変数設定 → 起動）
# ※ ASP.NET Core は既定でカレントディレクトリを基準に appsettings.json を読むため、
#    必ず DLL と設定ファイルのあるディレクトリへ移動してから起動する。
$startCmdBody = @"
@echo off
cd /d "$runDir"
set DOTNET_ROLL_FORWARD=LatestMajor
set ASPNETCORE_ENVIRONMENT=Production
"$dotnetExe" $appArgs
"@
# start.cmd を UTF-8(BOM 無し) で書き出す
[System.IO.File]::WriteAllText($startCmd, $startCmdBody, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "手動起動スクリプトを生成しました: $startCmd"

# ログ出力先ディレクトリ
$logDir = Join-Path $InstallRoot 'logs'

# サービス化する場合
if (-not $NoService) {
    # NSSM を用意する
    $nssm = Resolve-NssmExe -ToolsDir $ToolsDir
    # NSSM で Windows サービスを作成・起動する（作業ディレクトリは DLL のある場所）
    New-RegistryService -NssmExe $nssm -ServiceName $ServiceName `
        -Application $dotnetExe -Arguments $appArgs `
        -WorkingDirectory $runDir -LogDir $logDir -Environment $envVars `
        -Description "DevPortal NuGet private registry (BaGetter) on port $Port"
    # 起動完了（NuGet サービスインデックスの応答）を待つ
    Write-Info "サービスの起動を待機します..."
    # v3 サービスインデックスにアクセスして応答を確認する
    if (Wait-ForHttp -Uri "http://localhost:$Port/v3/index.json" -TimeoutSec 90) {
        Write-Ok "BaGetter が起動しました: http://localhost:$Port/"
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
Write-Section "セットアップ完了（BaGetter / NuGet）"
Write-Host ""
Write-Host "  Web UI       : http://localhost:$Port/" -ForegroundColor White
Write-Host "  サービス索引 : http://localhost:$Port/v3/index.json" -ForegroundColor White
Write-Host "  API キー     : $ApiKey" -ForegroundColor Yellow
Write-Host ""
Write-Host "  取得(restore)/公開(push)側 nuget.config 例:" -ForegroundColor White
Write-Host "    <packageSources>" -ForegroundColor DarkGray
Write-Host "      <add key=`"devportal`" value=`"http://localhost:$Port/v3/index.json`" allowInsecureConnections=`"true`" />" -ForegroundColor DarkGray
Write-Host "    </packageSources>" -ForegroundColor DarkGray
Write-Host "  公開(push)コマンド例（named source 経由）:" -ForegroundColor White
Write-Host "    dotnet nuget push *.nupkg --source devportal --api-key $ApiKey" -ForegroundColor DarkGray
Write-Host ""
Write-Warn "HTTP の間は nuget.config に allowInsecureConnections=`"true`" が必須です（近年の NuGet は HTTP ソースを既定でブロックします）。"
Write-Warn "本番では必ずリバースプロキシで HTTPS 化し（その際 allowInsecureConnections は不要）、API キーはシークレットストアで管理してください。"
