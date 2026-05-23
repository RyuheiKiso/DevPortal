# DevPortal Verdaccio シード資材

このディレクトリは、DevPortal の Verdaccio セットアップが
インストール時に `%ProgramData%\DevPortal\verdaccio\` 配下へ
書き出すシード資材を保管する場所である。

## 同梱されるファイル

| リポジトリ内パス | 配置先 (インストール後) | 説明 |
| --- | --- | --- |
| `infra/Verdaccio/storage/htpasswd` | `%ProgramData%\DevPortal\verdaccio\storage\htpasswd` | 初期ユーザー `admin / admin` の bcrypt 済 htpasswd |

## 取り込み方式

`product/setup/shared/src/verdaccio.rs` で `include_str!` により
Rust バイナリへコンパイル時に同梱される。
ランタイムでは外部ファイル参照を行わず、配布バイナリ単体で完結する。

## 適用ルール

- セットアップ実行時、配置先ファイルが **存在しない、または 0 バイト** の場合のみシードを書き出す
  - 0 バイト判定を追加している理由: `fs::write` は非アトミック処理のため、インストール中断で空ファイルが残ることがある
- 既にファイルが存在し内容がある場合は一切上書きしない (運用での追加ユーザー・パスワード変更を保護)
- `uninstall --purge` で storage ごと削除された場合、次回 install で再度シードが配置される

## ユーザー登録について

Verdaccio の config (`max_users: -1`) はユーザー数を無制限に設定している。
これは admin/admin でのログインに加え、**`npm adduser` で誰でも新規ユーザーを追加できる**ことを意味する。
`$authenticated` 権限を持つ全ユーザーがパッケージを publish できるため、
社内ネットワーク外からのアクセスが考えられる場合は `max_users: 0` に変更して自己登録を禁止することを検討すること。

## 初期ユーザー

| ユーザー名 | パスワード | 用途 |
| --- | --- | --- |
| `admin` | `admin` | 社内閉鎖環境向けの初期管理ユーザー (仮値) |

> **WARNING**: パスワード `admin` は仮値である。運用開始前に必ず変更すること。

## bcrypt ハッシュの再生成手順

```powershell
npx --yes bcryptjs admin 10
```

出力された `$2b$10$...` を `admin:` に続けて `infra/Verdaccio/storage/htpasswd` に書き込む (末尾に LF 1 個)。
