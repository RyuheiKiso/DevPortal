// 認証済みか匿名かを表すセッション状態
export type AuthStatus = "anonymous" | "authenticated";

// 認証状態の変化を購読者へ通知するときのイベント名
export type AuthEvent = "sessionChanged" | "signedIn" | "signedOut" | "tokenRefreshed";

// 業務アプリで共通利用するユーザー情報
export interface AuthUser {
  // バックエンドまたは IdP が一意に識別できるユーザー ID
  id: string;
  // 画面表示用のユーザー名
  displayName?: string;
  // 連絡先や監査ログで利用するメールアドレス
  email?: string;
  // UI 表示制御で使うロール一覧
  roles: readonly string[];
  // UI 表示制御で使う権限一覧
  permissions: readonly string[];
  // 案件固有の追加属性
  attributes?: Readonly<Record<string, unknown>>;
}

// フロントエンド側で扱うトークン集合
export interface AuthTokenSet {
  // API 呼び出しに付与するアクセストークン
  accessToken?: string;
  // アクセストークン更新に使うリフレッシュトークン
  refreshToken?: string;
  // アクセストークンの有効期限（Unix epoch milliseconds）
  expiresAt?: number;
  // Authorization ヘッダのスキーム
  tokenType?: string;
  // IdP から付与されたスコープ文字列
  scope?: string;
}

// アプリが保持する認証セッション
export interface AuthSession {
  // 現在の認証状態
  status: AuthStatus;
  // 認証済みユーザー（匿名時は null）
  user: AuthUser | null;
  // API 連携に使うトークン集合
  tokens?: AuthTokenSet;
  // ID token や /me が返したクレーム
  claims?: Readonly<Record<string, unknown>>;
}

// login 操作に渡せる汎用入力
export interface SignInRequest {
  // ログイン後に戻す URL
  redirectUrl?: string;
  // ID/PW など案件固有の資格情報
  credentials?: Readonly<Record<string, unknown>>;
  // 追加のプロバイダ固有パラメータ
  metadata?: Readonly<Record<string, unknown>>;
}

// logout 操作に渡せる汎用入力
export interface SignOutRequest {
  // ログアウト後に戻す URL
  redirectUrl?: string;
  // サーバー側セッションも終了するか
  revokeServerSession?: boolean;
}

// バックエンドや IdP との接続を差し替えるためのアダプタ契約
export interface AuthAdapter {
  // 現在のセッションを取得する（典型例: /me）
  getSession(): Promise<AuthSession>;
  // ログイン処理を開始または実行する
  signIn?(request?: SignInRequest): Promise<AuthSession>;
  // ログアウト処理を実行する
  signOut?(request?: SignOutRequest): Promise<void>;
  // トークン更新またはセッション再取得を実行する
  refresh?(tokens?: AuthTokenSet): Promise<AuthSession>;
}

// トークンの保存先を差し替えるための契約
// @k1s0-ts-storage/core の TypedSlot<AuthTokenSet> の別名 (型の互換性は完全に維持)
// 将来は storage パッケージの暗号化や監査ミドルウェアを直接合成できる
import type { TypedSlot } from "@k1s0-ts-storage/core";
export type TokenStore = TypedSlot<AuthTokenSet>;

// 権限要件の評価方式
export type AccessMode = "all" | "any";

// 画面や操作の表示制御で使う要件
export interface AccessRequirement {
  // 認証済みであることを要求するか
  authenticated?: boolean;
  // 必要なロール一覧
  roles?: readonly string[];
  // 必要な権限一覧
  permissions?: readonly string[];
  // roles と permissions の評価方式
  mode?: AccessMode;
}

// 権限判定の詳細結果
export interface AccessDecision {
  // 要件を満たしているか
  allowed: boolean;
  // 不足しているロール一覧
  missingRoles: readonly string[];
  // 不足している権限一覧
  missingPermissions: readonly string[];
  // 否認理由を機械判定しやすくするコード
  reason?: "anonymous" | "missing-role" | "missing-permission";
}

// セッション変化を購読するリスナー
export type AuthListener = (session: AuthSession, event: AuthEvent) => void;

// AuthManager の getSession に渡す取得オプション
export interface GetSessionOptions {
  // true の場合はキャッシュを使わず adapter.getSession を呼ぶ
  refresh?: boolean;
}

// フロントエンド共通の認証操作 API
export interface AuthManager {
  // 現在の同期スナップショットを返す
  getSnapshot(): AuthSession;
  // セッションを取得する
  getSession(options?: GetSessionOptions): Promise<AuthSession>;
  // セッションを明示的に差し替える
  setSession(session: AuthSession, event?: AuthEvent): Promise<AuthSession>;
  // ログイン処理を実行する
  signIn(request?: SignInRequest): Promise<AuthSession>;
  // ログアウト処理を実行する
  signOut(request?: SignOutRequest): Promise<void>;
  // トークンまたはセッションを更新する
  refresh(): Promise<AuthSession>;
  // 現在のアクセストークンを返す
  getAccessToken(): Promise<string | undefined>;
  // HTTP クライアントに渡せる認証ヘッダを返す
  getAuthHeaders(): Promise<Record<string, string>>;
  // ロールを持つか判定する
  hasRole(role: string): boolean;
  // 権限を持つか判定する
  hasPermission(permission: string): boolean;
  // 複合要件を満たすか判定する
  canAccess(requirement: AccessRequirement): AccessDecision;
  // セッション変化を購読する
  subscribe(listener: AuthListener): () => void;
}

// AuthManager 生成時のオプション
export interface AuthManagerOptions {
  // 初期セッション
  initialSession?: AuthSession;
  // トークン保存先
  tokenStore?: TokenStore;
}
