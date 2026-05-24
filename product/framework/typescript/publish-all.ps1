<#
.SYNOPSIS
    product/framework/typescript 配下の全 npm パッケージを Verdaccio に一括 publish する。

.DESCRIPTION
    setup GUI で導入された Verdaccio (http://localhost:4873, htpasswd 認証) に対して、
    config / logger / http / notification 配下の core → react / react-native の順で
    依存関係を壊さないように publish を実施する。
    同一バージョンが既に存在する場合はスキップし、ラウンド内では並列実行する。

.PARAMETER Registry
    publish 先 Verdaccio の URL (既定: http://localhost:4873)。

.PARAMETER User
    Verdaccio htpasswd のユーザー名 (既定: admin)。

.PARAMETER Password
    Verdaccio htpasswd のパスワード (既定: admin)。

.PARAMETER DryRun
    指定すると npm publish に --dry-run を付与し、実際の publish は行わない。

.PARAMETER MaxParallel
    1 ラウンド内で並行して publish するパッケージ数 (既定: 4)。1 にすると逐次実行。

.PARAMETER LogFile
    指定したパスにタイムスタンプ付きで全イベントを追記出力する。
    既存ファイルがあれば末尾に追記される。指定が無ければファイル出力は行わない。
#>
# スクリプトパラメータ定義 (PowerShell 標準の CmdletBinding を有効化してパイプライン/共通パラメータをサポート)
[CmdletBinding()]
param(
    # publish 先レジストリ URL (Verdaccio のデフォルト 4873 ポート)
    [string]$Registry = "http://localhost:4873",
    # htpasswd 認証用のユーザー名 (Verdaccio のシード値)
    [string]$User = "admin",
    # htpasswd 認証用のパスワード (Verdaccio のシード値)
    [string]$Password = "admin",
    # 動作確認用の dry-run フラグ (指定すると実際には publish しない)
    [switch]$DryRun,
    # ラウンド内並列度 (既定 4。1 にすると Phase 1 と同じ逐次実行)
    [ValidateRange(1, 16)][int]$MaxParallel = 4,
    # ログファイル出力先 (指定があればコンソール出力と同じ内容を追記)
    [string]$LogFile = ""
)

# 想定外の例外が発生したら即座にスクリプトを停止する
$ErrorActionPreference = "Stop"

# スクリプト自身のあるディレクトリ (product/framework/typescript) の絶対パスを取得する
$ScriptRoot = $PSScriptRoot
# スクリプト実行中の作業ディレクトリを必ずパッケージ群のルートに固定する
Set-Location -Path $ScriptRoot

# ログファイルパスをスクリプトスコープで Write-Log から参照できるよう保持する
$script:LogFilePath = if ([string]::IsNullOrWhiteSpace($LogFile)) { $null } else { [System.IO.Path]::GetFullPath($LogFile) }

# publish 対象パッケージ一覧 (Round 1 が core 群、Round 2 が react / react-native 群)
$Packages = @(
    # core パッケージ群 (react / react-native の依存元なので必ず先行 publish)
    [pscustomobject]@{ Name = "@k1s0-ts-config/core";       Path = "config\core";              Round = 1 }
    [pscustomobject]@{ Name = "@k1s0-ts-logger/core";       Path = "logger\core";              Round = 1 }
    [pscustomobject]@{ Name = "@k1s0-ts-http/core";         Path = "http\core";                Round = 1 }
    [pscustomobject]@{ Name = "@k1s0-ts-notification/core"; Path = "notification\core";        Round = 1 }
    # react / react-native パッケージ群 (core を file:../core で参照しているため後発で publish)
    [pscustomobject]@{ Name = "@k1s0-ts-config/react";              Path = "config\react";             Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-config/react-native";       Path = "config\react-native";      Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-logger/react";              Path = "logger\react";             Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-logger/react-native";       Path = "logger\react-native";      Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-http/react";                Path = "http\react";               Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-http/react-native";         Path = "http\react-native";        Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-notification/react";        Path = "notification\react";       Round = 2 }
    [pscustomobject]@{ Name = "@k1s0-ts-notification/react-native"; Path = "notification\react-native";Round = 2 }
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
        # BOM なし UTF-8 で append する (テキストエディタでの可読性確保)
        [System.IO.File]::AppendAllText($script:LogFilePath, $line, [System.Text.UTF8Encoding]::new($false))
    }
}

# Verdaccio の死活確認 (/-/ping エンドポイント)
function Test-RegistryAlive {
    # ping エンドポイントの URL を構築する
    $pingUrl = "$Registry/-/ping"
    try {
        # Invoke-WebRequest で HTTP GET を実行し、応答コードを確認する
        $resp = Invoke-WebRequest -Uri $pingUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        # 200 OK 以外は疎通失敗とみなす
        if ($resp.StatusCode -ne 200) {
            # 失敗詳細をログに残してから false を返す
            Write-Log Fail "Verdaccio ping が異常応答 (HTTP $($resp.StatusCode))"
            return $false
        }
        # 疎通成功
        return $true
    } catch {
        # 例外発生時は到達不能とみなしてエラー詳細をログに残す
        Write-Log Fail "Verdaccio に到達できません ($pingUrl): $($_.Exception.Message)"
        return $false
    }
}

# 一時 .npmrc を作成して認証情報 (_auth Basic) を書き込み、ファイルパスを返す
# Verdaccio の htpasswd 認証では、_auth=Base64(user:password) を npm publish 時に Basic ヘッダーとして送れば動作する。
# JWT を事前取得する PUT エンドポイントは Verdaccio のバージョンによって 409 を返すケースがあるため、より枯れた _auth 形式を採用する。
function New-TempNpmrc {
    param(
        # Verdaccio htpasswd のユーザー名
        [string]$User,
        # Verdaccio htpasswd のパスワード
        [string]$Password
    )
    # Verdaccio URL からスキーマ部分を取り除いて //host:port/ 形式に整形する (npm の auth 設定形式)
    $registryKey = ($Registry -replace '^https?:', '').TrimEnd('/') + '/'
    # Basic 認証用に <user>:<password> を base64 エンコードする
    $auth = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("${User}:${Password}"))
    # 一意な一時ファイル名を生成する (.ini 拡張子で配置)
    $tempPath = Join-Path -Path $env:TEMP -ChildPath ("npmrc-publish-" + [Guid]::NewGuid().ToString("N") + ".ini")
    # .npmrc に書き出す内容を組み立てる (registry, _auth, always-auth, email の 4 行)
    # email は publish 時に npm から要求されるダミー値 (Verdaccio 側で検証されない)
    $content = @(
        "registry=$Registry/",
        "${registryKey}:_auth=$auth",
        "${registryKey}:always-auth=true",
        "email=devportal@example.local"
    ) -join "`r`n"
    # BOM なし UTF-8 で書き出して npm 側のパース失敗を防ぐ
    [System.IO.File]::WriteAllText($tempPath, $content, [System.Text.UTF8Encoding]::new($false))
    # 生成した一時 .npmrc の絶対パスを返す
    return $tempPath
}

# ジョブ内で実行する publish 処理本体 (親スコープに依存しない自己完結スクリプトブロック)
$PublishJobScript = {
    param(
        # 対象パッケージ情報 (Name / Path / Round を持つオブジェクト)
        $Package,
        # publish 先レジストリ URL
        $Registry,
        # スクリプトのルートディレクトリ絶対パス
        $ScriptRoot,
        # 一時 .npmrc のパス (子プロセス / 子ランスペースに継承させる)
        $TempNpmrc,
        # dry-run モードかどうかを示す bool
        $IsDryRun
    )
    # ジョブ内でも npm が一時 .npmrc を参照できるよう環境変数をセットする
    $env:NPM_CONFIG_USERCONFIG = $TempNpmrc
    # パッケージのフルパス
    $packageDir = Join-Path -Path $ScriptRoot -ChildPath $Package.Path
    # package.json のパス
    $packageJsonPath = Join-Path -Path $packageDir -ChildPath "package.json"
    # 計測用ストップウォッチを開始する
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    # 結果オブジェクトを初期化する
    $result = [pscustomobject]@{
        Name     = $Package.Name
        Path     = $Package.Path
        Round    = $Package.Round
        Version  = $null
        Status   = "FAIL"
        Elapsed  = [TimeSpan]::Zero
        ExitCode = -1
        Output   = ""
    }
    try {
        # ディレクトリ存在確認 (見つからなければ即 FAIL)
        if (-not (Test-Path -Path $packageDir -PathType Container)) {
            $result.Output = "directory not found: $packageDir"
            return $result
        }
        # package.json から version を読み取る (BOM 無し UTF-8 を強制してデコード化けを防ぐ)
        # Windows PowerShell 5.1 のデフォルト読み込みは ANSI (cp932) のため、日本語を含む JSON が化けて ConvertFrom-Json が失敗する
        $jsonText = [System.IO.File]::ReadAllText($packageJsonPath, [System.Text.UTF8Encoding]::new($false))
        $version = ($jsonText | ConvertFrom-Json).version
        $result.Version = $version
        # 既に同一バージョンが publish 済みかチェック (終了コード 0 なら存在)
        $null = & npm view "$($Package.Name)@$version" version --registry $Registry --json 2>$null
        if ($LASTEXITCODE -eq 0) {
            # 既存バージョンは SKIP として扱う
            $result.Status = "SKIP"
            $result.Output = "already published"
            return $result
        }
        # 対象パッケージのディレクトリに移動 (finally で必ず戻す)
        Push-Location -Path $packageDir
        try {
            # npm publish の引数を組み立てる
            $publishArgs = @("publish", "--registry", $Registry, "--access", "restricted")
            # dry-run フラグが指定されていれば --dry-run を追加
            if ($IsDryRun) { $publishArgs += "--dry-run" }
            # npm publish を実行 (stdout/stderr を文字列としてキャプチャ)
            $output = (& npm @publishArgs 2>&1 | Out-String)
            $exitCode = $LASTEXITCODE
            $result.Output = $output
            $result.ExitCode = $exitCode
            # 終了コードによって結果を分岐する
            if ($exitCode -eq 0) {
                # 正常終了
                $result.Status = "OK"
            } else {
                # 失敗時、競合 (409) で別ジョブが先に publish 済みになった可能性を再確認
                $null = & npm view "$($Package.Name)@$version" version --registry $Registry --json 2>$null
                if ($LASTEXITCODE -eq 0) {
                    $result.Status = "SKIP"
                    $result.Output = "concurrent publish detected (becomes SKIP)"
                } else {
                    $result.Status = "FAIL"
                }
            }
        } finally {
            # 元のディレクトリに戻る
            Pop-Location
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
        # 当該ラウンドの対象パッケージ配列
        [array]$Packages,
        # ラウンド番号 (ログ表示用)
        [int]$RoundNumber,
        # 並列度
        [int]$MaxParallel,
        # ジョブの ScriptBlock
        [scriptblock]$JobScript,
        # 一時 .npmrc のパス (ジョブに渡す)
        [string]$TempNpmrc,
        # dry-run かどうか
        [bool]$IsDryRun,
        # 全体総数 (進捗表示用)
        [int]$TotalCount,
        # 累計完了数 (参照渡しで親が共有)
        [ref]$Completed
    )
    # Start-ThreadJob が利用可能なら使用、無ければ Start-Job にフォールバックする
    $useThreadJob = [bool](Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)
    # 未投入パッケージのキュー
    $pending = [System.Collections.Generic.Queue[object]]::new()
    # キューに全パッケージを積む
    foreach ($pkg in $Packages) { $pending.Enqueue($pkg) | Out-Null }
    # 走行中ジョブ管理用リスト
    $running = New-Object System.Collections.Generic.List[object]
    # ラウンド全体の結果集約リスト
    $roundResults = New-Object System.Collections.Generic.List[object]
    # キューが空、かつ走行中ジョブも 0 になるまでループ
    while ($pending.Count -gt 0 -or $running.Count -gt 0) {
        # 空きスロットがある限り新規ジョブを投入する
        while ($pending.Count -gt 0 -and $running.Count -lt $MaxParallel) {
            $pkg = $pending.Dequeue()
            # ThreadJob か通常 Job かを切り替えてジョブ起動
            if ($useThreadJob) {
                $job = Start-ThreadJob -ScriptBlock $JobScript -ArgumentList $pkg, $Registry, $ScriptRoot, $TempNpmrc, $IsDryRun
            } else {
                $job = Start-Job -ScriptBlock $JobScript -ArgumentList $pkg, $Registry, $ScriptRoot, $TempNpmrc, $IsDryRun
            }
            # 走行中リストに追加
            $running.Add($job) | Out-Null
            # 開始ログを出力 (進捗カウンタはまだ更新しない)
            Write-Log Info "[R$RoundNumber] $($pkg.Name) を投入 (running=$($running.Count)/$MaxParallel pending=$($pending.Count))"
        }
        # 誰か 1 つ完了するまで待つ (タイムアウト 600 秒は念のためのデッドロック回避)
        $finished = Wait-Job -Job $running -Any -Timeout 600
        if ($null -eq $finished) {
            # タイムアウト発生時は警告して継続 (実際には ThreadJob/Job のハング検出は難しいので情報出しのみ)
            Write-Log Fail "[R$RoundNumber] 600 秒以内に完了したジョブがありません。継続して待機します..."
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
        $line = "$($result.Name)@$($result.Version) [$elapsedStr]"
        switch ($result.Status) {
            "OK"   { Write-Log Ok   "$line publish 成功" }
            "SKIP" { Write-Log Skip "$line スキップ ($($result.Output.Trim()))" }
            "FAIL" {
                # 失敗時は npm の出力 (末尾 15 行) もダンプして調査しやすくする
                Write-Log Fail "$line publish 失敗 (npm exit=$($result.ExitCode))"
                $tailLines = ($result.Output -split "`r?`n") | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 15
                foreach ($outputLine in $tailLines) { Write-Log Fail "    $outputLine" }
            }
        }
        # 進捗バーを更新する (0..100 にクランプ)
        $percent = [int][Math]::Min(100, [Math]::Floor(($Completed.Value / [double]$TotalCount) * 100))
        Write-Progress -Activity "Publishing packages" -Status "$($Completed.Value)/$TotalCount completed" -PercentComplete $percent
    }
    # ラウンド結果を返す
    return $roundResults
}

# 集計用 (成功 / スキップ / 失敗の件数を集計する)
$summary = @{ OK = 0; SKIP = 0; FAIL = 0 }
# 失敗したパッケージ名を控えるリスト (最後にまとめて表示するため)
$failures = New-Object System.Collections.Generic.List[string]
# 一時 .npmrc のパス (finally でクリーンアップ)
$tempNpmrc = $null
# 退避する元の NPM_CONFIG_USERCONFIG (スクリプト終了時に元に戻す)
$previousNpmConfig = $env:NPM_CONFIG_USERCONFIG
# 全実行結果を集める (Summary 表示用)
$allResults = New-Object System.Collections.Generic.List[object]
# 全体所要時間を計測する
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

try {
    # ヘッダー情報を表示
    Write-Log Info "Registry    : $Registry"
    Write-Log Info "User        : $User"
    Write-Log Info "DryRun      : $DryRun"
    Write-Log Info "MaxParallel : $MaxParallel"
    Write-Log Info "LogFile     : $(if ($script:LogFilePath) { $script:LogFilePath } else { '(none)' })"

    # Verdaccio の疎通確認 (失敗時は即座に中断)
    Write-Log Info "Verdaccio の死活確認中..."
    if (-not (Test-RegistryAlive)) {
        # 疎通失敗時はエラーで終了
        throw "Verdaccio が起動していません。サービス DevPortal-Verdaccio を確認してください。"
    }
    Write-Log Ok "Verdaccio に到達可能"

    # 一時 .npmrc を作成しユーザー既存設定を汚染しないようにする
    # (Verdaccio の htpasswd 認証は _auth=Base64(user:password) を Basic ヘッダーで送る形式を採用)
    $tempNpmrc = New-TempNpmrc -User $User -Password $Password
    Write-Log Ok "認証情報を一時 .npmrc に設定 (Basic auth, user=$User)"
    Write-Log Info "一時 .npmrc を作成: $tempNpmrc"
    # 環境変数で npm に一時 .npmrc を強制使用させる (子ジョブにも継承)
    $env:NPM_CONFIG_USERCONFIG = $tempNpmrc

    # 進捗計算用の累計完了数 (ref で並列ループと共有)
    $completed = 0
    $totalCount = $Packages.Count

    # ラウンドごとに分割して順番に publish を実行する (ラウンド境界で全完了を待つ)
    foreach ($round in 1..2) {
        # ラウンドの区切りログを出力
        Write-Log Info "===== Round $round 開始 ====="
        # 該当ラウンドのパッケージのみを抽出する
        $roundPackages = @($Packages | Where-Object { $_.Round -eq $round })
        # 並列実行 (進捗カウンタは ref で渡す)
        $roundResults = Invoke-RoundParallel `
            -Packages     $roundPackages `
            -RoundNumber  $round `
            -MaxParallel  $MaxParallel `
            -JobScript    $PublishJobScript `
            -TempNpmrc    $tempNpmrc `
            -IsDryRun     ([bool]$DryRun) `
            -TotalCount   $totalCount `
            -Completed    ([ref]$completed)
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
    Write-Progress -Activity "Publishing packages" -Completed
    # 全体所要時間を確定する
    $totalSw.Stop()

    # 最終集計レポートの区切りを表示
    Write-Log Info "===== Summary ====="
    # パッケージ別の結果を Round → Name 順で表示する
    foreach ($r in ($allResults | Sort-Object Round, Name)) {
        # 経過時間文字列を作成
        $elapsedStr = $r.Elapsed.ToString("hh\:mm\:ss\.ff")
        # ステータスに応じてログレベルを選択
        $level = switch ($r.Status) { "OK" { "Ok" }; "SKIP" { "Skip" }; "FAIL" { "Fail" } }
        Write-Log $level ("{0,-44} {1}" -f "$($r.Name)@$($r.Version)", $elapsedStr)
    }
    # トータル所要時間と件数を表示
    Write-Log Info ("Total: {0}  (OK {1} / SKIP {2} / FAIL {3})" -f $totalSw.Elapsed.ToString("hh\:mm\:ss\.ff"), $summary.OK, $summary.SKIP, $summary.FAIL)
    # 失敗パッケージがあれば一覧表示する
    if ($failures.Count -gt 0) {
        Write-Log Fail "失敗したパッケージ:"
        foreach ($name in $failures) { Write-Log Fail "  - $name" }
    }
    # 終了コードを決定する (失敗が 1 件でもあれば非 0 で終了)
    if ($summary.FAIL -gt 0) { exit 1 } else { exit 0 }
}
finally {
    # 念のため進捗バーを閉じる (例外パス用)
    Write-Progress -Activity "Publishing packages" -Completed
    # 退避していた NPM_CONFIG_USERCONFIG を元の値に戻す
    if ($null -eq $previousNpmConfig) {
        # 元々未設定だった場合は環境変数を削除する
        Remove-Item Env:NPM_CONFIG_USERCONFIG -ErrorAction SilentlyContinue
    } else {
        # 元々値があった場合はその値で復元する
        $env:NPM_CONFIG_USERCONFIG = $previousNpmConfig
    }
    # 一時 .npmrc を削除する (機微情報である auth token を残さない)
    if ($tempNpmrc -and (Test-Path -Path $tempNpmrc)) {
        # 失敗しても致命的ではないため -ErrorAction SilentlyContinue で握りつぶす
        Remove-Item -Path $tempNpmrc -Force -ErrorAction SilentlyContinue
    }
}
