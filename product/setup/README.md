# DevPortal セットアップツール

Verdaccio（社内 npm レジストリ）と BackStage（開発者ポータル）を Windows サービスとしてセットアップ・アンインストールするツールです。

CLI と GUI（Tauri + React）の両方から操作できます。

---

## 前提条件

以下のコマンドが PATH に存在している必要があります。

| コマンド | 用途 | インストール方法 |
|---|---|---|
| `node` (18 LTS+) | BackStage・Verdaccio の実行環境 | https://nodejs.org/ |
| `npm` | Verdaccio のインストール | Node.js に同梱 |
| `npx` | BackStage 雛形生成 | Node.js に同梱 |
| `yarn` | BackStage のパッケージ管理 | `corepack enable` または https://yarnpkg.com/ |
| `git` | BackStage の初期化 | https://git-scm.com/ |

---

## 初回セットアップ（開発者向け）

**NSSM（Non-Sucking Service Manager）は `install` / `uninstall` / `service` コマンドの初回実行時に自動取得されます。** PowerShell スクリプトの実行は不要です。

- 取得先: `https://nssm.cc/release/nssm-2.24.zip`
- キャッシュ先: `%ProgramData%\DevPortal\bin\nssm.exe`（2 回目以降はキャッシュを使用）
- SHA-256 検証付きで安全に取得します。

**オフライン環境・プロキシ環境の場合**:

NSSM を手動で入手して `DEVPORTAL_NSSM_PATH` 環境変数にフルパスを設定してください。

```powershell
$env:DEVPORTAL_NSSM_PATH = "D:\tools\nssm.exe"
cargo run -p cli -- install verdaccio
```

---

1. Rust ツールチェーンをインストールする: https://rustup.rs/

---

## CLI の使い方

### 前提確認

```powershell
cargo run -p cli -- doctor
```

### インストール

```powershell
# 管理者 PowerShell で実行（サービス登録に管理者権限が必要）
cargo run -p cli -- install verdaccio
cargo run -p cli -- install backstage
cargo run -p cli -- install all
```

### アンインストール

```powershell
# データを保持してアンインストール
cargo run -p cli -- uninstall verdaccio --keep-data
# データごと完全削除
cargo run -p cli -- uninstall backstage
```

### 状態確認

```powershell
cargo run -p cli -- status
cargo run -p cli -- status verdaccio
```

### サービス制御

```powershell
cargo run -p cli -- service start verdaccio
cargo run -p cli -- service stop backstage
cargo run -p cli -- service restart verdaccio
cargo run -p cli -- service logs verdaccio --tail 100
```

### JSON 出力（CI・スクリプト連携）

```powershell
cargo run -p cli -- install verdaccio --json
```

---

## GUI の使い方

```powershell
cd gui
npm install
npm run tauri dev
```

ダッシュボードで各コンポーネントの状態確認・インストール・アンインストール・サービス制御が行えます。

> **注意**: サービス登録操作（インストール・アンインストール・サービス開始/停止）は内部的に管理者権限で実行されます。UAC ダイアログが表示された場合は「はい」を選択してください。

---

## データの配置場所

| パス | 内容 |
|---|---|
| `%ProgramData%\DevPortal\verdaccio\app\` | Verdaccio 本体（node_modules） |
| `%ProgramData%\DevPortal\verdaccio\storage\` | npm パッケージのストレージ |
| `%ProgramData%\DevPortal\verdaccio\config.yaml` | Verdaccio 設定ファイル |
| `%ProgramData%\DevPortal\verdaccio\logs\` | Verdaccio のログ |
| `%ProgramData%\DevPortal\backstage\app\` | BackStage アプリケーション |
| `%ProgramData%\DevPortal\backstage\logs\` | BackStage のログ |
| `%ProgramData%\DevPortal\config\setup.toml` | セットアップ設定ファイル |

---

## Windows サービス名

| コンポーネント | サービス名 | 表示名 |
|---|---|---|
| Verdaccio | `DevPortal.Verdaccio` | DevPortal - Verdaccio (npm registry) |
| BackStage | `DevPortal.Backstage` | DevPortal - Backstage (developer portal) |

---

## プロジェクト構成

```
product/setup/
├─ scripts/
│  ├─ fetch-nssm.ps1        # NSSM 取得スクリプト
│  └─ dev-bootstrap.ps1     # 開発者用初期セットアップ
├─ resources/nssm/win64/    # nssm.exe 配置先（.gitignore 対象）
├─ shared/                  # CLI/GUI 共通ロジック（Rust）
├─ cli/                     # コマンドラインツール（Rust）
└─ gui/                     # デスクトップ GUI（Tauri + React）
```

---

## トラブルシューティング

### Windows Defender / セキュリティソフトによる干渉

`%ProgramData%\DevPortal\` を除外リストに追加することを推奨します。

### BackStage の初回起動に時間がかかる

`yarn install` + TypeScript コンパイルに数分〜十数分かかります。ログ（`%ProgramData%\DevPortal\backstage\logs\stdout.log`）でリアルタイムに確認できます。

### Node.js のバージョン変更後にサービスが動かない

インストール時の `node.exe` の絶対パスをサービスに登録しています。Node.js のパスが変わった場合は `uninstall` してから `install` を再実行してください。
