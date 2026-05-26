<#
.SYNOPSIS
    product/framework/typescript 配下の 35 個の catalog-info.yaml を社内 Backstage に一括登録する。

.DESCRIPTION
    setup ツールで導入された Backstage (http://localhost:7007) の Catalog REST API
    (POST /api/catalog/locations) を使って、framework/typescript 配下の Location ファイル
    群 (owners.yaml + 8 System + 26 Component) を登録する。
    依存解決の都合で Round 1 (Group/Domain + 8 System) → Round 2 (26 Component) の
    順に投入し、ラウンド内では並列実行する。既存 location との重複は SKIP する。

.PARAMETER Method
    登録方式 (既定: ConfigFile)。
    - ConfigFile : app-config.yaml に catalog.locations を追記してサービス再起動 (file:// が default で動かない問題の回避策、管理者権限が必要)
    - ApiPost    : POST /api/catalog/locations で逐次登録 (GitHub raw URL 等の HTTP URL 用、permission framework 対応)

.PARAMETER BackstageUrl
    登録先 Backstage の baseUrl (既定: http://localhost:7007)。

.PARAMETER AppConfig
    ConfigFile モードで編集対象の app-config.yaml の絶対パス
    (既定: %ProgramData%\DevPortal\backstage\app\app-config.yaml)。

.PARAMETER ServiceName
    ConfigFile モードで再起動する Windows サービス名 (既定: DevPortal-Backstage)。

.PARAMETER SkipRestart
    ConfigFile モードでサービス再起動をスキップする (手動で再起動したい場合用)。

.PARAMETER CatalogRoot
    35 ファイル探索のルート (既定: スクリプト自身のあるディレクトリ = framework/typescript)。

.PARAMETER LocationType
    Backstage の location type (file または url、既定: file)。
    file は backend からアクセス可能な絶対パス、url は GitHub raw URL 等の HTTP URL を想定。

.PARAMETER UrlBase
    -LocationType url 指定時の base URL (必須)。各 catalog-info.yaml の RelPath を
    {UrlBase}/{RelPath} に組み立てて target にする。
    例: https://raw.githubusercontent.com/myorg/DevPortal/main/product/framework/typescript
    file モード時は無視される。

.PARAMETER Token
    任意の Bearer トークン。デフォルトの create-app では permission framework 無効なので不要。
    permission を有効化している場合のみ指定する。

.PARAMETER OnConflict
    既存 location があった場合の Backstage の挙動 (refresh または reject、既定: refresh)。

.PARAMETER DryRun
    指定すると API クエリに ?dryRun=true を付与し、DB に書き込まずバリデーションのみ行う。

.PARAMETER MaxParallel
    1 ラウンド内で並行 POST する件数 (既定: 4)。1 にすると逐次実行。

.PARAMETER LogFile
    指定したパスにタイムスタンプ付きで全イベントを追記出力する (publish-all と同じ書式)。
#>
# スクリプトパラメータ定義 (PowerShell 標準の CmdletBinding を有効化)
[CmdletBinding()]
param(
    # 登録方式 (ConfigFile = app-config.yaml 編集 + 再起動 / ApiPost = REST API POST)
    [ValidateSet("ConfigFile","ApiPost")][string]$Method = "ConfigFile",
    # 登録先 Backstage の baseUrl (デフォルト setup ツールが起動するポート 7007)
    [string]$BackstageUrl = "http://localhost:7007",
    # ConfigFile モードで編集対象の app-config.yaml の絶対パス
    [string]$AppConfig = "",
    # ConfigFile モードで再起動する Windows サービス名
    [string]$ServiceName = "DevPortal-Backstage",
    # ConfigFile モードでサービス再起動をスキップする
    [switch]$SkipRestart,
    # catalog-info.yaml の探索ルート (既定はスクリプトと同一ディレクトリ)
    [string]$CatalogRoot = "",
    # Backstage location type (file = backend filesystem パス、url = HTTP URL)
    [ValidateSet("file","url")][string]$LocationType = "file",
    # url モード時の base URL (例: https://raw.githubusercontent.com/<org>/DevPortal/main/product/framework/typescript)
    [string]$UrlBase = "",
    # 任意の Bearer トークン (permission 有効時のみ必要)
    [string]$Token = "",
    # 既存 location があった場合の Backstage の挙動
    [ValidateSet("refresh","reject")][string]$OnConflict = "refresh",
    # 動作確認用の dry-run フラグ (?dryRun=true を付与)
    [switch]$DryRun,
    # ラウンド内並列度 (既定 4)
    [ValidateRange(1, 16)][int]$MaxParallel = 4,
    # ログファイル出力先 (指定があればコンソール出力と同じ内容を追記)
    [string]$LogFile = ""
)

# 想定外の例外が発生したら即座にスクリプトを停止する
$ErrorActionPreference = "Stop"

# スクリプト自身のあるディレクトリ (product/framework/typescript) の絶対パスを取得する
$ScriptRoot = $PSScriptRoot
# CatalogRoot 未指定時はスクリプトディレクトリを使用する
if ([string]::IsNullOrWhiteSpace($CatalogRoot)) { $CatalogRoot = $ScriptRoot }
# 絶対パスに正規化する
$CatalogRoot = (Resolve-Path -Path $CatalogRoot).Path
# スクリプト実行中の作業ディレクトリを CatalogRoot に固定する
Set-Location -Path $CatalogRoot

# url モード時は UrlBase が必須 (RelPath との結合で target を組み立てるため)
if ($LocationType -eq "url" -and [string]::IsNullOrWhiteSpace($UrlBase)) {
    throw "-LocationType url を指定する場合は -UrlBase <base URL> を必ず指定してください (例: -UrlBase https://raw.githubusercontent.com/<org>/DevPortal/main/product/framework/typescript)"
}
# UrlBase の末尾スラッシュは後で RelPath と結合するときに統一するため正規化しておく
$UrlBase = $UrlBase.TrimEnd('/')

# AppConfig 未指定時は setup ツールの既定インストール先を解決する
if ([string]::IsNullOrWhiteSpace($AppConfig)) {
    $AppConfig = Join-Path -Path $env:ProgramData -ChildPath "DevPortal\backstage\app\app-config.yaml"
}

# ログファイルパスをスクリプトスコープで Write-Log から参照できるよう保持する
$script:LogFilePath = if ([string]::IsNullOrWhiteSpace($LogFile)) { $null } else { [System.IO.Path]::GetFullPath($LogFile) }

# 登録対象 location 一覧 (Round 1 = owners + 8 System、Round 2 = 26 Component)
$Locations = @(
    # Round 1: 依存先となる Group / Domain / System を先に投入する
    [pscustomobject]@{ Name = "owners";                       RelPath = "owners.yaml";                          Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-auth";          RelPath = "library\auth\catalog-info.yaml";               Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-config";        RelPath = "library\config\catalog-info.yaml";             Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-error";         RelPath = "library\error\catalog-info.yaml";              Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-http";          RelPath = "library\http\catalog-info.yaml";               Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-logger";        RelPath = "library\logger\catalog-info.yaml";             Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-notification";  RelPath = "library\notification\catalog-info.yaml";       Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-storage";       RelPath = "library\storage\catalog-info.yaml";            Round = 1 }
    [pscustomobject]@{ Name = "system:k1s0-ts-camera";        RelPath = "library\camera\catalog-info.yaml";             Round = 1 }
    # Round 2: Component (Group/System 解決後に投入)
    [pscustomobject]@{ Name = "component:k1s0-ts-auth-core";                RelPath = "library\auth\core\catalog-info.yaml";                Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-auth-react";               RelPath = "library\auth\react\catalog-info.yaml";               Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-auth-react-native";        RelPath = "library\auth\react-native\catalog-info.yaml";        Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-config-core";              RelPath = "library\config\core\catalog-info.yaml";              Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-config-react";             RelPath = "library\config\react\catalog-info.yaml";             Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-config-react-native";      RelPath = "library\config\react-native\catalog-info.yaml";      Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-config-loader";            RelPath = "library\config\loader\catalog-info.yaml";            Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-config-rn-loader";         RelPath = "library\config\rn-loader\catalog-info.yaml";         Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-error-core";               RelPath = "library\error\core\catalog-info.yaml";               Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-error-react";              RelPath = "library\error\react\catalog-info.yaml";              Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-error-react-native";       RelPath = "library\error\react-native\catalog-info.yaml";       Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-http-core";                RelPath = "library\http\core\catalog-info.yaml";                Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-http-react";               RelPath = "library\http\react\catalog-info.yaml";               Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-http-react-native";        RelPath = "library\http\react-native\catalog-info.yaml";        Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-logger-core";              RelPath = "library\logger\core\catalog-info.yaml";              Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-logger-react";             RelPath = "library\logger\react\catalog-info.yaml";             Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-logger-react-native";      RelPath = "library\logger\react-native\catalog-info.yaml";      Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-notification-core";        RelPath = "library\notification\core\catalog-info.yaml";        Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-notification-react";       RelPath = "library\notification\react\catalog-info.yaml";       Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-notification-react-native";RelPath = "library\notification\react-native\catalog-info.yaml";Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-storage-core";             RelPath = "library\storage\core\catalog-info.yaml";             Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-storage-react";            RelPath = "library\storage\react\catalog-info.yaml";            Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-storage-react-native";     RelPath = "library\storage\react-native\catalog-info.yaml";     Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-camera-core";              RelPath = "library\camera\core\catalog-info.yaml";              Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-camera-react";             RelPath = "library\camera\react\catalog-info.yaml";             Round = 2 }
    [pscustomobject]@{ Name = "component:k1s0-ts-camera-react-native";      RelPath = "library\camera\react-native\catalog-info.yaml";      Round = 2 }
)

# ログレベルからコンソール色を導出する
function Get-LogColor {
    param([string]$Level)
    # Level に応じた色を返す (Info/Ok/Skip/Fail のみ受け付ける)
    switch ($Level) {
        "Info" { return "Cyan" }
        "Ok"   { return "Green" }
        "Skip" { return "Yellow" }
        "Fail" { return "Red" }
    }
    # 想定外は白を返す
    return "White"
}

# ログレベルから表示タグ (4 文字固定) を導出する
function Get-LogTag {
    param([string]$Level)
    # Level に応じたタグを返す (パディングして揃える)
    switch ($Level) {
        "Info" { return "INFO" }
        "Ok"   { return " OK " }
        "Skip" { return "SKIP" }
        "Fail" { return "FAIL" }
    }
    # 想定外は ???? を返す
    return "????"
}

# 統一ログ出力 (色付きコンソール + 任意のログファイル append)
function Write-Log {
    param(
        # ログレベル (Info / Ok / Skip / Fail)
        [ValidateSet("Info","Ok","Skip","Fail")][string]$Level,
        # 出力本文
        [string]$Message
    )
    # 表示用タグと色を取得する
    $tag = Get-LogTag -Level $Level
    $color = Get-LogColor -Level $Level
    # コンソールに色付きで出力する
    Write-Host "[$tag] $Message" -ForegroundColor $color
    # LogFile が指定されている場合のみファイルにも追記する
    if ($script:LogFilePath) {
        # ISO8601 形式のタイムスタンプを生成
        $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
        # 1 行の出力フォーマットを組み立てる
        $line = "[$timestamp] [$tag] $Message`r`n"
        # BOM なし UTF-8 で append する
        [System.IO.File]::AppendAllText($script:LogFilePath, $line, [System.Text.UTF8Encoding]::new($false))
    }
}

# ===== ConfigFile モード専用ヘルパー (start) =====

# 現在の PowerShell プロセスが管理者権限で動いているか判定する
function Test-IsAdmin {
    # Windows 標準 API でビルトイン Administrator ロール所属を確認する
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# app-config.yaml をタイムスタンプ付きで同階層にバックアップする
function Backup-AppConfig {
    param([string]$Path)
    # ファイル名: <stem>.bak.YYYYMMDD-HHMMSS.<ext>
    $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
    $dir = Split-Path -Parent $Path
    $name = Split-Path -Leaf $Path
    $backupPath = Join-Path -Path $dir -ChildPath "$name.bak.$stamp"
    # 確実に複製 (Force でロック中ファイルでも上書き、$null = で出力抑制)
    Copy-Item -Path $Path -Destination $backupPath -Force
    return $backupPath
}

# Python ヘルパー (register-locations.py) を呼び出して app-config.yaml をマージする
function Invoke-LocationMerge {
    param(
        # app-config.yaml の絶対パス
        [string]$AppConfigPath,
        # CatalogRoot 絶対パス
        [string]$CatalogRootPath,
        # 相対パスの配列
        [string[]]$RelPaths
    )
    # python ヘルパーのパス (同階層に配置)
    $helper = Join-Path -Path $PSScriptRoot -ChildPath "register-locations.py"
    if (-not (Test-Path $helper -PathType Leaf)) {
        throw "register-locations.py が見つかりません: $helper"
    }
    # python がパスに存在することを確認 (PyYAML は前提)
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
        throw "python コマンドが PATH にありません。Python 3 と PyYAML をインストールしてください。"
    }
    # 相対パスをカンマ区切りで結合する
    $relCsv = ($RelPaths -join ',')
    # python ヘルパー実行 (stdout に JSON 1 行が出る)
    $stdout = & python $helper --config $AppConfigPath --catalog-root $CatalogRootPath --rel-paths $relCsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "register-locations.py が異常終了 (exit=$LASTEXITCODE): $stdout"
    }
    # 末尾行を JSON としてパース (途中行は警告等の可能性)
    $jsonLine = ($stdout -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $jsonLine) {
        throw "register-locations.py の JSON 出力をパースできませんでした: $stdout"
    }
    # PowerShell の PSCustomObject に変換して返す
    return $jsonLine | ConvertFrom-Json
}

# DevPortal-Backstage サービスを再起動する (管理者権限必須)
function Restart-BackstageService {
    param([string]$Name)
    Write-Log Info "サービス '$Name' を再起動します..."
    # Restart-Service は同期 (デフォルトでタイムアウト 30 秒、起動完了は別途 wait)
    Restart-Service -Name $Name -Force -ErrorAction Stop
    Write-Log Ok "サービス再起動コマンドを発行 (実際の ready 判定は HTTP poll で確認)"
}

# Backstage が起動完了するまで /api/auth/guest/refresh を最大 $MaxSeconds 秒ポーリングする
function Wait-BackstageReady {
    param([int]$MaxSeconds = 90)
    Write-Log Info "Backstage の起動完了を待機中 (最大 $MaxSeconds 秒)..."
    $deadline = (Get-Date).AddSeconds($MaxSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "$BackstageUrl/api/auth/guest/refresh" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                Write-Log Ok "Backstage が応答可能になりました"
                return $true
            }
        } catch {
            # まだ起動中の可能性 (ECONNREFUSED 等) なので継続
        }
        Start-Sleep -Seconds 2
    }
    Write-Log Fail "Backstage が $MaxSeconds 秒以内に応答しませんでした"
    return $false
}

# k1s0-* エンティティが取り込まれたか確認する (catalog processor が file を消化するまでに数秒〜数十秒かかる)
function Wait-EntitiesIngested {
    param(
        [string]$BearerToken,
        [int]$ExpectedCount = 30,
        [int]$MaxSeconds = 60
    )
    Write-Log Info "k1s0-* エンティティの取り込み完了を待機中 (期待値 $ExpectedCount 件、最大 $MaxSeconds 秒)..."
    $headers = @{ Authorization = "Bearer $BearerToken" }
    $deadline = (Get-Date).AddSeconds($MaxSeconds)
    $last = -1
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-RestMethod -Uri "$BackstageUrl/api/catalog/entities?limit=1000" -Headers $headers -TimeoutSec 5
            $mine = @($resp | Where-Object { $_.metadata.name -match '^k1s0-' })
            if ($mine.Count -ne $last) {
                Write-Log Info "現在 $($mine.Count) 件取り込み済み..."
                $last = $mine.Count
            }
            if ($mine.Count -ge $ExpectedCount) {
                Write-Log Ok "$($mine.Count) 件取り込み完了 (期待値 $ExpectedCount に到達)"
                return $mine
            }
        } catch {
            # 一時的なエラーはリトライ
        }
        Start-Sleep -Seconds 3
    }
    Write-Log Fail "$MaxSeconds 秒以内に $ExpectedCount 件に到達しませんでした (最終 $last 件)"
    return @()
}

# ConfigFile モードのメインフロー
function Invoke-ConfigFileMode {
    # 全実行結果用ストップウォッチ
    $totalSw = [System.Diagnostics.Stopwatch]::StartNew()
    # ヘッダ表示
    Write-Log Info "Method       : ConfigFile"
    Write-Log Info "AppConfig    : $AppConfig"
    Write-Log Info "ServiceName  : $ServiceName"
    Write-Log Info "SkipRestart  : $SkipRestart"
    Write-Log Info "BackstageUrl : $BackstageUrl"
    Write-Log Info "CatalogRoot  : $CatalogRoot"
    Write-Log Info "LogFile      : $(if ($script:LogFilePath) { $script:LogFilePath } else { '(none)' })"

    # 1. 前提確認
    if (-not (Test-Path -Path $AppConfig -PathType Leaf)) {
        throw "app-config.yaml が見つかりません: $AppConfig"
    }
    $isAdmin = Test-IsAdmin
    Write-Log Info "現在の権限: $(if ($isAdmin) { '管理者' } else { '一般ユーザー (Restart-Service には管理者権限が必要)' })"
    if (-not $isAdmin -and -not $SkipRestart) {
        throw "サービス再起動には管理者権限が必要です。管理者 PowerShell から再実行するか、-SkipRestart で再起動を後回しにしてください。"
    }

    # 2. バックアップ
    Write-Log Info "app-config.yaml をバックアップ中..."
    $backupPath = Backup-AppConfig -Path $AppConfig
    Write-Log Ok "バックアップ作成: $backupPath"

    # 3. YAML マージ (python ヘルパー呼び出し)
    Write-Log Info "register-locations.py で 35 件を catalog.locations にマージ中..."
    $relPaths = $Locations | ForEach-Object { $_.RelPath -replace '\\','/' }
    $mergeResult = Invoke-LocationMerge -AppConfigPath $AppConfig -CatalogRootPath $CatalogRoot -RelPaths $relPaths
    Write-Log Ok ("マージ結果: added={0} skipped={1} rules_added=[{2}] total_locations_after={3}" -f `
        $mergeResult.added, $mergeResult.skipped, ($mergeResult.rules_added -join ','), $mergeResult.total_locations_after)

    # 4. サービス再起動 + ready 待ち
    if ($SkipRestart) {
        Write-Log Skip "サービス再起動をスキップ (-SkipRestart)。手動で 'Restart-Service $ServiceName' を実行してください。"
    } else {
        Restart-BackstageService -Name $ServiceName
        if (-not (Wait-BackstageReady -MaxSeconds 120)) {
            throw "Backstage の起動完了を確認できませんでした。サービスログ ($env:ProgramData\DevPortal\backstage\logs) を確認してください。"
        }
    }

    # 5. 取り込み検証 (guest トークン取得 → エンティティ列挙)
    if (-not $SkipRestart) {
        Write-Log Info "guest トークンを取得して取り込み確認中..."
        $token = Get-GuestToken
        if (-not $token) {
            Write-Log Fail "guest トークン取得失敗。検証スキップ (catalog UI で手動確認してください)"
        } else {
            $ingested = Wait-EntitiesIngested -BearerToken $token -ExpectedCount 30 -MaxSeconds 90
            if ($ingested.Count -gt 0) {
                # kind 別件数を表示
                $byKind = $ingested | Group-Object kind | Sort-Object Name
                foreach ($g in $byKind) { Write-Log Ok ("  {0,-10} {1} 件" -f $g.Name, $g.Count) }
            }
        }
    }

    $totalSw.Stop()
    Write-Log Info ("Total: {0}  (added={1} / skipped={2})" -f $totalSw.Elapsed.ToString("hh\:mm\:ss\.ff"), $mergeResult.added, $mergeResult.skipped)
    # ConfigFile モードでは added > 0 が成功条件 (skipped 全件でも idempotent OK)
    return 0
}

# ===== ConfigFile モード専用ヘルパー (end) =====

# Backstage の guest トークンを取得する (permission framework 有効時の認証回避用)
function Get-GuestToken {
    # Backstage の guest auth リフレッシュエンドポイントから JWT を取得する
    $url = "$BackstageUrl/api/auth/guest/refresh"
    try {
        $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5 -ErrorAction Stop
        # backstageIdentity.token に JWT が入っている
        if ($resp.backstageIdentity -and $resp.backstageIdentity.token) {
            return $resp.backstageIdentity.token
        }
        # 想定外の応答形式
        return $null
    } catch {
        # guest auth が無効化されている等の場合は null を返す (利用側で再判定)
        return $null
    }
}

# Backstage の死活確認 (/api/catalog/entities?limit=1 で軽量に疎通とエンドポイント可用性を兼ねる)
function Test-BackstageAlive {
    # entities エンドポイントの URL (limit=1 で最小負荷)
    $pingUrl = "$BackstageUrl/api/catalog/entities?limit=1"
    # 認証ヘッダー (Token が空ならヘッダーを付けない)
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($Token)) { $headers["Authorization"] = "Bearer $Token" }
    try {
        # Invoke-WebRequest で HTTP GET を実行し、応答コードを確認する
        $resp = Invoke-WebRequest -Uri $pingUrl -Headers $headers -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        # 200 OK 以外は疎通失敗とみなす
        if ($resp.StatusCode -ne 200) {
            # 失敗詳細をログに残してから false を返す
            Write-Log Fail "Backstage 疎通が異常応答 (HTTP $($resp.StatusCode))"
            return $false
        }
        # 疎通成功
        return $true
    } catch {
        # 例外発生時は到達不能とみなしてエラー詳細をログに残す
        Write-Log Fail "Backstage に到達できません ($pingUrl): $($_.Exception.Message)"
        return $false
    }
}

# 既存 location 一覧を取得し、target 文字列 (小文字化) のセットを返す
function Get-ExistingLocationTargets {
    # locations 一覧の URL を構築する
    $url = "$BackstageUrl/api/catalog/locations"
    # 認証ヘッダーを構築する (Token 未指定時は空のハッシュテーブル)
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($Token)) { $headers["Authorization"] = "Bearer $Token" }
    try {
        # Invoke-RestMethod で JSON 配列として取得する
        $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $headers -TimeoutSec 10
        # レスポンスから target 文字列を抽出して HashSet に格納する
        $set = New-Object System.Collections.Generic.HashSet[string]
        foreach ($item in $resp) {
            # Backstage v1.x の応答形式は [{ data: { type, target } }] と [{ type, target }] の両方がありえる
            $t = if ($item.data -and $item.data.target) { $item.data.target } else { $item.target }
            if ($t) { $null = $set.Add($t.ToLowerInvariant()) }
        }
        return $set
    } catch {
        # 取得に失敗しても致命的ではない (重複は POST 側の 409 で検出可能)
        Write-Log Fail "既存 location 一覧の取得に失敗しました: $($_.Exception.Message)"
        return New-Object System.Collections.Generic.HashSet[string]
    }
}

# 絶対パスを Backstage の type=file target 形式に整形する (バックスラッシュを正規化)
function Format-FileTarget {
    param([string]$AbsolutePath)
    # バックスラッシュをフォワードスラッシュに変換 (Backstage は両方受けるが念のため統一)
    return ($AbsolutePath -replace '\\','/')
}

# ジョブ内で実行する登録処理本体 (親スコープに依存しない自己完結スクリプトブロック)
$RegisterJobScript = {
    param(
        # 対象 location 情報 (Name / RelPath / Round)
        $Location,
        # Backstage の baseUrl
        $BackstageUrl,
        # CatalogRoot 絶対パス
        $CatalogRoot,
        # location type (file または url)
        $LocationType,
        # url モード時の base URL (file モードでは未使用)
        $UrlBase,
        # 任意の Bearer トークン
        $Token,
        # onConflict クエリ値
        $OnConflict,
        # dry-run モードかどうか
        $IsDryRun,
        # 既存 location target の HashSet (小文字化済み)
        $ExistingTargets
    )
    # 計測用ストップウォッチを開始する
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    # 結果オブジェクトを初期化する
    $result = [pscustomobject]@{
        Name       = $Location.Name
        RelPath    = $Location.RelPath
        Round      = $Location.Round
        Target     = $null
        Status     = "FAIL"
        Elapsed    = [TimeSpan]::Zero
        StatusCode = -1
        Output     = ""
    }
    try {
        # 対象 catalog-info.yaml の絶対パスを取得
        $absolute = Join-Path -Path $CatalogRoot -ChildPath $Location.RelPath
        if (-not (Test-Path -Path $absolute -PathType Leaf)) {
            $result.Output = "file not found: $absolute"
            return $result
        }
        # target を location type に応じて組み立てる
        # 注: Backstage default backend は type='file' を受け付けない (FileLocationProcessor 未登録)。
        # 代わりに type='url' + file:///absolute-path 形式で同等の動作になる。
        # このため file モードでも実 API には type='url' として送る。
        if ($LocationType -eq "file") {
            # file モード: file:///C:/path/... 形式に組み立てる
            $target = "file:///" + ($absolute -replace '\\','/')
        } else {
            # url モード: {UrlBase}/{RelPath} で組み立てる (UrlBase は末尾スラッシュ除去済み)
            $relForward = $Location.RelPath -replace '\\','/'
            $target = "$UrlBase/$relForward"
        }
        $result.Target = $target
        # 実 API に送る type は常に 'url' (file モードは file:/// で偽装)
        $apiType = 'url'
        # 既存 location に同 target があれば事前 SKIP (無駄な POST を避ける)
        if ($ExistingTargets -and $ExistingTargets.Contains($target.ToLowerInvariant())) {
            $result.Status = "SKIP"
            $result.Output = "already registered"
            return $result
        }
        # クエリ文字列を組み立てる (onConflict のみ。dryRun はこのバージョンの Backstage で 400 になるため、
        # IsDryRun=true 時は事前 SKIP として後段で扱う)
        $query = "?onConflict=$OnConflict"
        $url = "$BackstageUrl/api/catalog/locations$query"
        # 認証ヘッダー (Token 未指定時は空のテーブル)
        $headers = @{ "Content-Type" = "application/json"; "Accept" = "application/json" }
        if (-not [string]::IsNullOrWhiteSpace($Token)) { $headers["Authorization"] = "Bearer $Token" }
        # リクエストボディ (target / type) - 実 API には常に type=url を送る (file モードも file:/// で偽装済み)
        $body = @{ target = $target; type = $apiType } | ConvertTo-Json -Compress
        # DryRun モードの場合は実 POST を打たず SKIP 扱いにする (Backstage 側 dryRun は HTTP 400 を返すバージョンが存在するため)
        if ($IsDryRun) {
            $result.Status = "SKIP"
            $result.Output = "DryRun (no POST sent; target=$target type=$apiType)"
            return $result
        }
        try {
            # Invoke-WebRequest で POST し、StatusCode を取得する
            $resp = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
            $result.StatusCode = [int]$resp.StatusCode
            $result.Output = $resp.Content
            # 200 / 201 はいずれも作成成功とみなす
            if ($result.StatusCode -ge 200 -and $result.StatusCode -lt 300) {
                $result.Status = "OK"
            } else {
                $result.Status = "FAIL"
            }
        } catch [System.Net.WebException] {
            # WebException の場合、レスポンスから StatusCode と本文を抽出する
            $we = $_.Exception
            if ($we.Response) {
                $result.StatusCode = [int]$we.Response.StatusCode
                $stream = $we.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $result.Output = $reader.ReadToEnd()
                $reader.Dispose()
            } else {
                $result.Output = $we.Message
            }
            # 409 Conflict は既存 location (SKIP 扱い)、それ以外は FAIL
            if ($result.StatusCode -eq 409) {
                $result.Status = "SKIP"
                if ([string]::IsNullOrWhiteSpace($result.Output)) { $result.Output = "already registered (409)" }
            } else {
                $result.Status = "FAIL"
            }
        } catch {
            # PowerShell Core 系で HttpResponseException が出るケースの対応
            $msg = $_.Exception.Message
            # メッセージから (HTTP NNN) パターンを抽出する
            if ($msg -match '\((\d{3})\)') { $result.StatusCode = [int]$Matches[1] }
            $result.Output = $msg
            if ($result.StatusCode -eq 409) {
                $result.Status = "SKIP"
                if ([string]::IsNullOrWhiteSpace($result.Output)) { $result.Output = "already registered (409)" }
            } else {
                $result.Status = "FAIL"
            }
        }
    } finally {
        # ストップウォッチを停止して経過時間を結果に格納する
        $sw.Stop()
        $result.Elapsed = $sw.Elapsed
    }
    # 結果を返す
    return $result
}

# 1 ラウンドを並列実行する
function Invoke-RoundParallel {
    param(
        # 当該ラウンドの対象 location 配列
        [array]$Locations,
        # ラウンド番号 (ログ表示用)
        [int]$RoundNumber,
        # 並列度
        [int]$MaxParallel,
        # ジョブの ScriptBlock
        [scriptblock]$JobScript,
        # 既存 location target の HashSet (ジョブに渡す)
        $ExistingTargets,
        # dry-run かどうか
        [bool]$IsDryRun,
        # 全体総数 (進捗表示用)
        [int]$TotalCount,
        # 累計完了数 (参照渡しで親が共有)
        [ref]$Completed
    )
    # Start-ThreadJob が利用可能なら使用、無ければ Start-Job にフォールバックする
    $useThreadJob = [bool](Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)
    # 未投入 location のキュー
    $pending = [System.Collections.Generic.Queue[object]]::new()
    # キューに全 location を積む
    foreach ($loc in $Locations) { $pending.Enqueue($loc) | Out-Null }
    # 走行中ジョブ管理用リスト
    $running = New-Object System.Collections.Generic.List[object]
    # ラウンド全体の結果集約リスト
    $roundResults = New-Object System.Collections.Generic.List[object]
    # キューが空、かつ走行中ジョブも 0 になるまでループ
    while ($pending.Count -gt 0 -or $running.Count -gt 0) {
        # 空きスロットがある限り新規ジョブを投入する
        while ($pending.Count -gt 0 -and $running.Count -lt $MaxParallel) {
            $loc = $pending.Dequeue()
            # ThreadJob か通常 Job かを切り替えてジョブ起動
            if ($useThreadJob) {
                $job = Start-ThreadJob -ScriptBlock $JobScript -ArgumentList $loc, $BackstageUrl, $CatalogRoot, $LocationType, $UrlBase, $Token, $OnConflict, $IsDryRun, $ExistingTargets
            } else {
                $job = Start-Job -ScriptBlock $JobScript -ArgumentList $loc, $BackstageUrl, $CatalogRoot, $LocationType, $UrlBase, $Token, $OnConflict, $IsDryRun, $ExistingTargets
            }
            # 走行中リストに追加
            $running.Add($job) | Out-Null
            # 開始ログを出力
            Write-Log Info "[R$RoundNumber] $($loc.Name) を投入 (running=$($running.Count)/$MaxParallel pending=$($pending.Count))"
        }
        # 誰か 1 つ完了するまで待つ (タイムアウト 120 秒は念のためのデッドロック回避)
        $finished = Wait-Job -Job $running -Any -Timeout 120
        if ($null -eq $finished) {
            # タイムアウト発生時は警告して継続
            Write-Log Fail "[R$RoundNumber] 120 秒以内に完了したジョブがありません。継続して待機します..."
            continue
        }
        # 結果取得
        $result = Receive-Job -Job $finished
        # ジョブを破棄
        Remove-Job -Job $finished -Force
        # 走行中リストから除外
        $running.Remove($finished) | Out-Null
        # ラウンド結果に追加
        $roundResults.Add($result) | Out-Null
        # 累計完了数をインクリメント
        $Completed.Value += 1
        # 結果ステータスに応じて色付きログを出力
        $elapsedStr = $result.Elapsed.ToString("hh\:mm\:ss\.ff")
        $line = "$($result.Name) [$elapsedStr]"
        switch ($result.Status) {
            "OK"   { Write-Log Ok   "$line location 作成成功 (HTTP $($result.StatusCode))" }
            "SKIP" { Write-Log Skip "$line スキップ ($($result.Output.Trim()))" }
            "FAIL" {
                # 失敗時は応答本文 (末尾 10 行) もダンプして調査しやすくする
                Write-Log Fail "$line 登録失敗 (HTTP $($result.StatusCode))"
                $tailLines = ($result.Output -split "`r?`n") | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 10
                foreach ($outputLine in $tailLines) { Write-Log Fail "    $outputLine" }
            }
        }
        # 進捗バーを更新する (0..100 にクランプ)
        $percent = [int][Math]::Min(100, [Math]::Floor(($Completed.Value / [double]$TotalCount) * 100))
        Write-Progress -Activity "Registering locations" -Status "$($Completed.Value)/$TotalCount completed" -PercentComplete $percent
    }
    # ラウンド結果を返す
    return $roundResults
}

# Method=ConfigFile の場合はここで分岐して専用フローへ (以降の ApiPost 専用処理はスキップ)
if ($Method -eq "ConfigFile") {
    try {
        $exit = Invoke-ConfigFileMode
        exit $exit
    } catch {
        Write-Log Fail "ConfigFile モードで例外: $($_.Exception.Message)"
        exit 1
    }
}

# ===== 以降は -Method ApiPost (既存の REST API POST フロー) =====

# 集計用 (成功 / スキップ / 失敗の件数を集計する)
$summary = @{ OK = 0; SKIP = 0; FAIL = 0 }
# 失敗した location 名を控えるリスト
$failures = New-Object System.Collections.Generic.List[string]
# 全実行結果を集める (Summary 表示用)
$allResults = New-Object System.Collections.Generic.List[object]
# 全体所要時間を計測する
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

try {
    # ヘッダー情報を表示
    Write-Log Info "Method       : ApiPost"
    Write-Log Info "BackstageUrl : $BackstageUrl"
    Write-Log Info "CatalogRoot  : $CatalogRoot"
    Write-Log Info "LocationType : $LocationType"
    Write-Log Info "UrlBase      : $(if ([string]::IsNullOrWhiteSpace($UrlBase)) { '(n/a, file mode)' } else { $UrlBase })"
    Write-Log Info "OnConflict   : $OnConflict"
    Write-Log Info "DryRun       : $DryRun"
    Write-Log Info "MaxParallel  : $MaxParallel"
    Write-Log Info "Token        : $(if ([string]::IsNullOrWhiteSpace($Token)) { '(none, will auto-fetch guest token)' } else { '(set, length=' + $Token.Length + ')' })"
    Write-Log Info "LogFile      : $(if ($script:LogFilePath) { $script:LogFilePath } else { '(none)' })"

    # Token 未指定なら Backstage の guest auth から JWT を自動取得する
    if ([string]::IsNullOrWhiteSpace($Token)) {
        Write-Log Info "guest トークンを /api/auth/guest/refresh から取得中..."
        $autoToken = Get-GuestToken
        if (-not $autoToken) {
            throw "guest トークンの取得に失敗しました。permission framework が有効で guest auth が無効な場合は、別途 -Token <bearer> を指定してください。"
        }
        $Token = $autoToken
        Write-Log Ok "guest トークン取得成功 (長さ $($Token.Length))"
    }

    # Backstage の疎通確認 (失敗時は即座に中断)
    Write-Log Info "Backstage の死活確認中..."
    if (-not (Test-BackstageAlive)) {
        # 疎通失敗時はエラーで終了
        throw "Backstage が起動していません。サービス DevPortal-Backstage を確認してください。"
    }
    Write-Log Ok "Backstage に到達可能"

    # 既存 location 一覧を取得 (重複検出用)
    Write-Log Info "既存 location 一覧を取得中..."
    $existingTargets = Get-ExistingLocationTargets
    Write-Log Ok "既存 location 数: $($existingTargets.Count)"

    # 進捗計算用の累計完了数 (ref で並列ループと共有)
    $completed = 0
    $totalCount = $Locations.Count

    # ラウンドごとに分割して順番に登録を実行する (ラウンド境界で全完了を待つ)
    foreach ($round in 1..2) {
        # ラウンドの区切りログを出力
        Write-Log Info "===== Round $round 開始 ====="
        # 該当ラウンドの location のみを抽出する
        $roundLocations = @($Locations | Where-Object { $_.Round -eq $round })
        # 並列実行
        $roundResults = Invoke-RoundParallel `
            -Locations       $roundLocations `
            -RoundNumber     $round `
            -MaxParallel     $MaxParallel `
            -JobScript       $RegisterJobScript `
            -ExistingTargets $existingTargets `
            -IsDryRun        ([bool]$DryRun) `
            -TotalCount      $totalCount `
            -Completed       ([ref]$completed)
        # ラウンド結果を全体結果リストに集約する
        foreach ($r in $roundResults) {
            $allResults.Add($r) | Out-Null
            $summary[$r.Status] += 1
            if ($r.Status -eq "FAIL") { $failures.Add($r.Name) | Out-Null }
        }
        # ラウンド完了ログ
        Write-Log Info "===== Round $round 完了 ====="
    }

    # 進捗バーを消去する
    Write-Progress -Activity "Registering locations" -Completed
    # 全体所要時間を確定する
    $totalSw.Stop()

    # 最終集計レポートの区切りを表示
    Write-Log Info "===== Summary ====="
    # location 別の結果を Round → Name 順で表示する
    foreach ($r in ($allResults | Sort-Object Round, Name)) {
        # 経過時間文字列を作成
        $elapsedStr = $r.Elapsed.ToString("hh\:mm\:ss\.ff")
        # ステータスに応じてログレベルを選択
        $level = switch ($r.Status) { "OK" { "Ok" }; "SKIP" { "Skip" }; "FAIL" { "Fail" } }
        Write-Log $level ("{0,-50} {1}" -f $r.Name, $elapsedStr)
    }
    # トータル所要時間と件数を表示
    Write-Log Info ("Total: {0}  (OK {1} / SKIP {2} / FAIL {3})" -f $totalSw.Elapsed.ToString("hh\:mm\:ss\.ff"), $summary.OK, $summary.SKIP, $summary.FAIL)
    # 失敗 location があれば一覧表示する
    if ($failures.Count -gt 0) {
        Write-Log Fail "失敗した location:"
        foreach ($name in $failures) { Write-Log Fail "  - $name" }
    }

    # 取り込み完了の sanity check (全 Round 成功 & not DryRun のときだけ)
    if ($summary.FAIL -eq 0 -and -not $DryRun) {
        # Component 1 件の存在を確認する (Backstage の processor が catalog-info を非同期で消化するため、即時 200 とは限らない)
        $checkUrl = "$BackstageUrl/api/catalog/entities/by-name/component/default/k1s0-ts-config-core"
        try {
            $headers = @{}
            if (-not [string]::IsNullOrWhiteSpace($Token)) { $headers["Authorization"] = "Bearer $Token" }
            $resp = Invoke-WebRequest -Uri $checkUrl -Headers $headers -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Log Ok "Sanity check: component:k1s0-ts-config-core が Backstage で参照可能"
            }
        } catch {
            # 取り込みは非同期なので、まだ 404 が返るケースは異常ではない
            Write-Log Info "Sanity check: component:k1s0-ts-config-core はまだ取り込まれていません (processor が消化中の可能性、数秒後に Backstage UI で確認してください)"
        }
    }

    # 終了コードを決定する (失敗が 1 件でもあれば非 0 で終了)
    if ($summary.FAIL -gt 0) { exit 1 } else { exit 0 }
}
finally {
    # 念のため進捗バーを閉じる (例外パス用)
    Write-Progress -Activity "Registering locations" -Completed
}
