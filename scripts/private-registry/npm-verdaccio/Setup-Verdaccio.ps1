<#
.SYNOPSIS
    npm プライベートレジストリ（Verdaccio）を Windows にセットアップする。

.DESCRIPTION
    DevPortal の TypeScript 共有パッケージ（packages/typescript）を社内配布するための
    npm レジストリ Verdaccio をインストールし、Windows サービスとして常駐させる。
    Verdaccio は Node.js 製の軽量 npm レジストリで、自社 hosted と npmjs の
    プロキシ（uplink）を兼ねる。Verdaccio 本体はインストール先配下にローカル導入し、
    グローバル環境を汚さない。

.PARAMETER InstallRoot
    インストール先ディレクトリ。既定は C:\devportal-registry\verdaccio。

.PARAMETER Port
    待ち受け HTTP ポート。既定は 4873。

.PARAMETER Scope
    自社パッケージのスコープ。既定は @devportal。

.PARAMETER ServiceName
    登録する Windows サービス名。既定は DevPortal-Verdaccio。

.PARAMETER Version
    導入する Verdaccio のバージョン。既定は latest。

.PARAMETER DisableSignup
    指定すると npm adduser による自己ユーザー登録を禁止する（max_users: -1）。

.PARAMETER NoService
    指定するとサービス登録せず、手動起動用の start.cmd のみ用意する（検証・お試し用）。

.EXAMPLE
    .\Setup-Verdaccio.ps1
#>
[CmdletBinding()]
param(
    # インストール先ディレクトリ
    [string]$InstallRoot = 'C:\devportal-registry\verdaccio',
    # 待ち受けポート
    [int]$Port = 4873,
    # 自社パッケージのスコープ
    [string]$Scope = '@devportal',
    # Windows サービス名
    [string]$ServiceName = 'DevPortal-Verdaccio',
    # 導入バージョン
    [string]$Version = 'latest',
    # NSSM などツールの配置先
    [string]$ToolsDir = 'C:\devportal-registry\tools',
    # 自己ユーザー登録を禁止するか
    [switch]$DisableSignup,
    # サービス登録を行わない（検証用）
    [switch]$NoService
)

# エラーは即座に停止させる
$ErrorActionPreference = 'Stop'
# 共通ヘルパーを読み込む
. "$PSScriptRoot\..\common\PrivateRegistryCommon.ps1"

Write-Section "Verdaccio (npm) セットアップ開始"

# サービス登録する場合は管理者権限を要求する
if (-not $NoService) { Assert-Admin -Purpose 'Verdaccio のサービス登録' }

# 1) Node.js / npm の確認 -----------------------------------------------------
Write-Section "1/4 Node.js / npm の確認"
# node コマンドの存在を確認する
if (-not (Test-CommandExists -Name 'node')) {
    throw "Node.js が見つかりません。Node.js 18 以上を導入してください。"
}
# npm コマンドの存在を確認する
if (-not (Test-CommandExists -Name 'npm')) {
    throw "npm が見つかりません。Node.js（npm 同梱）を導入してください。"
}
# node 実行ファイルのフルパスを取得する（サービス登録に使う）
$nodeExe = (Get-Command node).Source
# バージョンを表示する
Write-Ok "Node.js $(& node --version) / npm $(& npm --version) を確認しました"

# 2) Verdaccio 本体をローカル導入する ------------------------------------------
Write-Section "2/4 Verdaccio の導入"
# アプリ本体（node_modules）の配置先
$appDir = Join-Path $InstallRoot 'app'
# アプリディレクトリを作成する
if (-not (Test-Path $appDir)) { New-Item -ItemType Directory -Path $appDir -Force | Out-Null }
# ローカルインストールの土台となる最小 package.json を作成する
$pkgJson = '{ "name": "devportal-verdaccio-host", "private": true }'
# package.json を UTF-8(BOM 無し) で書き出す
[System.IO.File]::WriteAllText((Join-Path $appDir 'package.json'), $pkgJson, (New-Object System.Text.UTF8Encoding($false)))
# verdaccio をローカル（appDir 配下）に導入する
Write-Info "npm install verdaccio@$Version を実行します（数十秒かかる場合があります）"
# --prefix で appDir 配下の node_modules へインストールする
& npm install --prefix "$appDir" "verdaccio@$Version" --no-audit --no-fund
# npm の終了コードを確認する
if ($LASTEXITCODE -ne 0) { throw "verdaccio のインストールに失敗しました（npm 終了コード $LASTEXITCODE）。" }
# Verdaccio の起動エントリ（JS ファイル）パスを組み立てる
$entry = Join-Path $appDir 'node_modules\verdaccio\bin\verdaccio'
# エントリが存在するか確認する
if (-not (Test-Path $entry)) { throw "Verdaccio のエントリが見つかりません: $entry" }
Write-Ok "Verdaccio を導入しました: $appDir"

# 3) 設定ファイル（config.yaml）を生成する ------------------------------------
Write-Section "3/4 設定ファイルの生成"
# データ（ストレージ・認証ファイル）格納ディレクトリ
$dataDir = Join-Path $InstallRoot 'data'
# データディレクトリを作成する
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
# YAML ではパス区切りにスラッシュを使う（Windows でも有効）
$storagePath = (Join-Path $dataDir 'storage') -replace '\\', '/'
$htpasswdPath = (Join-Path $dataDir 'htpasswd') -replace '\\', '/'
# 自己登録の可否を max_users に反映する（-1 で禁止、1000 で許可）
$maxUsers = if ($DisableSignup) { '-1' } else { '1000' }
# config.yaml の内容を組み立てる（$all などの Verdaccio 予約語は ` でエスケープ）
$configBody = @"
# DevPortal npm プライベートレジストリ（Verdaccio）設定
# パッケージ実体・メタデータの保存先
storage: $storagePath
# Web UI の設定
web:
  title: DevPortal npm registry
# 認証方式（htpasswd ファイルでユーザー管理）
auth:
  htpasswd:
    file: $htpasswdPath
    # 自己ユーザー登録の上限（-1 で登録禁止）
    max_users: $maxUsers
# 外部レジストリ（npmjs）への上流プロキシ
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
# パッケージごとのアクセス制御
packages:
  # 自社スコープは hosted 専用（外部プロキシしない）
  '$Scope/*':
    access: `$all
    publish: `$authenticated
    unpublish: `$authenticated
  # その他のスコープ付きパッケージは npmjs をプロキシ
  '@*/*':
    access: `$all
    publish: `$authenticated
    unpublish: `$authenticated
    proxy: npmjs
  # スコープ無しパッケージも npmjs をプロキシ
  '**':
    access: `$all
    publish: `$authenticated
    unpublish: `$authenticated
    proxy: npmjs
# ログ出力（標準出力へ）
log:
  type: stdout
  format: pretty
  level: http
# 待ち受けアドレス・ポート
listen: 0.0.0.0:$Port
"@
# config.yaml の出力先
$configPath = Join-Path $InstallRoot 'config.yaml'
# config.yaml を UTF-8(BOM 無し) で書き出す
[System.IO.File]::WriteAllText($configPath, $configBody, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "設定ファイルを書き出しました: $configPath"

# 4) 起動コマンドの組み立てとサービス化 ----------------------------------------
Write-Section "4/4 起動設定"
# Verdaccio に渡す引数（設定ファイルを指定）
$appArgs = "`"$entry`" --config `"$configPath`""
# 手動起動用 start.cmd を生成する
$startCmd = Join-Path $InstallRoot 'start.cmd'
# バッチ内容（node でエントリを起動）
$startCmdBody = "@echo off`r`n`"$nodeExe`" $appArgs`r`n"
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
        -Application $nodeExe -Arguments $appArgs `
        -WorkingDirectory $appDir -LogDir $logDir `
        -Description "DevPortal npm private registry (Verdaccio) on port $Port"
    # 起動完了（Web/HTTP 応答）を待つ
    Write-Info "サービスの起動を待機します..."
    # ルートにアクセスして応答を確認する
    if (Wait-ForHttp -Uri "http://localhost:$Port/" -TimeoutSec 90) {
        Write-Ok "Verdaccio が起動しました: http://localhost:$Port/"
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
Write-Section "セットアップ完了（Verdaccio / npm）"
Write-Host ""
Write-Host "  レジストリ URL : http://localhost:$Port/" -ForegroundColor White
Write-Host "  自社スコープ   : $Scope" -ForegroundColor White
Write-Host ""
Write-Host "  利用側 .npmrc 例:" -ForegroundColor White
Write-Host "    $Scope`:registry=http://localhost:$Port/" -ForegroundColor DarkGray
Write-Host "    registry=http://localhost:$Port/   # 全体を向ける場合（npmjs はプロキシ）" -ForegroundColor DarkGray
Write-Host "  ユーザー登録 / ログイン:" -ForegroundColor White
Write-Host "    npm adduser --registry http://localhost:$Port/" -ForegroundColor DarkGray
Write-Host "  公開(publish):" -ForegroundColor White
Write-Host "    npm publish --registry http://localhost:$Port/" -ForegroundColor DarkGray
Write-Host ""
Write-Warn "本番では必ずリバースプロキシで HTTPS 化してください。登録を絞る場合は -DisableSignup を使います。"
