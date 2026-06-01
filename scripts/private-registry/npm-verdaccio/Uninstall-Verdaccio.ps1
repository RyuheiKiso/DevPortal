<#
.SYNOPSIS
    npm プライベートレジストリ（Verdaccio）をアンインストールする。

.DESCRIPTION
    Setup-Verdaccio.ps1 で作成した Windows サービスを停止・削除し、
    インストールディレクトリを削除する。-KeepData を付けると公開済みパッケージと
    認証情報（data ディレクトリ）を残して本体のみ削除する。

.PARAMETER InstallRoot
    インストール先ディレクトリ。Setup と同じ値を指定する。

.PARAMETER ServiceName
    削除する Windows サービス名。Setup と同じ値を指定する。

.PARAMETER KeepData
    レジストリデータ（data ディレクトリ）を残す。

.PARAMETER Force
    確認プロンプトを表示せずに削除する。

.EXAMPLE
    .\Uninstall-Verdaccio.ps1 -Force
#>
[CmdletBinding()]
param(
    # インストール先ディレクトリ
    [string]$InstallRoot = 'C:\devportal-registry\verdaccio',
    # Windows サービス名
    [string]$ServiceName = 'DevPortal-Verdaccio',
    # NSSM の配置先（サービス削除に使用）
    [string]$ToolsDir = 'C:\devportal-registry\tools',
    # データを残すかどうか
    [switch]$KeepData,
    # 確認なしで削除するかどうか
    [switch]$Force
)

# エラーは即座に停止させる
$ErrorActionPreference = 'Stop'
# 共通ヘルパーを読み込む
. "$PSScriptRoot\..\common\PrivateRegistryCommon.ps1"

Write-Section "Verdaccio (npm) アンインストール"

# 削除内容を案内する
Write-Info "対象サービス: $ServiceName"
Write-Info "対象ディレクトリ: $InstallRoot"
Write-Info ("データ保持: " + ($(if ($KeepData) { '残す' } else { '削除する' })))

# 確認プロンプト（-Force 指定時は省略）
if (-not $Force) {
    # ユーザーに最終確認を求める
    $answer = Read-Host "上記を削除します。よろしいですか？ (y/N)"
    # y / yes 以外は中断する
    if ($answer -notmatch '^(y|yes)$') {
        Write-Warn "中断しました。"
        return
    }
}

# 1) サービスを停止・削除する --------------------------------------------------
Write-Section "1/2 サービスの削除"
# NSSM のパスを解決する
$nssm = Join-Path $ToolsDir 'nssm.exe'
# サービスを停止・削除する
Remove-RegistryService -NssmExe $nssm -ServiceName $ServiceName

# 2) ファイルを削除する --------------------------------------------------------
Write-Section "2/2 ファイルの削除"
# インストールディレクトリが存在する場合のみ処理する
if (Test-Path $InstallRoot) {
    if ($KeepData) {
        # データディレクトリ以外（app・logs・config.yaml・start.cmd など）を削除する
        Get-ChildItem -Path $InstallRoot -Force | Where-Object { $_.Name -ne 'data' } | ForEach-Object {
            # 各項目を再帰的に削除する
            Remove-Item -Path $_.FullName -Recurse -Force
        }
        Write-Ok "本体を削除しました（データは保持）: $InstallRoot\data"
    }
    else {
        # ディレクトリごと完全に削除する
        Remove-Item -Path $InstallRoot -Recurse -Force
        Write-Ok "ディレクトリを削除しました: $InstallRoot"
    }
}
else {
    # ディレクトリが無ければスキップする
    Write-Info "ディレクトリは存在しません（スキップ）: $InstallRoot"
}

Write-Section "アンインストール完了（Verdaccio / npm）"
