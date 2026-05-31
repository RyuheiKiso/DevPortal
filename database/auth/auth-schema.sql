-- ============================================================
-- 認証・認可（ログイン機能）スキーマ定義 / SQL Server
-- 対応する定義書: docs/database/auth-table-definition.md
-- ============================================================

-- auth スキーマが未作成なら作成する（CREATE SCHEMA はバッチ先頭である必要があるため動的SQLで実行）
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'auth')
    EXEC (N'CREATE SCHEMA auth');
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.Users : ユーザー本体
-- ------------------------------------------------------------
-- ユーザー本体テーブルを作成する
CREATE TABLE auth.Users
(
    -- 内部主キー（結合・クラスタ化用の連番）
    Id BIGINT IDENTITY(1,1) NOT NULL,
    -- 外部API公開用の安定ID（連番推測を防ぐ）
    PublicId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Users_PublicId DEFAULT NEWID(),
    -- ログインID（表示用の原文）
    UserName NVARCHAR(256) NOT NULL,
    -- 大文字化した正規化ログインID（大小無視の一意・検索用）
    NormalizedUserName NVARCHAR(256) NOT NULL,
    -- メールアドレス（原文）
    Email NVARCHAR(256) NOT NULL,
    -- 大文字化した正規化メール（一意・検索用）
    NormalizedEmail NVARCHAR(256) NOT NULL,
    -- メール確認済みフラグ
    EmailConfirmed BIT NOT NULL CONSTRAINT DF_Users_EmailConfirmed DEFAULT 0,
    -- アルゴリズム＋salt＋反復回数を内包したパスワードハッシュ文字列
    PasswordHash NVARCHAR(MAX) NOT NULL,
    -- 資格情報変更時に更新し全トークンを一括無効化するための印
    SecurityStamp NVARCHAR(64) NOT NULL CONSTRAINT DF_Users_SecurityStamp DEFAULT CONVERT(NVARCHAR(64), NEWID()),
    -- 画面表示名
    DisplayName NVARCHAR(128) NULL,
    -- 連続ログイン失敗回数（成功でリセット）
    AccessFailedCount INT NOT NULL CONSTRAINT DF_Users_AccessFailedCount DEFAULT 0,
    -- ロックアウト対象とするか
    LockoutEnabled BIT NOT NULL CONSTRAINT DF_Users_LockoutEnabled DEFAULT 1,
    -- ロック解除時刻（NULL=ロックなし）
    LockoutEndUtc DATETIME2(3) NULL,
    -- 有効フラグ（退職・無効化で 0）
    IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
    -- 作成時刻（UTC）
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Users_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 最終更新時刻（UTC）
    UpdatedAtUtc DATETIME2(3) NULL,
    -- 楽観的同時実行制御用の行バージョン
    RowVersion ROWVERSION NOT NULL,
    -- 主キー制約
    CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (Id)
);
-- バッチ区切り
GO

-- 正規化ログインID の一意制約
CREATE UNIQUE INDEX UX_Users_NormalizedUserName ON auth.Users (NormalizedUserName);
-- バッチ区切り
GO
-- 正規化メール の一意制約
CREATE UNIQUE INDEX UX_Users_NormalizedEmail ON auth.Users (NormalizedEmail);
-- バッチ区切り
GO
-- 外部公開ID の一意制約
CREATE UNIQUE INDEX UX_Users_PublicId ON auth.Users (PublicId);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.Roles : ロール
-- ------------------------------------------------------------
-- ロールテーブルを作成する
CREATE TABLE auth.Roles
(
    -- 主キー（連番）
    Id INT IDENTITY(1,1) NOT NULL,
    -- ロール名（原文）
    Name NVARCHAR(128) NOT NULL,
    -- 正規化ロール名（一意）
    NormalizedName NVARCHAR(128) NOT NULL,
    -- 説明
    Description NVARCHAR(256) NULL,
    -- 組み込みロール（削除・改名不可）か
    IsSystem BIT NOT NULL CONSTRAINT DF_Roles_IsSystem DEFAULT 0,
    -- 作成時刻（UTC）
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Roles_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 最終更新時刻（UTC）
    UpdatedAtUtc DATETIME2(3) NULL,
    -- 楽観的同時実行制御用の行バージョン
    RowVersion ROWVERSION NOT NULL,
    -- 主キー制約
    CONSTRAINT PK_Roles PRIMARY KEY CLUSTERED (Id)
);
-- バッチ区切り
GO
-- 正規化ロール名の一意制約
CREATE UNIQUE INDEX UX_Roles_NormalizedName ON auth.Roles (NormalizedName);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.Permissions : 権限
-- ------------------------------------------------------------
-- 権限テーブルを作成する
CREATE TABLE auth.Permissions
(
    -- 主キー（連番）
    Id INT IDENTITY(1,1) NOT NULL,
    -- 権限コード（例: user.manage）。コードで判定する
    Code NVARCHAR(128) NOT NULL,
    -- 表示名
    DisplayName NVARCHAR(128) NOT NULL,
    -- 説明
    Description NVARCHAR(256) NULL,
    -- UI でのグルーピング用カテゴリ
    Category NVARCHAR(64) NULL,
    -- 作成時刻（UTC）
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Permissions_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 主キー制約
    CONSTRAINT PK_Permissions PRIMARY KEY CLUSTERED (Id)
);
-- バッチ区切り
GO
-- 権限コードの一意制約
CREATE UNIQUE INDEX UX_Permissions_Code ON auth.Permissions (Code);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.UserRoles : ユーザー⇔ロール（多対多）
-- ------------------------------------------------------------
-- ユーザー⇔ロール（多対多）テーブルを作成する
CREATE TABLE auth.UserRoles
(
    -- ユーザー
    UserId BIGINT NOT NULL,
    -- ロール
    RoleId INT NOT NULL,
    -- 割当時刻（UTC）
    AssignedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserRoles_AssignedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 割当を行った操作者
    AssignedByUserId BIGINT NULL,
    -- 複合主キー
    CONSTRAINT PK_UserRoles PRIMARY KEY CLUSTERED (UserId, RoleId),
    -- ユーザーへの外部キー
    CONSTRAINT FK_UserRoles_Users FOREIGN KEY (UserId) REFERENCES auth.Users (Id),
    -- ロールへの外部キー
    CONSTRAINT FK_UserRoles_Roles FOREIGN KEY (RoleId) REFERENCES auth.Roles (Id),
    -- 割当操作者への外部キー
    CONSTRAINT FK_UserRoles_AssignedBy FOREIGN KEY (AssignedByUserId) REFERENCES auth.Users (Id)
);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.RolePermissions : ロール⇔権限（多対多）
-- ------------------------------------------------------------
-- ロール⇔権限（多対多）テーブルを作成する
CREATE TABLE auth.RolePermissions
(
    -- ロール
    RoleId INT NOT NULL,
    -- 権限
    PermissionId INT NOT NULL,
    -- 複合主キー
    CONSTRAINT PK_RolePermissions PRIMARY KEY CLUSTERED (RoleId, PermissionId),
    -- ロールへの外部キー
    CONSTRAINT FK_RolePermissions_Roles FOREIGN KEY (RoleId) REFERENCES auth.Roles (Id),
    -- 権限への外部キー
    CONSTRAINT FK_RolePermissions_Permissions FOREIGN KEY (PermissionId) REFERENCES auth.Permissions (Id)
);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.RefreshTokens : リフレッシュトークン
-- ------------------------------------------------------------
-- リフレッシュトークンテーブルを作成する
CREATE TABLE auth.RefreshTokens
(
    -- 主キー（連番）
    Id BIGINT IDENTITY(1,1) NOT NULL,
    -- 所有ユーザー
    UserId BIGINT NOT NULL,
    -- トークンの SHA-256 ハッシュ（原本は保存しない）
    TokenHash VARBINARY(32) NOT NULL,
    -- 紐づくアクセストークンの jti（任意）
    JwtId UNIQUEIDENTIFIER NULL,
    -- 有効期限（UTC）
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    -- 発行時刻（UTC）
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_RefreshTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 発行元IP
    CreatedByIp NVARCHAR(45) NULL,
    -- 端末・UA 情報（端末別ログアウト用）
    DeviceInfo NVARCHAR(256) NULL,
    -- 失効時刻（NULL=有効）
    RevokedAtUtc DATETIME2(3) NULL,
    -- 失効操作元IP
    RevokedByIp NVARCHAR(45) NULL,
    -- 失効理由
    RevokedReason NVARCHAR(32) NULL,
    -- ローテーション後継トークン（自己参照）
    ReplacedByTokenId BIGINT NULL,
    -- 主キー制約
    CONSTRAINT PK_RefreshTokens PRIMARY KEY CLUSTERED (Id),
    -- ユーザーへの外部キー
    CONSTRAINT FK_RefreshTokens_Users FOREIGN KEY (UserId) REFERENCES auth.Users (Id),
    -- 後継トークンへの自己参照外部キー
    CONSTRAINT FK_RefreshTokens_Replaced FOREIGN KEY (ReplacedByTokenId) REFERENCES auth.RefreshTokens (Id)
);
-- バッチ区切り
GO
-- トークンハッシュの一意制約
CREATE UNIQUE INDEX UX_RefreshTokens_TokenHash ON auth.RefreshTokens (TokenHash);
-- バッチ区切り
GO
-- ユーザー単位の列挙・失効用インデックス
CREATE INDEX IX_RefreshTokens_UserId ON auth.RefreshTokens (UserId);
-- バッチ区切り
GO
-- 期限切れトークン一括削除用インデックス
CREATE INDEX IX_RefreshTokens_ExpiresAtUtc ON auth.RefreshTokens (ExpiresAtUtc);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.LoginAttempts : ログイン試行履歴
-- ------------------------------------------------------------
-- ログイン試行履歴テーブルを作成する
CREATE TABLE auth.LoginAttempts
(
    -- 主キー（連番）
    Id BIGINT IDENTITY(1,1) NOT NULL,
    -- 該当ユーザー（不在時は NULL）
    UserId BIGINT NULL,
    -- 入力されたログインID
    AttemptedUserName NVARCHAR(256) NOT NULL,
    -- 成功したか
    Succeeded BIT NOT NULL,
    -- 失敗理由（成功時は NULL）
    FailureReason NVARCHAR(32) NULL,
    -- 接続元IP
    IpAddress NVARCHAR(45) NULL,
    -- UA 文字列
    UserAgent NVARCHAR(512) NULL,
    -- 試行時刻（UTC）
    AttemptedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_LoginAttempts_AttemptedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 主キー制約
    CONSTRAINT PK_LoginAttempts PRIMARY KEY CLUSTERED (Id),
    -- ユーザーへの外部キー
    CONSTRAINT FK_LoginAttempts_Users FOREIGN KEY (UserId) REFERENCES auth.Users (Id),
    -- 成功時は失敗理由を持たないことを保証する
    CONSTRAINT CK_LoginAttempts_FailureReason CHECK (Succeeded = 0 OR FailureReason IS NULL)
);
-- バッチ区切り
GO
-- ロックアウト判定用インデックス
CREATE INDEX IX_LoginAttempts_UserName_Time ON auth.LoginAttempts (AttemptedUserName, AttemptedAtUtc);
-- バッチ区切り
GO
-- IP 単位の不正検知用インデックス
CREATE INDEX IX_LoginAttempts_Ip_Time ON auth.LoginAttempts (IpAddress, AttemptedAtUtc);
-- バッチ区切り
GO

-- ------------------------------------------------------------
-- auth.AuditLogs : 監査ログ
-- ------------------------------------------------------------
-- 監査ログテーブルを作成する
CREATE TABLE auth.AuditLogs
(
    -- 主キー（連番）
    Id BIGINT IDENTITY(1,1) NOT NULL,
    -- 操作主体（システム操作時は NULL）
    ActorUserId BIGINT NULL,
    -- イベント種別
    EventType NVARCHAR(64) NOT NULL,
    -- 操作対象の種別（User / Role / Permission 等）
    TargetType NVARCHAR(64) NULL,
    -- 操作対象のID（種別非依存のため文字列）
    TargetId NVARCHAR(64) NULL,
    -- 詳細（JSON。変更前後の差分など）
    Detail NVARCHAR(MAX) NULL,
    -- 接続元IP
    IpAddress NVARCHAR(45) NULL,
    -- UA 文字列
    UserAgent NVARCHAR(512) NULL,
    -- リクエスト相関ID（トレース連携用）
    CorrelationId UNIQUEIDENTIFIER NULL,
    -- 記録時刻（UTC）
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AuditLogs_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    -- 主キー制約
    CONSTRAINT PK_AuditLogs PRIMARY KEY CLUSTERED (Id),
    -- 操作主体への外部キー
    CONSTRAINT FK_AuditLogs_Users FOREIGN KEY (ActorUserId) REFERENCES auth.Users (Id)
);
-- バッチ区切り
GO
-- 操作者別追跡用インデックス
CREATE INDEX IX_AuditLogs_Actor_Time ON auth.AuditLogs (ActorUserId, CreatedAtUtc);
-- バッチ区切り
GO
-- 種別別追跡用インデックス
CREATE INDEX IX_AuditLogs_Event_Time ON auth.AuditLogs (EventType, CreatedAtUtc);
-- バッチ区切り
GO
-- 対象別追跡用インデックス
CREATE INDEX IX_AuditLogs_Target ON auth.AuditLogs (TargetType, TargetId);
-- バッチ区切り
GO
