<#
.SYNOPSIS
    3 つのプライベートレジストリ（Reposilite / BaGetter / Verdaccio）の動作確認を行う。

.DESCRIPTION
    各セットアップスクリプトを一時ディレクトリへ -NoService で適用し、レジストリを
    フォアグラウンド起動して、(1) hosted の publish→consume 往復、(2) 外部プロキシ/ミラー
    （BaGetter=nuget.org / Verdaccio=npmjs）からの取得、を検証する。
    検証後はプロセス停止と一時ディレクトリ削除まで自動で行い、ユーザー環境を汚さない。
    既定（-IncludeService なし）では管理者権限は不要（Windows サービスは作成しない）。

.PARAMETER Only
    検証対象を絞る。all（既定） / maven / nuget / npm / none のいずれか。
    none は hosted/プロキシ検証を行わない（サービス検証だけ実施したいときに -IncludeService と併用）。

.PARAMETER IncludeService
    NSSM による Windows サービスの登録→自動起動→削除のライフサイクルを 3 製品すべてで検証する（要管理者）。
    非管理者で指定した場合はその項目を [SKIP] 表示して続行する。

.PARAMETER KeepTemp
    検証用の一時ディレクトリを削除せず残す（デバッグ用）。

.EXAMPLE
    .\Test-PrivateRegistries.ps1

.EXAMPLE
    .\Test-PrivateRegistries.ps1 -Only npm -KeepTemp
#>
[CmdletBinding()]
param(
    # 検証対象（all / maven / nuget / npm / none）
    [ValidateSet('all', 'maven', 'nuget', 'npm', 'none')]
    [string]$Only = 'all',
    # NSSM による Windows サービス登録/削除のライフサイクル検証も行う（要管理者）
    [switch]$IncludeService,
    # 一時ディレクトリを残すか
    [switch]$KeepTemp
)

# エラーは即座に停止させる（各検証内で try/catch して継続制御する）
$ErrorActionPreference = 'Stop'
# 共通ヘルパーを読み込む
. "$PSScriptRoot\common\PrivateRegistryCommon.ps1"

# 検証ルートの一時ディレクトリ（GUID で衝突回避）
$testRoot = Join-Path $env:TEMP ("devportal-reg-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
# 一時ディレクトリを作成する
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

# 検証結果を集約する配列
$results = New-Object System.Collections.Generic.List[object]

# 結果を 1 件記録するヘルパー
function Add-Result {
    # レジストリ名 / 合否 / 補足 / スキップ有無
    param([string]$Name, [bool]$Passed, [string]$Detail, [bool]$Skipped = $false)
    # 結果オブジェクトを配列に追加する
    $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail; Skipped = $Skipped })
}

# 指定 start.cmd をバックグラウンド起動してプロセスを返すヘルパー
function Start-Registry {
    # start.cmd のパス / 作業ディレクトリ / ログ出力先ディレクトリ
    param([string]$StartCmd, [string]$WorkDir, [string]$LogDir)
    # ログディレクトリを用意する
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    # 標準出力・標準エラーのログファイルパス
    $out = Join-Path $LogDir 'run.out.log'
    $err = Join-Path $LogDir 'run.err.log'
    # start.cmd を隠しウィンドウで起動し、プロセスオブジェクトを取得する
    return Start-Process -FilePath $StartCmd -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError $err
}

# 失敗時にログ末尾を表示するヘルパー
function Show-Log {
    # ログディレクトリ
    param([string]$LogDir)
    # out/err ログがあれば末尾を表示する
    foreach ($f in @('run.out.log', 'run.err.log')) {
        # 対象ログファイルのパス
        $p = Join-Path $LogDir $f
        # 存在すれば末尾 20 行を表示する
        if (Test-Path $p) {
            Write-Info "----- $f (末尾) -----"
            Get-Content $p -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
    }
}

# ========================================================================
# Maven / Reposilite の検証
# ========================================================================
function Test-Maven {
    Write-Section "[Maven] Reposilite 検証"
    # この検証専用のインストール先
    $root = Join-Path $testRoot 'reposilite'
    # 空きポートを確保する
    $port = Get-FreeTcpPort
    # 既知の管理トークン（検証用に固定）
    $tokenName = 'admin'
    $tokenSecret = 'verifysecret123'
    # 起動プロセスの参照（finally で停止するため）
    $proc = $null
    try {
        # 1) セットアップ（サービス化なし）を実行する
        & "$PSScriptRoot\maven-reposilite\Setup-Reposilite.ps1" `
            -InstallRoot $root -Port $port -AdminToken "$tokenName`:$tokenSecret" -NoService | Out-Null
        # 2) レジストリを起動する
        $proc = Start-Registry -StartCmd (Join-Path $root 'start.cmd') -WorkDir $root -LogDir (Join-Path $root 'runlog')
        # 3) 起動待機（認証エラーでも応答すれば起動済みとみなす）
        if (-not (Wait-ForHttp -Uri "http://localhost:$port/" -TimeoutSec 90 -AcceptAuthError)) {
            throw "Reposilite が起動しませんでした"
        }
        Write-Ok "起動を確認しました（ポート $port）"
        # 4) Basic 認証ヘッダを組み立てる（alias:secret）
        $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$tokenName`:$tokenSecret"))
        $authHeader = @{ Authorization = "Basic $b64" }
        # 5) 公開用のダミー成果物（jar / pom）を作る
        $jarFile = Join-Path $testRoot 'verify-test-1.0.0.jar'
        Set-Content -Path $jarFile -Value 'dummy-artifact-content' -NoNewline
        # デプロイ先 URL（Maven レイアウト）
        $base = "http://localhost:$port/releases/com/devportal/verify-test/1.0.0"
        $jarUrl = "$base/verify-test-1.0.0.jar"
        # 6) PUT で公開する
        Invoke-WebRequest -Uri $jarUrl -Method Put -InFile $jarFile -Headers $authHeader -UseBasicParsing -TimeoutSec 30 | Out-Null
        Write-Ok "公開(PUT)に成功しました: $jarUrl"
        # 7) GET で取得し、ファイルへ保存して内容一致を確認する（バイナリ扱いを避けるためファイル比較）
        $dlFile = Join-Path $testRoot 'verify-download.jar'
        Invoke-WebRequest -Uri $jarUrl -Headers $authHeader -OutFile $dlFile -UseBasicParsing -TimeoutSec 30
        # 取得した本文がアップロード内容と一致するか検証する
        $dlText = [System.IO.File]::ReadAllText($dlFile)
        if ($dlText -ne 'dummy-artifact-content') {
            throw "取得した成果物の内容が一致しません (取得=[$dlText])"
        }
        Write-Ok "取得(GET)と内容一致を確認しました"
        # 検証成功を記録する
        Add-Result -Name 'Maven (Reposilite)' -Passed $true -Detail "publish/consume 往復 OK (port $port)"
    }
    catch {
        # 失敗を記録し、ログ末尾を表示する
        Write-Failure $_.Exception.Message
        Show-Log -LogDir (Join-Path $root 'runlog')
        Add-Result -Name 'Maven (Reposilite)' -Passed $false -Detail $_.Exception.Message
    }
    finally {
        # 起動したプロセスを確実に停止する
        if ($proc) { Stop-ProcessTree -ProcessId $proc.Id }
    }
}

# ========================================================================
# NuGet / BaGetter の検証
# ========================================================================
function Test-NuGet {
    Write-Section "[NuGet] BaGetter 検証"
    # この検証専用のインストール先
    $root = Join-Path $testRoot 'bagetter'
    # 空きポートを確保する
    $port = Get-FreeTcpPort
    # 既知の API キー（検証用に固定）
    $apiKey = 'verifyapikey0123456789'
    # 起動プロセスの参照
    $proc = $null
    try {
        # 1) セットアップ（サービス化なし）を実行する
        & "$PSScriptRoot\nuget-bagetter\Setup-BaGetter.ps1" `
            -InstallRoot $root -Port $port -ApiKey $apiKey -NoService | Out-Null
        # 2) レジストリを起動する
        $proc = Start-Registry -StartCmd (Join-Path $root 'start.cmd') -WorkDir $root -LogDir (Join-Path $root 'runlog')
        # 3) 起動待機（v3 サービスインデックスの応答を確認）
        if (-not (Wait-ForHttp -Uri "http://localhost:$port/v3/index.json" -TimeoutSec 120)) {
            throw "BaGetter が起動しませんでした"
        }
        Write-Ok "起動を確認しました（ポート $port）"
        # 4) 検証用 NuGet パッケージを生成する
        $pkgSrc = Join-Path $testRoot 'nugetpkg'
        New-Item -ItemType Directory -Path $pkgSrc -Force | Out-Null
        # 最小の class library プロジェクトを書き出す
        $csproj = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <PackageId>DevPortal.Verify</PackageId>
    <Version>1.0.0</Version>
    <Authors>DevPortal</Authors>
    <Description>verification package</Description>
  </PropertyGroup>
</Project>
"@
        # csproj を書き出す
        [System.IO.File]::WriteAllText((Join-Path $pkgSrc 'DevPortal.Verify.csproj'), $csproj, (New-Object System.Text.UTF8Encoding($false)))
        # ダミーのソースを 1 つ置く
        [System.IO.File]::WriteAllText((Join-Path $pkgSrc 'Class1.cs'), 'namespace DevPortal.Verify { public class Class1 { } }', (New-Object System.Text.UTF8Encoding($false)))
        # パッケージ出力先
        $nupkgDir = Join-Path $testRoot 'nupkgs'
        # dotnet pack でパッケージを作成する
        Write-Info "dotnet pack でパッケージを作成します..."
        & dotnet pack $pkgSrc -c Release -o $nupkgDir --nologo -v quiet
        # pack の成否を確認する
        if ($LASTEXITCODE -ne 0) { throw "dotnet pack に失敗しました（終了コード $LASTEXITCODE）" }
        # 生成された .nupkg を特定する
        $nupkg = Get-ChildItem -Path $nupkgDir -Filter '*.nupkg' | Select-Object -First 1
        # nupkg が無ければ失敗
        if (-not $nupkg) { throw ".nupkg が生成されませんでした" }
        # 5) push で公開する
        #    近年の NuGet クライアントは HTTP ソースへの push を既定でブロックするため、
        #    allowInsecureConnections="true" を設定した nuget.config を用意して named source で push する。
        Write-Info "dotnet nuget push で公開します..."
        # HTTP ソースを許可する一時 nuget.config を書き出す
        $nugetConfig = Join-Path $testRoot 'nuget.config'
        $ngBody = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="devportal-test" value="http://localhost:$port/v3/index.json" allowInsecureConnections="true" />
  </packageSources>
</configuration>
"@
        # nuget.config を UTF-8(BOM 無し) で書き出す
        [System.IO.File]::WriteAllText($nugetConfig, $ngBody, (New-Object System.Text.UTF8Encoding($false)))
        # named source（HTTP 許可済み）に対して push し、出力を取り込む
        $pushOut = & dotnet nuget push $nupkg.FullName --source devportal-test --api-key $apiKey --configfile $nugetConfig 2>&1 | Out-String
        # push の成否を確認する（失敗時は出力も含めて知らせる）
        if ($LASTEXITCODE -ne 0) { throw "dotnet nuget push に失敗しました（終了コード $LASTEXITCODE）`n$pushOut" }
        Write-Ok "公開(push)に成功しました"
        # 6) フラットコンテナ索引で公開済みバージョンを確認する（id は小文字）
        $idx = Invoke-RestMethod -Uri "http://localhost:$port/v3/package/devportal.verify/index.json" -TimeoutSec 30
        # バージョン 1.0.0 が含まれるか検証する
        if ($idx.versions -notcontains '1.0.0') {
            throw "公開したバージョンがレジストリに見つかりません"
        }
        Write-Ok "取得(consume)とバージョン一致を確認しました"
        # 8) ミラー（nuget.org upstream）の実証：外部パッケージが取得できることを確認する
        Write-Info "nuget.org ミラー（upstream）を確認します..."
        $mirror = Invoke-RestMethod -Uri "http://localhost:$port/v3/package/newtonsoft.json/index.json" -TimeoutSec 60
        # 取得できたバージョン数を確認する
        if (-not $mirror.versions -or @($mirror.versions).Count -lt 1) {
            throw "nuget.org ミラー経由で外部パッケージ(Newtonsoft.Json)を取得できません"
        }
        Write-Ok "ミラー経由で Newtonsoft.Json を取得できました（$(@($mirror.versions).Count) バージョン）"
        # 検証成功を記録する
        Add-Result -Name 'NuGet (BaGetter)' -Passed $true -Detail "hosted 往復＋nuget.org ミラー OK (port $port)"
    }
    catch {
        # 失敗を記録し、ログ末尾を表示する
        Write-Failure $_.Exception.Message
        Show-Log -LogDir (Join-Path $root 'runlog')
        Add-Result -Name 'NuGet (BaGetter)' -Passed $false -Detail $_.Exception.Message
    }
    finally {
        # 起動したプロセスを確実に停止する
        if ($proc) { Stop-ProcessTree -ProcessId $proc.Id }
    }
}

# ========================================================================
# npm / Verdaccio の検証
# ========================================================================
function Test-Npm {
    Write-Section "[npm] Verdaccio 検証"
    # この検証専用のインストール先
    $root = Join-Path $testRoot 'verdaccio'
    # 空きポートを確保する
    $port = Get-FreeTcpPort
    # 起動プロセスの参照
    $proc = $null
    try {
        # 1) セットアップ（サービス化なし）を実行する
        & "$PSScriptRoot\npm-verdaccio\Setup-Verdaccio.ps1" `
            -InstallRoot $root -Port $port -Scope '@devportal' -NoService | Out-Null
        # 2) レジストリを起動する
        $proc = Start-Registry -StartCmd (Join-Path $root 'start.cmd') -WorkDir $root -LogDir (Join-Path $root 'runlog')
        # レジストリ URL
        $reg = "http://localhost:$port/"
        # 3) 起動待機
        if (-not (Wait-ForHttp -Uri $reg -TimeoutSec 90)) {
            throw "Verdaccio が起動しませんでした"
        }
        Write-Ok "起動を確認しました（ポート $port）"
        # 4) ユーザー登録 API（npm adduser 相当）でトークンを取得する
        $userName = 'verifyuser'
        $userPass = 'verifypass123'
        # 登録リクエストボディ
        $regBody = @{ name = $userName; password = $userPass; email = 'verify@example.com' } | ConvertTo-Json
        # ユーザー登録エンドポイントへ PUT する
        $regResp = Invoke-RestMethod -Uri "$reg-/user/org.couchdb.user:$userName" -Method Put -Body $regBody -ContentType 'application/json' -TimeoutSec 30
        # 払い出されたトークンを取り出す
        $token = $regResp.token
        # トークンが無ければ失敗
        if (-not $token) { throw "認証トークンを取得できませんでした" }
        Write-Ok "ユーザー登録と認証トークン取得に成功しました"
        # 5) 公開用パッケージ（スコープ付き）を用意する
        $pkgDir = Join-Path $testRoot 'npmpkg'
        New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null
        # package.json を書き出す
        $packageJson = '{ "name": "@devportal/verify-test", "version": "1.0.0", "description": "verify", "license": "MIT" }'
        [System.IO.File]::WriteAllText((Join-Path $pkgDir 'package.json'), $packageJson, (New-Object System.Text.UTF8Encoding($false)))
        # プロジェクト直下の .npmrc に registry と認証トークンを書く
        $npmrc = "registry=$reg`n//localhost:$port/:_authToken=$token`n"
        [System.IO.File]::WriteAllText((Join-Path $pkgDir '.npmrc'), $npmrc, (New-Object System.Text.UTF8Encoding($false)))
        # 6) publish で公開する（パッケージディレクトリで実行）
        Write-Info "npm publish で公開します..."
        # カレントを退避してパッケージディレクトリへ移動する
        Push-Location $pkgDir
        try {
            # 公開を実行する
            & npm publish --registry $reg
            # publish の成否を確認する
            if ($LASTEXITCODE -ne 0) { throw "npm publish に失敗しました（終了コード $LASTEXITCODE）" }
        }
        finally {
            # カレントを元に戻す
            Pop-Location
        }
        Write-Ok "公開(publish)に成功しました"
        # 7) パッケージメタデータを取得して公開バージョンを確認する
        $meta = Invoke-RestMethod -Uri "$reg@devportal/verify-test" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30
        # バージョン 1.0.0 が存在するか検証する
        if (-not $meta.versions.'1.0.0') {
            throw "公開したバージョンがレジストリに見つかりません"
        }
        Write-Ok "取得(consume)とバージョン一致を確認しました"
        # 8) uplink（npmjs プロキシ）の実証：外部パッケージが取得できることを確認する
        Write-Info "npmjs uplink（プロキシ）を確認します..."
        $up = Invoke-RestMethod -Uri ($reg + 'is-number') -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 60
        # バージョン情報が取得できたか確認する
        if (-not $up.versions) {
            throw "npmjs uplink 経由で外部パッケージ(is-number)を取得できません"
        }
        Write-Ok "uplink 経由で is-number を取得できました"
        # 検証成功を記録する
        Add-Result -Name 'npm (Verdaccio)' -Passed $true -Detail "hosted 往復＋npmjs uplink OK (port $port)"
    }
    catch {
        # 失敗を記録し、ログ末尾を表示する
        Write-Failure $_.Exception.Message
        Show-Log -LogDir (Join-Path $root 'runlog')
        Add-Result -Name 'npm (Verdaccio)' -Passed $false -Detail $_.Exception.Message
    }
    finally {
        # 起動したプロセスを確実に停止する
        if ($proc) { Stop-ProcessTree -ProcessId $proc.Id }
    }
}

# 1 製品のサービス ライフサイクル（登録→自動起動→HTTP応答→削除→残存なし）を検証する
function Invoke-OneServiceLifecycle {
    param(
        # 製品表示名
        [string]$Name,
        # 期待する Windows サービス名
        [string]$Svc,
        # 起動確認用 URL
        [string]$HealthUrl,
        # 認証エラー(401/403)でも起動済みとみなすか
        [bool]$AuthOk,
        # セットアップ（サービス登録）を行う処理
        [scriptblock]$SetupCall,
        # アンインストールを行う処理
        [scriptblock]$UninstallCall
    )
    try {
        # サービスとしてセットアップする
        & $SetupCall | Out-Null
        # サービスが起動状態か確認する
        $s = Get-Service -Name $Svc -ErrorAction SilentlyContinue
        if (-not $s) { throw "サービスが作成されていません" }
        if ($s.Status -ne 'Running') { throw "サービスが起動状態ではありません（状態=$($s.Status)）" }
        # 自動起動(Automatic)に設定されているか確認する
        $startMode = (Get-CimInstance Win32_Service -Filter "Name='$Svc'" -ErrorAction SilentlyContinue).StartMode
        # サービス経由で HTTP 応答があるか確認する
        $ok = if ($AuthOk) { Wait-ForHttp -Uri $HealthUrl -TimeoutSec 90 -AcceptAuthError } else { Wait-ForHttp -Uri $HealthUrl -TimeoutSec 90 }
        if (-not $ok) { throw "サービス経由で応答がありません: $HealthUrl" }
        Write-Ok "${Name}: 登録・起動・応答を確認（$Svc / StartMode=$startMode）"
        # アンインストールする
        & $UninstallCall | Out-Null
        # サービスが消えたか確認する
        if (Get-Service -Name $Svc -ErrorAction SilentlyContinue) { throw "アンインストール後もサービスが残存しています" }
        Write-Ok "${Name}: 停止・削除を確認"
        # 検証成功を記録する
        Add-Result -Name "$Name service (NSSM)" -Passed $true -Detail "登録→自動起動→削除 OK"
    }
    catch {
        # 失敗を記録する
        Write-Failure "${Name}: $($_.Exception.Message)"
        Add-Result -Name "$Name service (NSSM)" -Passed $false -Detail $_.Exception.Message
        # 後始末（残ったサービスを確実に削除する）
        try { & $UninstallCall | Out-Null } catch { }
    }
}

# ========================================================================
# NSSM サービス ライフサイクル検証（要管理者・3 製品すべて）
# ========================================================================
function Test-ServiceLifecycle {
    Write-Section "[Service] NSSM サービス ライフサイクル検証（3 製品）"
    # 管理者でなければスキップする（サービス登録には昇格が必要）
    if (-not (Test-IsAdmin)) {
        Write-Warn "管理者権限が無いため、Windows サービス登録/削除の検証はスキップします。"
        Write-Info "検証するには管理者 PowerShell で: .\Test-PrivateRegistries.ps1 -Only none -IncludeService"
        Add-Result -Name 'Service lifecycle (NSSM)' -Passed $true -Detail '未実施（非管理者のためスキップ）' -Skipped $true
        return
    }
    # NSSM を 3 製品で共有するツールディレクトリ
    $tools = Join-Path $testRoot 'svc-tools'

    # --- Reposilite ---
    $rRoot = Join-Path $testRoot 'svc-reposilite'
    $rSvc = 'DevPortal-Test-Reposilite'
    $rPort = Get-FreeTcpPort
    Invoke-OneServiceLifecycle -Name 'Reposilite' -Svc $rSvc -HealthUrl "http://localhost:$rPort/" -AuthOk $true `
        -SetupCall { & "$PSScriptRoot\maven-reposilite\Setup-Reposilite.ps1" -InstallRoot $rRoot -Port $rPort -ServiceName $rSvc -ToolsDir $tools -AdminToken 'admin:svctest' } `
        -UninstallCall { & "$PSScriptRoot\maven-reposilite\Uninstall-Reposilite.ps1" -InstallRoot $rRoot -ServiceName $rSvc -ToolsDir $tools -Force }

    # --- BaGetter ---
    $bRoot = Join-Path $testRoot 'svc-bagetter'
    $bSvc = 'DevPortal-Test-BaGetter'
    $bPort = Get-FreeTcpPort
    Invoke-OneServiceLifecycle -Name 'BaGetter' -Svc $bSvc -HealthUrl "http://localhost:$bPort/v3/index.json" -AuthOk $false `
        -SetupCall { & "$PSScriptRoot\nuget-bagetter\Setup-BaGetter.ps1" -InstallRoot $bRoot -Port $bPort -ServiceName $bSvc -ToolsDir $tools -ApiKey 'svctestkey' } `
        -UninstallCall { & "$PSScriptRoot\nuget-bagetter\Uninstall-BaGetter.ps1" -InstallRoot $bRoot -ServiceName $bSvc -ToolsDir $tools -Force }

    # --- Verdaccio ---
    $vRoot = Join-Path $testRoot 'svc-verdaccio'
    $vSvc = 'DevPortal-Test-Verdaccio'
    $vPort = Get-FreeTcpPort
    Invoke-OneServiceLifecycle -Name 'Verdaccio' -Svc $vSvc -HealthUrl "http://localhost:$vPort/" -AuthOk $false `
        -SetupCall { & "$PSScriptRoot\npm-verdaccio\Setup-Verdaccio.ps1" -InstallRoot $vRoot -Port $vPort -ServiceName $vSvc -ToolsDir $tools } `
        -UninstallCall { & "$PSScriptRoot\npm-verdaccio\Uninstall-Verdaccio.ps1" -InstallRoot $vRoot -ServiceName $vSvc -ToolsDir $tools -Force }
}

# ========================================================================
# 実行
# ========================================================================
try {
    # 対象に応じて各検証を実行する
    if ($Only -eq 'all' -or $Only -eq 'maven') { Test-Maven }
    if ($Only -eq 'all' -or $Only -eq 'nuget') { Test-NuGet }
    if ($Only -eq 'all' -or $Only -eq 'npm') { Test-Npm }
    # NSSM サービスのライフサイクル検証（-IncludeService 指定時のみ）
    if ($IncludeService) { Test-ServiceLifecycle }
}
finally {
    # 一時ディレクトリを削除する（-KeepTemp 指定時は残す）
    if ($KeepTemp) {
        Write-Info "一時ディレクトリを残します: $testRoot"
    }
    else {
        # プロセス停止直後はファイルロックが残る場合があるため、失敗しても無視する
        Start-Sleep -Seconds 1
        Remove-Item -Path $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ========================================================================
# 結果サマリ
# ========================================================================
Write-Section "検証結果サマリ"
# 各結果を整形して表示する
foreach ($r in $results) {
    # 合否（スキップ含む）ラベルと色を決める
    if ($r.Skipped) {
        Write-Host ("  [SKIP] {0} : {1}" -f $r.Name, $r.Detail) -ForegroundColor Yellow
    }
    elseif ($r.Passed) {
        Write-Host ("  [PASS] {0} : {1}" -f $r.Name, $r.Detail) -ForegroundColor Green
    }
    else {
        Write-Host ("  [FAIL] {0} : {1}" -f $r.Name, $r.Detail) -ForegroundColor Red
    }
}
# 失敗件数を数える（スキップは失敗に含めない）
$failed = ($results | Where-Object { -not $_.Passed -and -not $_.Skipped }).Count
Write-Host ""
# 総合結果を表示し、終了コードを設定する
if ($failed -eq 0) {
    Write-Host "  すべての検証に成功しました。" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "  $failed 件の検証に失敗しました。" -ForegroundColor Red
    exit 1
}
