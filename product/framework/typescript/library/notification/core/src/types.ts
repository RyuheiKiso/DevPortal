// 通知の重要度レベル（UI 側で色やアイコンを切り替える基準）
export type NotificationLevel =
  // 情報（中立）
  | "info"
  // 成功
  | "success"
  // 警告
  | "warning"
  // エラー
  | "error";

// 通知の種別（toast / dialog / confirm を区別）
export type NotificationKind = "toast" | "dialog" | "confirm";

// アクションボタン 1 件の意図（UI 側でスタイル分岐に用いる）
export type NotificationActionIntent = "primary" | "destructive" | "neutral";

// 通知に紐づくアクション（ボタン）の定義
export interface NotificationAction {
  // 識別子（resolveDialog の reason として返す）
  id: string;
  // 表示ラベル
  label: string;
  // 意図（UI のスタイル切り替え）
  intent?: NotificationActionIntent;
}

// すべての通知種別が共通で持つフィールド
export interface BaseNotification {
  // 一意 ID（idFactory で生成）
  id: string;
  // 通知種別
  kind: NotificationKind;
  // 重要度レベル
  level: NotificationLevel;
  // 任意のタイトル
  title?: string;
  // 本文メッセージ（必須）
  message: string;
  // 生成時刻（epoch ms）
  createdAt: number;
  // 追加メタデータ（requestId などの相関情報を入れる用途）
  meta?: Readonly<Record<string, unknown>>;
  // 重複検出用のキー（同じキーの toast がある場合は置換）
  dedupeKey?: string;
}

// トースト通知（自動で消える短時間表示を想定）
export interface ToastNotification extends BaseNotification {
  // 種別タグ
  kind: "toast";
  // 自動 dismiss までの時間（ms）。0 または undefined は自動消去しない
  duration?: number;
  // 任意のアクションボタン群（Undo など）
  actions?: readonly NotificationAction[];
}

// ダイアログ通知（手動で閉じる前提のモーダル想定）
export interface DialogNotification extends BaseNotification {
  // 種別タグ
  kind: "dialog";
  // 表示するアクションボタン群
  actions?: readonly NotificationAction[];
  // 背景タップ等で閉じてよいか（既定: true）
  dismissible?: boolean;
}

// 確認ダイアログ（Promise<boolean> を解決する）
export interface ConfirmNotification extends BaseNotification {
  // 種別タグ
  kind: "confirm";
  // 確定ボタンのラベル（既定: "OK"）
  confirmLabel?: string;
  // キャンセルボタンのラベル（既定: "キャンセル"）
  cancelLabel?: string;
  // 破壊的操作かどうか（UI 側で赤色等を出す目印）
  destructive?: boolean;
}

// 公開する通知ユニオン型
// ブラウザ標準の `Notification` API（Notifications API のクラス）との名前衝突を避けるため AppNotification を採用
export type AppNotification = ToastNotification | DialogNotification | ConfirmNotification;

/**
 * @deprecated 次のメジャーバージョンで削除予定。
 * ブラウザ標準の `Notification` API との名前衝突を避けるため、新規コードでは {@link AppNotification} を使用してください。
 * 旧名 `Notification` を import している既存 consumer の breaking change を緩和するための互換 alias として暫定提供しています。
 */
// 旧名互換用の type alias（AppNotification と等価）
export type Notification = AppNotification;

// toast を出すための入力（id/kind/createdAt は内部で補完）
export interface ToastInput {
  // 任意の重要度（既定: "info"）
  level?: NotificationLevel;
  // タイトル
  title?: string;
  // 本文
  message: string;
  // 自動 dismiss までの時間（ms）。0 / undefined は自動消去しない
  duration?: number;
  // アクション群
  actions?: readonly NotificationAction[];
  // 追加メタデータ
  meta?: Readonly<Record<string, unknown>>;
  /**
   * 重複検出キー。既存 toast に同じ `dedupeKey` があれば、その通知は **完全 Replace** される
   * （id と createdAt のみ既存値を継承し、`level` / `title` / `message` / `duration` / `actions` /
   * `meta` / `dedupeKey` は新規 toast 構築と同一ロジックで input から取り直す）。input で省略した
   * フィールドは既定値（`level` は `"info"`、`duration` は `defaultDuration`、その他は `undefined`）
   * に戻る。merge セマンティクスではないので、既存の `title` や `actions` を保ちたい場合は
   * 入力側で都度指定すること。manager は `add` ではなく `update` イベントを emit する。
   */
  dedupeKey?: string;
}

// dialog を出すための入力
export interface DialogInput {
  // 任意の重要度（既定: "info"）
  level?: NotificationLevel;
  // タイトル
  title?: string;
  // 本文
  message: string;
  // アクション群
  actions?: readonly NotificationAction[];
  // 背景タップ等で閉じてよいか
  dismissible?: boolean;
  // 追加メタデータ
  meta?: Readonly<Record<string, unknown>>;
  // 重複検出キー
  dedupeKey?: string;
}

// confirm を出すための入力
export interface ConfirmInput {
  // 任意の重要度（既定: "warning"）
  level?: NotificationLevel;
  // タイトル
  title?: string;
  // 本文
  message: string;
  // 確定ラベル
  confirmLabel?: string;
  // キャンセルラベル
  cancelLabel?: string;
  // 破壊的操作フラグ
  destructive?: boolean;
  // 追加メタデータ
  meta?: Readonly<Record<string, unknown>>;
  // 重複検出キー
  dedupeKey?: string;
}

// dialog 解決時の戻り値
export interface DialogResult {
  // ダイアログが閉じられたフラグ（常に true）
  dismissed: true;
  // 押されたアクション ID もしくは閉じた理由（任意）
  reason?: string;
}

// subscribe が受け取るイベントの種別
export type NotificationEventType = "add" | "update" | "remove";

// 1 件のイベント
export interface NotificationEvent {
  // 種別
  type: NotificationEventType;
  // 対象の通知（remove 時も直前の値を渡す）
  notification: AppNotification;
}

// subscribe に登録するリスナの型
export type NotificationListener = (event: NotificationEvent) => void;

// Manager 生成時の設定
export interface NotificationManagerConfig {
  // toast の既定 duration（ms）。未指定なら 0（自動消去しない）
  defaultDuration?: number;
  /**
   * キュー上限（既定 100）。上限を超えると最古の **toast** のみを FIFO で破棄する。
   * dialog / confirm は未解決の Promise を保持する性質上、自動破棄の対象外。
   * 大量に積まれると memory leak になりうるため、必要に応じて `dismissAll("dialog")` /
   * `dismissAll("confirm")` を呼んでドレインすること。
   */
  maxQueueSize?: number;
  // 時刻取得関数（テスト用、既定: Date.now）
  now?: () => number;
  // ID 生成関数（テスト用、既定: createDefaultIdFactory()）
  idFactory?: () => string;
  // タイマー実装（テスト用、既定: グローバル setTimeout/clearTimeout）
  timer?: NotificationTimer;
}

// duration タイマーの差し替え用インターフェース
export interface NotificationTimer {
  // setTimeout 相当
  set: (cb: () => void, ms: number) => unknown;
  // clearTimeout 相当
  clear: (handle: unknown) => void;
}

// Manager の公開インターフェース
export interface NotificationManager {
  // toast を発行し、その ID を即時返す
  toast(input: ToastInput): string;
  // dialog を発行し、解決を待つ Promise を返す
  dialog(input: DialogInput): Promise<DialogResult>;
  // confirm を発行し、true/false で解決される Promise を返す
  confirm(input: ConfirmInput): Promise<boolean>;
  // 指定 ID の通知を閉じる（pending な dialog/confirm は dismissed/false で解決）
  dismiss(id: string): void;
  // すべて、または指定 kind の通知だけを閉じる
  dismissAll(kind?: NotificationKind): void;
  // dialog をアクション ID 等の reason で解決する（UI 側のボタン押下用）
  resolveDialog(id: string, reason?: string): void;
  // confirm を boolean 値で解決する（UI 側のボタン押下用）
  resolveConfirm(id: string, value: boolean): void;
  // 現在の通知一覧のスナップショットを取得（UI 初期表示用）
  getAll(): readonly AppNotification[];
  // 通知イベントの購読を登録する。戻り値で購読解除
  subscribe(listener: NotificationListener): () => void;
  // 全タイマーの停止と pending な resolver の解決（false / undefined reason）。Manager のクリーンアップ
  dispose(): void;
}
