# DevPortal セットアップツール

Verdaccio（社内 npm レジストリ）、Backstage（開発者ポータル）、BaGet（社内 NuGet レジストリ）を Windows サービスとしてセットアップ・アンインストールするツールです。

CLI と GUI（Tauri + React）の両方から操作できます。

---

## 前提条件

以下のコマンドが PATH に存在している必要があります。

| コマンド | 用途 | インストール方法 |
|---|---|---|
| `node` (18 LTS+) | Backstage・Verdaccio の実行環境 | https://nodejs.org/ |
| `npm` | Verdaccio のインストール | Node.js に同梱 |
| `npx` | Backstage 雛形生成 | Node.js に同梱 |
| `yarn` | Backstage のパッケージ管理 | `corepack enable` または https://yarnpkg.com/ |
| `git` | Backstage の初期化 | https://git-scm.com/ |

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

BaGet の ZIP を手動で入手して使う場合は `DEVPORTAL_BAGET_PATH` 環境変数にフルパスを設定してください。

```powershell
$env:DEVPORTAL_BAGET_PATH = "D:\tools\BaGet.zip"
cargo run -p cli -- install baget
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
cargo run -p cli -- install baget
cargo run -p cli -- install all

# ポートを指定する場合
cargo run -p cli -- install baget --baget-port 5001

# Backstage を build モードでインストールする場合
cargo run -p cli -- install backstage --backstage-mode build
```

### アンインストール

```powershell
# データを保持してアンインストール
cargo run -p cli -- uninstall verdaccio --keep-data
# データごと完全削除
cargo run -p cli -- uninstall backstage
cargo run -p cli -- uninstall baget
```

### 状態確認

```powershell
cargo run -p cli -- status
cargo run -p cli -- status verdaccio
cargo run -p cli -- status baget
```

### サービス制御

```powershell
cargo run -p cli -- service start verdaccio
cargo run -p cli -- service stop backstage
cargo run -p cli -- service restart baget
cargo run -p cli -- service logs baget --tail 100
```

### 設定

```powershell
cargo run -p cli -- config show
cargo run -p cli -- config set baget.port 5001
cargo run -p cli -- config set baget.version 0.4.0-preview2
cargo run -p cli -- config set backstage.mode build
```

Backstage の起動モードは `dev` / `build` を選択できます。`dev` は `yarn start` でフロントエンド開発サーバーとバックエンドを起動し、`build` はフロントエンド・バックエンドをビルドして production backend から Web UI を配信します。

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
| `%ProgramData%\DevPortal\backstage\app\` | Backstage アプリケーション |
| `%ProgramData%\DevPortal\backstage\logs\` | Backstage のログ |
| `%ProgramData%\DevPortal\baget\app\` | BaGet 本体 |
| `%ProgramData%\DevPortal\baget\packages\` | NuGet パッケージのストレージ |
| `%ProgramData%\DevPortal\baget\data\` | BaGet SQLite DB |
| `%ProgramData%\DevPortal\baget\logs\` | BaGet のログ |
| `%ProgramData%\DevPortal\config\setup.toml` | セットアップ設定ファイル |

---

## Windows サービス名

| コンポーネント | サービス名 | 表示名 |
|---|---|---|
| Verdaccio | `DevPortal-Verdaccio` | DevPortal - Verdaccio npm Registry |
| Backstage | `DevPortal-Backstage` | DevPortal - Backstage Developer Portal |
| BaGet | `DevPortal-BaGet` | DevPortal - BaGet NuGet Registry |

---

## プロジェクト構成

```
product/setup/
├─ shared/                  # CLI/GUI 共通ロジック（Rust）
├─ cli/                     # コマンドラインツール（Rust）
└─ gui/                     # デスクトップ GUI（Tauri + React）
```

---

## トラブルシューティング

### Windows Defender / セキュリティソフトによる干渉

`%ProgramData%\DevPortal\` を除外リストに追加することを推奨します。

### Backstage の初回起動に時間がかかる

`yarn install` + TypeScript コンパイルに数分〜十数分かかります。ログ（`%ProgramData%\DevPortal\backstage\logs\stdout.log`）でリアルタイムに確認できます。

### Node.js のバージョン変更後にサービスが動かない

インストール時の `node.exe` の絶対パスをサービスに登録しています。Node.js のパスが変わった場合は `uninstall` してから `install` を再実行してください。

### BaGet のダウンロードに失敗する

社内プロキシ環境では `HTTPS_PROXY` または `HTTP_PROXY` を設定してください。オフライン環境では `DEVPORTAL_BAGET_PATH` に BaGet ZIP のフルパスを指定してください。
