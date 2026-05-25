# Backstage の DB を :memory: から SQLite ファイル DB に切り替え、scaffolder workspace を永続化する
# 必ず「管理者として実行」した PowerShell から起動すること

# 厳格モード（未定義変数を弾く）を有効化
Set-StrictMode -Version Latest
# 任意のエラーで即座に停止
$ErrorActionPreference = "Stop"

# 対象ファイル・ディレクトリのパスを定数として宣言
$ConfigPath = "C:\ProgramData\DevPortal\backstage\app\app-config.yaml"
# scaffolder の sqlite ファイルを置くディレクトリ
$DbDir = "C:\ProgramData\DevPortal\backstage\data\db"
# 編集前バックアップの保存先（タイムスタンプ付き）
$BackupPath = "$ConfigPath.bak-{0:yyyyMMddHHmmss}" -f (Get-Date)
# Windows サービス名
$ServiceName = "DevPortal-Backstage"
# NSSM 実行ファイル（DevPortal 同梱）
$Nssm = "C:\ProgramData\DevPortal\bin\nssm.exe"

# 管理者権限チェック（昇格していなければここで停止）
$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object System.Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # 管理者でなければ明示的なエラーを出して終了
    throw "このスクリプトは管理者として実行してください"
}

# ステップ 1: サービスを停止（既に停止しているならスキップ）
Write-Host "[1/5] $ServiceName を停止します"
# サービスの現状を取得
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne "Stopped") {
    # NSSM 経由で停止（Stop-Service よりタイムアウトに強い）
    & $Nssm stop $ServiceName | Out-Null
    # 停止完了まで最大 30 秒待機
    (Get-Service -Name $ServiceName).WaitForStatus("Stopped", "00:00:30")
}

# ステップ 2: DB ディレクトリを作成（既存ならスキップ）
Write-Host "[2/5] DB ディレクトリ $DbDir を確保します"
if (-not (Test-Path $DbDir)) {
    # 親ディレクトリも含めて作成
    New-Item -ItemType Directory -Path $DbDir -Force | Out-Null
}

# ステップ 3: app-config.yaml をバックアップ
Write-Host "[3/5] app-config.yaml を $BackupPath にバックアップします"
Copy-Item -Path $ConfigPath -Destination $BackupPath -Force

# ステップ 4: database セクションを書き換え
Write-Host "[4/5] database セクションを SQLite ファイル DB 化します"
# 既存ファイルを UTF-8 で読み込む
$content = Get-Content -Path $ConfigPath -Raw -Encoding UTF8
# 置換前パターン（YAML の database セクション）
$old = @"
  database:
    client: better-sqlite3
    connection: ':memory:'
"@
# 置換後パターン（コメント付き・directory 指定）
$new = @"
  database:
    # SQLite (better-sqlite3) クライアントを使用
    client: better-sqlite3
    # connection.directory を指定するとプラグインごとに <directory>/<plugin>.sqlite が自動生成され、
    # scaffolder の tasks.workspace blob も再起動を超えて永続化される
    connection:
      directory: C:\ProgramData\DevPortal\backstage\data\db
"@
# 改行コードをファイル実体に合わせる（CRLF/LF 両対応）
$oldNormalized = $old -replace "`r`n", "`n"
$newNormalized = $new -replace "`r`n", "`n"
$contentNormalized = $content -replace "`r`n", "`n"
# 置換対象が存在するか検証
if (-not $contentNormalized.Contains($oldNormalized)) {
    # 既に置換済みかパターン不一致の場合は警告のみで停止
    throw "app-config.yaml の database セクションが想定パターンと一致しません。既に変更済みか、手動編集されている可能性があります。"
}
# 置換実行
$updated = $contentNormalized.Replace($oldNormalized, $newNormalized)
# CRLF に戻して書き戻し（Windows 標準）
$updatedCRLF = $updated -replace "`n", "`r`n"
# BOM 無し UTF-8 で書き出し（Backstage が読み込める形式）
[System.IO.File]::WriteAllText($ConfigPath, $updatedCRLF, (New-Object System.Text.UTF8Encoding($false)))

# ステップ 5: サービス再起動
Write-Host "[5/5] $ServiceName を起動します"
& $Nssm start $ServiceName | Out-Null
# 起動完了まで最大 60 秒待機
(Get-Service -Name $ServiceName).WaitForStatus("Running", "00:01:00")

# 完了表示
Write-Host ""
Write-Host "完了しました。30 秒ほど待ってから http://127.0.0.1:7007/ で動作確認してください。"
Write-Host "ログ: C:\ProgramData\DevPortal\backstage\app\backstage-stdout.log"
Write-Host "DB:  $DbDir"
