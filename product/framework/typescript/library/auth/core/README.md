# @k1s0-ts-auth/core

DevPortal の業務アプリ向け認証・認可コアです。

このパッケージは認証サーバーや IdP を内包しません。バックエンドや OIDC 基盤が返すセッション、ロール、権限、トークンをフロントエンドで扱うための共通インターフェースを提供します。

## 主な機能

- `AuthAdapter` による `/me`、login、logout、refresh の差し替え
- `AuthManager` によるセッション保持、購読、トークン保存
- `hasRole` / `hasPermission` / `canAccess` による表示制御
- `createMemoryTokenStore` によるテスト・簡易用途のトークン保管
- `getAuthHeaders()` による HTTP クライアント連携

## 注意

フロントエンドの権限判定は UX 用の表示制御です。API アクセスの最終的な認可判定は必ずバックエンドで実施してください。
