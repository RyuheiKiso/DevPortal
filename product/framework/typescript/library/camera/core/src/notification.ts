// @k1s0-ts-notification/core 連携を duck typed で実装する optional ブリッジ
// notification 本体への runtime 依存を避けるため、型は構造的に要求する
import type { CameraManager } from "./types.js";
import { shouldOpenSettings } from "./permission.js";

// duck typed の NotificationManager 形状（@k1s0-ts-notification/core の最小サブセット）
export interface NotificationManagerLike {
  // toast を発行する関数（戻り値の ID は使わない）
  toast: (input: {
    // 重要度
    level?: "info" | "success" | "warning" | "error";
    // タイトル
    title?: string;
    // 本文
    message: string;
    // 任意のメタデータ
    meta?: Readonly<Record<string, unknown>>;
    // 重複検出キー
    dedupeKey?: string;
  }) => string;
  // dialog を発行する関数
  // 戻り値の Promise は actions のいずれかが押された / ユーザが dismiss したタイミングで解決する想定。
  // **契約**: result.reason には押下された action.id が文字列でそのまま入る。
  //   - 例: actions=[{ id: "open-settings", label: "..." }] を渡したら、ボタン押下時に reason: "open-settings" が返る。
  //   - 自動 dismiss / 閉じるボタン押下時は reason: undefined（または action 側で割り当てた id）。
  // この契約は `@k1s0-ts-notification/core` の NotificationManager.dialog の挙動に依存する。
  dialog: (input: {
    // 重要度
    level?: "info" | "success" | "warning" | "error";
    // タイトル
    title?: string;
    // 本文
    message: string;
    // ボタン群（id は dialog の戻り値 reason フィールドにそのまま現れる）
    actions?: ReadonlyArray<{ id: string; label: string; intent?: "primary" | "destructive" | "neutral" }>;
    // 任意のメタデータ
    meta?: Readonly<Record<string, unknown>>;
    // 重複検出キー
    dedupeKey?: string;
  }) => Promise<{
    // dismissed は型上 true 固定（dialog は必ず閉じる）
    dismissed: true;
    // 押下された action.id が入る（押下なし / 自動 dismiss なら undefined）
    reason?: string;
  }>;
}

// ブリッジ生成時のオプション
export interface AttachNotificationOptions {
  // 権限拒否時のメッセージカスタマイズ
  permissionDeniedMessage?: string;
  // 権限ブロック時のメッセージ
  permissionBlockedMessage?: string;
  // 録画エラー時のメッセージ
  recordingErrorMessage?: string;
  // dedupe するか（既定 true、同種のエラー toast が重なるのを防ぐ）
  dedupe?: boolean;
  // 設定アプリを開く処理（blocked 時の dialog action ハンドラに使う）
  // ボタン押下時のフックを実行するために fire-and-forget で呼ぶ
  openSettings?: () => void;
}

// camera manager → notification manager のブリッジを貼る
// 戻り値で購読解除を返す
export function attachNotificationBridge(
  manager: CameraManager,
  notification: NotificationManagerLike,
  options: AttachNotificationOptions = {},
): () => void {
  // dedupe の既定は true
  const dedupe = options.dedupe ?? true;
  // dedupe キーのプレフィックス
  const dedupeKey = (suffix: string): string | undefined => {
    // dedupe オフなら undefined を返す
    return dedupe ? `camera:${suffix}` : undefined;
  };
  // manager.subscribe にリスナを登録
  return manager.subscribe((event) => {
    // error イベント以外は対象外
    if (event.type !== "error") {
      return;
    }
    // CameraError 共通の meta
    const meta = {
      code: event.error.code,
      retryable: event.error.retryable,
    } as const;
    // PERMISSION_BLOCKED は dialog + 設定誘導
    if (event.error.code === "PERMISSION_BLOCKED") {
      // 設定アプリを開くハンドラの有無で actions を分岐
      const actions = options.openSettings !== undefined
        ? [
            { id: "open-settings", label: "設定を開く", intent: "primary" as const },
            { id: "cancel", label: "閉じる", intent: "neutral" as const },
          ]
        : undefined;
      // dialog を fire-and-forget で発行
      void notification
        .dialog({
          level: "warning",
          title: "カメラ権限が必要です",
          message:
            options.permissionBlockedMessage ??
            "OS の設定でカメラのアクセス許可を有効にしてください。",
          actions,
          meta,
          dedupeKey: dedupeKey("permission-blocked"),
        })
        .then((result) => {
          // 上で渡した action.id "open-settings" と一致したときだけ openSettings を呼ぶ。
          // この比較は NotificationManagerLike.dialog の reason 契約（action.id をそのまま返す）に依存する。
          if (result.reason === "open-settings" && options.openSettings !== undefined) {
            options.openSettings();
          }
        })
        .catch(() => {
          // resolve 関数の throw 等は無視
        });
      return;
    }
    // PERMISSION_DENIED は warning toast
    if (event.error.code === "PERMISSION_DENIED") {
      notification.toast({
        level: "warning",
        title: "カメラの利用が拒否されました",
        message:
          options.permissionDeniedMessage ??
          "もう一度カメラ権限の許可を求めてください。",
        meta,
        dedupeKey: dedupeKey("permission-denied"),
      });
      return;
    }
    // RECORDING_ERROR は error toast
    if (event.error.code === "RECORDING_ERROR") {
      notification.toast({
        level: "error",
        title: "録画でエラーが発生しました",
        message: options.recordingErrorMessage ?? event.error.message,
        meta,
        dedupeKey: dedupeKey("recording-error"),
      });
      return;
    }
    // SCANNER_ERROR は warning toast
    if (event.error.code === "SCANNER_ERROR") {
      notification.toast({
        level: "warning",
        title: "バーコードスキャンでエラーが発生しました",
        message: event.error.message,
        meta,
        dedupeKey: dedupeKey("scanner-error"),
      });
      return;
    }
    // DEVICE_UNAVAILABLE は error toast
    if (event.error.code === "DEVICE_UNAVAILABLE") {
      notification.toast({
        level: "error",
        title: "カメラデバイスが利用できません",
        message: event.error.message,
        meta,
        dedupeKey: dedupeKey("device-unavailable"),
      });
      return;
    }
    // それ以外（CAMERA_ERROR / CAMERA_NOT_READY 等）は汎用 error toast
    notification.toast({
      level: "error",
      title: "カメラエラー",
      message: event.error.message,
      meta,
      dedupeKey: dedupeKey("generic"),
    });
  });
}

// 利便性のため shouldOpenSettings を再 export しておく（呼出側が判定 → openSettings を呼ぶ実装パターン用）
export { shouldOpenSettings };
