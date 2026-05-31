-- ============================================================
-- 認証・認可（ログイン機能）開発専用シードデータ / SQL Server
-- 前提スキーマ: database/auth/auth-schema.sql（先に実行しておくこと）
-- ============================================================
-- 【重要・本番禁止】このファイルは開発／検証環境専用。
-- 管理者の初期パスワードは固定のダミーであり、初回ログインで変更する前提。
-- 本番環境では実行しないこと（管理者はアプリ側で安全に初期生成する）。
-- 何度実行しても重複しないよう、各INSERTは存在チェック付き（冪等）にしている。
-- ============================================================

-- ------------------------------------------------------------
-- 権限マスタ（Permissions）
-- アプリ機能に対応する固定の権限コードを投入する
-- ------------------------------------------------------------
-- 未登録の権限コードのみを追加する（冪等）
INSERT INTO auth.Permissions (Code, DisplayName, Description, Category)
-- 追加候補の一覧
SELECT v.Code, v.DisplayName, v.Description, v.Category
-- 値リスト（コード / 表示名 / 説明 / カテゴリ）
FROM (VALUES
    -- ユーザー情報の閲覧
    (N'user.read',       N'ユーザー参照',     N'ユーザー情報の閲覧',           N'ユーザー管理'),
    -- ユーザーの作成・更新・無効化
    (N'user.manage',     N'ユーザー管理',     N'ユーザーの作成・更新・無効化', N'ユーザー管理'),
    -- ロールの閲覧
    (N'role.read',       N'ロール参照',       N'ロール・権限の閲覧',           N'ロール管理'),
    -- ロールと権限割当の編集
    (N'role.manage',     N'ロール管理',       N'ロールの編集と権限割当',       N'ロール管理'),
    -- サービスカタログの閲覧
    (N'catalog.read',    N'カタログ参照',     N'サービスカタログの閲覧',       N'カタログ'),
    -- サービスカタログの編集
    (N'catalog.write',   N'カタログ編集',     N'サービスカタログの登録・更新', N'カタログ'),
    -- 監査ログの閲覧
    (N'audit.read',      N'監査ログ参照',     N'監査ログの閲覧',               N'監査'),
    -- システム設定の変更
    (N'settings.manage', N'システム設定管理', N'システム全体設定の変更',       N'システム')
) AS v(Code, DisplayName, Description, Category)
-- 既に同じコードが存在する場合は追加しない
WHERE NOT EXISTS (SELECT 1 FROM auth.Permissions p WHERE p.Code = v.Code);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- システムロール（Roles, IsSystem=1）
-- 組み込みロールとして削除・改名不可で投入する
-- ------------------------------------------------------------
-- 未登録のロールのみを追加する（冪等）
INSERT INTO auth.Roles (Name, NormalizedName, Description, IsSystem)
-- 追加候補の一覧（IsSystem は固定で 1）
SELECT v.Name, v.NormalizedName, v.Description, 1
-- 値リスト（名称 / 正規化名 / 説明）
FROM (VALUES
    -- 全権管理者
    (N'Administrator', N'ADMINISTRATOR', N'全権管理者'),
    -- 開発者
    (N'Developer',     N'DEVELOPER',     N'開発者（カタログ編集・参照系）'),
    -- 閲覧者
    (N'Viewer',        N'VIEWER',        N'閲覧専用')
) AS v(Name, NormalizedName, Description)
-- 既に同じ正規化名が存在する場合は追加しない
WHERE NOT EXISTS (SELECT 1 FROM auth.Roles r WHERE r.NormalizedName = v.NormalizedName);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- ロール⇔権限割当（RolePermissions）
-- ------------------------------------------------------------
-- Administrator には全権限を付与する（冪等）
INSERT INTO auth.RolePermissions (RoleId, PermissionId)
-- 管理者ロールと全権限の組み合わせ
SELECT r.Id, p.Id
-- 管理者ロール
FROM auth.Roles r
-- 全権限と直積を取る
CROSS JOIN auth.Permissions p
-- 対象は Administrator のみ
WHERE r.NormalizedName = N'ADMINISTRATOR'
-- 既に割当済みの組み合わせは除外する
  AND NOT EXISTS (SELECT 1 FROM auth.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);
-- バッチ区切り
GO

-- Developer / Viewer には個別に権限を割り当てる（冪等）
INSERT INTO auth.RolePermissions (RoleId, PermissionId)
-- ロールと権限を自然キーで突き合わせて解決する
SELECT r.Id, p.Id
-- 割当定義（ロール正規化名 / 権限コード）
FROM (VALUES
    -- 開発者: カタログ参照
    (N'DEVELOPER', N'catalog.read'),
    -- 開発者: カタログ編集
    (N'DEVELOPER', N'catalog.write'),
    -- 開発者: ユーザー参照
    (N'DEVELOPER', N'user.read'),
    -- 開発者: ロール参照
    (N'DEVELOPER', N'role.read'),
    -- 閲覧者: カタログ参照
    (N'VIEWER',    N'catalog.read'),
    -- 閲覧者: ユーザー参照
    (N'VIEWER',    N'user.read')
) AS m(RoleName, PermCode)
-- ロールIDを解決
JOIN auth.Roles r ON r.NormalizedName = m.RoleName
-- 権限IDを解決
JOIN auth.Permissions p ON p.Code = m.PermCode
-- 既に割当済みの組み合わせは除外する
WHERE NOT EXISTS (SELECT 1 FROM auth.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- 開発用ブートストラップ管理者（Users）
-- ログインID: admin / 初期パスワード: DevAdmin#2026
-- パスワードハッシュは ASP.NET Core Identity 形式（PBKDF2-HMACSHA256, 100,000回）
-- 【注意】別のハッシュ方式（bcrypt/argon2 等）を採用する場合はこの値を作り直すこと
-- ------------------------------------------------------------
-- 管理者ユーザーが未登録の場合のみ作成する（冪等）
IF NOT EXISTS (SELECT 1 FROM auth.Users WHERE NormalizedUserName = N'ADMIN')
-- 作成処理の開始
BEGIN
    -- 管理者ユーザーを1件挿入する
    INSERT INTO auth.Users (UserName, NormalizedUserName, Email, NormalizedEmail, EmailConfirmed, PasswordHash, DisplayName, IsActive)
    -- 各列の値（PasswordHash は DevAdmin#2026 のハッシュ）
    VALUES (N'admin', N'ADMIN', N'admin@devportal.local', N'ADMIN@DEVPORTAL.LOCAL', 1,
            N'AQAAAAEAAYagAAAAEL3xYrtXd1+ht5eNZt+omIwudIdmRSp44SCiLjX3kAxaFPm3pjyStrUtYvz15UjWMA==',
            N'開発用管理者', 1);
-- 作成処理の終了
END;
-- バッチ区切り
GO

-- 管理者ユーザーに Administrator ロールを割り当てる（冪等）
INSERT INTO auth.UserRoles (UserId, RoleId)
-- 管理者ユーザーと管理者ロールの組み合わせ
SELECT u.Id, r.Id
-- 管理者ユーザー
FROM auth.Users u
-- 管理者ロールを結合
JOIN auth.Roles r ON r.NormalizedName = N'ADMINISTRATOR'
-- 対象は admin ユーザーのみ
WHERE u.NormalizedUserName = N'ADMIN'
-- 既に割当済みの場合は追加しない
  AND NOT EXISTS (SELECT 1 FROM auth.UserRoles ur WHERE ur.UserId = u.Id AND ur.RoleId = r.Id);
-- バッチ区切り
GO
