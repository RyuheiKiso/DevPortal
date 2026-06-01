<#
.SYNOPSIS
    DevPortal プライベートレジストリ用スクリプトの共通ヘルパー関数群。

.DESCRIPTION
    Reposilite(Maven) / BaGetter(NuGet) / Verdaccio(npm) の各セットアップ・
    アンインストールスクリプトから dot-source して利用する共通処理を提供する。
    ログ出力・ダウンロード・HTTP 待機・ポート確認・NSSM による Windows サービス
    登録/解除などをまとめる。Windows PowerShell 5.1 / PowerShell 7 の両方で動作する。

.NOTES
    このファイル単体では何もしない。各スクリプトの先頭で次のように読み込む:
        . "$PSScriptRoot\..\common\PrivateRegistryCommon.ps1"
#>

# レジストリ群の既定インストールベースディレクトリ
$script:DevPortalRegistryBase = 'C:\devportal-registry'

# 旧 .NET / Windows PowerShell 5.1 でも HTTPS ダウンロードできるよう TLS 1.2 を有効化する
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ----------------------------------------------------------------------------
# ログ出力
# ----------------------------------------------------------------------------

# 処理の大見出しを出力する
function Write-Section {
    # 表示したい見出し文字列
    param([Parameter(Mandatory)][string]$Message)
    # 視認性のため空行と区切り線で囲んで強調表示する
    Write-Host ''
    Write-Host "==== $Message ====" -ForegroundColor Cyan
}

# 補足情報を出力する
function Write-Info {
    # 表示したいメッセージ
    param([Parameter(Mandatory)][string]$Message)
    # 通常情報はグレーで出力する
    Write-Host "  - $Message" -ForegroundColor Gray
}

# 成功メッセージを出力する
function Write-Ok {
    # 表示したいメッセージ
    param([Parameter(Mandatory)][string]$Message)
    # 成功は緑色で出力する
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

# 警告メッセージを出力する
function Write-Warn {
    # 表示したいメッセージ
    param([Parameter(Mandatory)][string]$Message)
    # 警告は黄色で出力する
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
}

# 失敗メッセージを出力する
function Write-Failure {
    # 表示したいメッセージ
    param([Parameter(Mandatory)][string]$Message)
    # 失敗は赤色で出力する
    Write-Host "  [NG] $Message" -ForegroundColor Red
}

# ----------------------------------------------------------------------------
# 権限・環境チェック
# ----------------------------------------------------------------------------

# 現在のプロセスが管理者権限で動作しているか判定する
function Test-IsAdmin {
    # 現在の Windows ユーザー情報を取得する
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    # プリンシパルに変換して権限を問い合わせる
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    # Administrator ロールを保持しているかどうかを返す
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 管理者権限が必須の処理の前に呼び、未昇格なら例外を投げる
function Assert-Admin {
    # 何のために管理者権限が必要かを示すラベル
    param([string]$Purpose = 'この操作')
    # 管理者でなければ分かりやすいメッセージで停止する
    if (-not (Test-IsAdmin)) {
        throw "$Purpose には管理者権限が必要です。PowerShell を「管理者として実行」して再度実行してください。"
    }
}

# 指定コマンドが PATH 上に存在するかを返す
function Test-CommandExists {
    # 確認したいコマンド名（例: node, dotnet）
    param([Parameter(Mandatory)][string]$Name)
    # Get-Command の成否で存在判定する（エラーは握りつぶす）
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# ----------------------------------------------------------------------------
# ネットワーク（ダウンロード・ポート・HTTP 待機）
# ----------------------------------------------------------------------------

# 指定 TCP ポートが既に使用中かどうかを判定する
function Test-TcpPortInUse {
    # 確認したいポート番号
    param([Parameter(Mandatory)][int]$Port)
    # アクティブな TCP 接続/リッスン情報からポート一致を探す
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    # 1 件でも見つかれば使用中とみなす
    return [bool]$listener
}

# テスト用に空いている TCP ポートを 1 つ取得する
function Get-FreeTcpPort {
    # ループバックでポート 0（任意の空きポート）を OS に割り当てさせる
    $tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    # リッスンを開始して実際のポート番号を確定させる
    $tcpListener.Start()
    # 割り当てられたポート番号を取り出す
    $port = $tcpListener.LocalEndpoint.Port
    # 取得した番号を返すためにリスナーを解放する
    $tcpListener.Stop()
    # 空きポート番号を返す
    return $port
}

# ファイルを HTTPS からダウンロードする（リトライ付き）
function Invoke-FileDownload {
    param(
        # ダウンロード元 URL
        [Parameter(Mandatory)][string]$Uri,
        # 保存先のフルパス
        [Parameter(Mandatory)][string]$OutFile,
        # 最大リトライ回数
        [int]$MaxRetry = 3
    )
    # 保存先ディレクトリが無ければ作成する
    $dir = Split-Path -Parent $OutFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # 試行回数のカウンタ
    $attempt = 0
    # 成功するか最大回数に達するまで繰り返す
    while ($true) {
        # 試行回数を加算する
        $attempt++
        try {
            # 進捗バーは大きなファイルで極端に遅くなるため抑止する
            $previousProgress = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            # 実ダウンロードを実行する
            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
            # 進捗設定を元に戻す
            $ProgressPreference = $previousProgress
            # ダウンロード成功を通知して抜ける
            Write-Info "ダウンロード完了: $Uri"
            return
        }
        catch {
            # 進捗設定を元に戻す
            $ProgressPreference = $previousProgress
            # 最大回数に達していたら例外を再送出する
            if ($attempt -ge $MaxRetry) {
                throw "ダウンロードに失敗しました（$attempt 回試行）: $Uri`n$($_.Exception.Message)"
            }
            # リトライ前に待機してから再試行する
            Write-Warn "ダウンロード失敗（$attempt/$MaxRetry 回目）。再試行します: $Uri"
            Start-Sleep -Seconds 2
        }
    }
}

# 指定 URL が HTTP 200 系を返すまで待機する（サービス起動確認に使う）
function Wait-ForHttp {
    param(
        # 監視する URL
        [Parameter(Mandatory)][string]$Uri,
        # タイムアウト秒数
        [int]$TimeoutSec = 60,
        # 認証が必要なエンドポイントでも到達確認できるよう、401/403 も「起動済み」とみなすか
        [switch]$AcceptAuthError
    )
    # 開始時刻を記録する
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    # タイムアウトまでポーリングする
    while ((Get-Date) -lt $deadline) {
        try {
            # 短いタイムアウトで HTTP リクエストを投げる
            $resp = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5
            # 2xx を受け取れたら起動済みとみなす
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
                return $true
            }
        }
        catch {
            # 認証エラーでも「サーバ自体は応答している」と判断できる場合は成功扱いにする
            if ($AcceptAuthError) {
                # 例外から HTTP ステータスコードを取り出す
                $status = $null
                if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
                # 401/403 ならサーバは生きているので起動済みとみなす
                if ($status -eq 401 -or $status -eq 403) { return $true }
            }
            # それ以外（接続拒否など）はまだ起動中なので待機を継続する
        }
        # 次のポーリングまで待機する
        Start-Sleep -Milliseconds 800
    }
    # タイムアウトした場合は失敗を返す
    return $false
}

# ----------------------------------------------------------------------------
# NSSM（Windows サービス化ラッパー）
# ----------------------------------------------------------------------------

# NSSM の実行ファイルパスを解決し、無ければダウンロードして用意する
function Resolve-NssmExe {
    param(
        # NSSM を配置するツールディレクトリ
        [Parameter(Mandatory)][string]$ToolsDir,
        # 取得する NSSM のバージョン
        [string]$Version = '2.24'
    )
    # 既に PATH に nssm があればそれを優先利用する
    $onPath = Get-Command nssm -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    # ツールディレクトリ内の配置先パスを決める
    $nssmExe = Join-Path $ToolsDir 'nssm.exe'
    # 既にダウンロード済みならそれを返す
    if (Test-Path $nssmExe) { return $nssmExe }
    # ツールディレクトリを作成する
    if (-not (Test-Path $ToolsDir)) { New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null }
    # NSSM 配布 zip のダウンロード先パス
    $zipPath = Join-Path $ToolsDir "nssm-$Version.zip"
    # 公式サイトから NSSM をダウンロードする（配布元 nssm.cc は不安定なことがあるためリトライ多め）
    Write-Info "NSSM をダウンロードします（Windows サービス化に使用）"
    Invoke-FileDownload -Uri "https://nssm.cc/release/nssm-$Version.zip" -OutFile $zipPath -MaxRetry 5
    # 展開用の一時ディレクトリ
    $extractDir = Join-Path $ToolsDir "nssm-$Version-extract"
    # 既存の展開先があれば消してから展開する
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    # zip を展開する
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    # 64bit 版の nssm.exe を取り出してツールディレクトリ直下へコピーする
    $srcExe = Join-Path $extractDir "nssm-$Version\win64\nssm.exe"
    Copy-Item -Path $srcExe -Destination $nssmExe -Force
    # 後片付け（zip と展開ディレクトリを削除する）
    Remove-Item $zipPath -Force
    Remove-Item $extractDir -Recurse -Force
    # 配置した nssm.exe のパスを返す
    return $nssmExe
}

# NSSM を使って Windows サービスを作成・起動する
function New-RegistryService {
    param(
        # nssm.exe のパス
        [Parameter(Mandatory)][string]$NssmExe,
        # 作成するサービス名
        [Parameter(Mandatory)][string]$ServiceName,
        # 起動する実行ファイル（java.exe / dotnet.exe / node.exe など）
        [Parameter(Mandatory)][string]$Application,
        # 実行ファイルに渡す引数文字列
        [Parameter(Mandatory)][string]$Arguments,
        # 作業ディレクトリ
        [Parameter(Mandatory)][string]$WorkingDirectory,
        # 標準出力/標準エラーのログ出力先ディレクトリ
        [Parameter(Mandatory)][string]$LogDir,
        # 追加で設定する環境変数（KEY=VALUE のハッシュテーブル）
        [hashtable]$Environment,
        # サービスの表示説明
        [string]$Description = ''
    )
    # サービス操作には管理者権限が必要
    Assert-Admin -Purpose 'Windows サービスの作成'
    # ログディレクトリを用意する
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    # 同名サービスが既に存在する場合は一旦削除して作り直す
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Warn "既存サービス '$ServiceName' を削除して作り直します"
        Remove-RegistryService -NssmExe $NssmExe -ServiceName $ServiceName
    }
    # サービスを新規作成する（実行ファイルと引数を登録する）
    Write-Info "サービス '$ServiceName' を作成します"
    & $NssmExe install $ServiceName $Application $Arguments | Out-Null
    # 作業ディレクトリを設定する
    & $NssmExe set $ServiceName AppDirectory $WorkingDirectory | Out-Null
    # OS 起動時に自動開始するよう設定する
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
    # 標準出力ログの出力先を設定する
    & $NssmExe set $ServiceName AppStdout (Join-Path $LogDir 'service.out.log') | Out-Null
    # 標準エラーログの出力先を設定する
    & $NssmExe set $ServiceName AppStderr (Join-Path $LogDir 'service.err.log') | Out-Null
    # ログの肥大化を防ぐためローテーションを有効化する
    & $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
    # 一定サイズ（約 10MB）でログをローテーションする
    & $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
    # 説明文があれば設定する
    if ($Description) { & $NssmExe set $ServiceName Description $Description | Out-Null }
    # 環境変数が指定されていればまとめて設定する
    if ($Environment -and $Environment.Count -gt 0) {
        # KEY=VALUE の配列に変換する
        $envPairs = $Environment.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
        # NSSM の AppEnvironmentExtra へ一括設定する
        & $NssmExe set $ServiceName AppEnvironmentExtra $envPairs | Out-Null
    }
    # サービスを起動する
    Write-Info "サービス '$ServiceName' を起動します"
    & $NssmExe start $ServiceName | Out-Null
}

# NSSM サービスを停止・削除する（存在しなければ何もしない）
function Remove-RegistryService {
    param(
        # nssm.exe のパス（無ければ sc.exe にフォールバック）
        [string]$NssmExe,
        # 削除するサービス名
        [Parameter(Mandatory)][string]$ServiceName
    )
    # 対象サービスを取得する
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    # 存在しなければ何もしない
    if (-not $svc) {
        Write-Info "サービス '$ServiceName' は存在しません（スキップ）"
        return
    }
    # サービス削除には管理者権限が必要
    Assert-Admin -Purpose 'Windows サービスの削除'
    # NSSM が使える場合は NSSM 経由で停止・削除する
    if ($NssmExe -and (Test-Path $NssmExe)) {
        # サービスを停止する
        & $NssmExe stop $ServiceName | Out-Null
        # 停止完了を少し待つ
        Start-Sleep -Seconds 2
        # サービス登録を確認なしで削除する
        & $NssmExe remove $ServiceName confirm | Out-Null
    }
    else {
        # NSSM が無い場合は標準コマンドで停止・削除する
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $ServiceName | Out-Null
    }
    # 削除完了を通知する
    Write-Ok "サービス '$ServiceName' を削除しました"
}

# プロセス（とその子プロセス）を確実に停止する（テストの後片付けに使う）
function Stop-ProcessTree {
    # 停止対象のプロセス ID
    param([Parameter(Mandatory)][int]$ProcessId)
    try {
        # taskkill でプロセスツリーごと強制終了する
        & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
    }
    catch {
        # 既に終了している場合などは無視する
    }
}
