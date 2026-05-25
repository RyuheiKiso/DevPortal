// 公開型を取り込み
import type {
  ConfirmInput,
  ConfirmNotification,
  DialogInput,
  DialogNotification,
  DialogResult,
  Notification,
  NotificationEvent,
  NotificationKind,
  NotificationListener,
  NotificationManager,
  NotificationManagerConfig,
  NotificationAction,
  NotificationTimer,
  ToastInput,
  ToastNotification,
} from "./types.js";
// ID 生成のデフォルト実装を取り込み
import { createDefaultIdFactory } from "./id.js";
// dedupe ユーティリティを取り込み
import { findByDedupeKey } from "./dedupe.js";
// 公開 schema と同じ条件で manager 設定を検証
import { validateNotificationConfig } from "./schema.js";

// 既定のキュー上限（toast が積まれすぎないよう制限）
const DEFAULT_MAX_QUEUE_SIZE = 100;

// 既定のタイマー実装（グローバル setTimeout / clearTimeout）
const DEFAULT_TIMER: NotificationTimer = {
  // setTimeout 呼び出し、ハンドルを unknown 型で返す
  set: (cb, ms) => setTimeout(cb, ms),
  // clearTimeout に与えてタイマー解除
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// dialog の pending resolver を保持するエントリ
interface PendingDialog {
  // 解決関数（DialogResult を渡す）
  resolve: (result: DialogResult) => void;
}

// confirm の pending resolver を保持するエントリ
interface PendingConfirm {
  // 解決関数（boolean を渡す）
  resolve: (value: boolean) => void;
}

function freezeActions(
  actions: readonly NotificationAction[] | undefined,
): readonly NotificationAction[] | undefined {
  if (actions === undefined) {
    return undefined;
  }
  return Object.freeze(actions.map((action) => Object.freeze({ ...action })));
}

function freezeMeta(
  meta: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (meta === undefined) {
    return undefined;
  }
  return Object.freeze({ ...meta });
}

function freezeNotification<T extends Notification>(notification: T): T {
  return Object.freeze(notification) as T;
}

// 通知マネージャ本体を生成する
export function createNotificationManager(
  // 任意設定（未指定なら既定値）
  config: NotificationManagerConfig = {},
): NotificationManager {
  // 実行時にも duration / queue size の不正値を早期に弾く
  const validatedConfig = validateNotificationConfig({
    defaultDuration: config.defaultDuration,
    maxQueueSize: config.maxQueueSize,
  });
  // 設定の確定値群
  const now = config.now ?? Date.now;
  const idFactory = config.idFactory ?? createDefaultIdFactory();
  const timer = config.timer ?? DEFAULT_TIMER;
  const defaultDuration = validatedConfig.defaultDuration ?? 0;
  const maxQueueSize = validatedConfig.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  // 通知キュー（add 順）
  let queue: Notification[] = [];
  // 購読中の listener 群
  const listeners: Set<NotificationListener> = new Set();
  // 自動 dismiss 用のタイマーハンドル（toast id → handle）
  const timers: Map<string, unknown> = new Map();
  // dialog / confirm の pending resolver
  const pendingDialogs: Map<string, PendingDialog> = new Map();
  const pendingConfirms: Map<string, PendingConfirm> = new Map();
  // dispose 済みフラグ（dispose を冪等にする）
  let disposed = false;

  // 登録済み listener 全員に 1 件のイベントを通知する
  const emit = (event: NotificationEvent): void => {
    // Set の forEach 中に subscribe/unsubscribe が起きても安全になるようスナップショットを取る
    const snapshot = Array.from(listeners);
    // 各リスナを順に呼ぶ
    for (const listener of snapshot) {
      // listener が throw しても他の listener へ波及させない
      try {
        listener(event);
      } catch {
        // 通知ループの安定性を優先して例外は無視する
      }
    }
  };

  // 指定 ID のタイマーを停止する
  const clearTimer = (id: string): void => {
    // 該当するタイマーハンドルを取得
    const handle = timers.get(id);
    // 未登録なら何もしない
    if (handle === undefined) {
      return;
    }
    // 登録解除
    timers.delete(id);
    // 実タイマーを停止
    timer.clear(handle);
  };

  // 通知をキューから消す（イベントは type:"remove" で発火）
  // 戻り値は実際に削除された通知（無ければ undefined）
  const removeFromQueue = (id: string): Notification | undefined => {
    // 対象 index を探す
    const index = queue.findIndex((n) => n.id === id);
    // 見つからなければ何もしない
    if (index < 0) {
      return undefined;
    }
    // 配列から取り除く（findIndex が有効 index を返した直後のため必ず存在）
    const removed = queue[index]!;
    queue.splice(index, 1);
    // 自動 dismiss タイマーがあれば停止
    clearTimer(id);
    // remove イベントを通知
    emit({ type: "remove", notification: removed });
    // 削除した通知本体を返す
    return removed;
  };

  // maxQueueSize を超えた場合、最古の toast を 1 件捨てる
  const enforceQueueLimit = (): void => {
    // 上限未満なら何もしない
    if (queue.length <= maxQueueSize) {
      return;
    }
    // toast に限定して最古を探す（dialog / confirm は破棄しない）
    const victimIndex = queue.findIndex((n) => n.kind === "toast");
    // toast が無ければ何もしない（dialog / confirm のみで上限超過した場合）
    if (victimIndex < 0) {
      return;
    }
    // 取り出して削除
    const victim = queue[victimIndex];
    queue.splice(victimIndex, 1);
    // 型ガード（noUncheckedIndexedAccess による undefined 型を絞る。findIndex が有効 index を返した直後のため実行時には到達しない）
    /* v8 ignore next 3 */
    if (victim === undefined) {
      return;
    }
    // タイマーが残っていれば停止
    clearTimer(victim.id);
    // remove イベントとして通知
    emit({ type: "remove", notification: victim });
  };

  // toast 用の自動 dismiss タイマーを設定する
  const scheduleAutoDismiss = (id: string, duration: number): void => {
    // duration が 0 以下なら自動消去しない
    if (duration <= 0) {
      return;
    }
    // タイマー起動：満了時に該当 ID を queue から削除
    const handle = timer.set(() => {
      // 発火時にハンドルマップから外す
      timers.delete(id);
      // キューから削除（emit remove も自動で行われる）
      removeFromQueue(id);
    }, duration);
    // ハンドルを登録
    timers.set(id, handle);
  };

  // toast を追加する内部実装（dedupeKey の置換も処理）
  const pushToast = (input: ToastInput): string => {
    // dispose 後は何もせず空文字 ID を返す（呼出側がその ID で dismiss しても no-op）
    if (disposed) {
      return "";
    }
    // dedupeKey 一致の既存トーストがあれば置換（同じ ID を再利用）
    if (input.dedupeKey !== undefined) {
      // 既存通知を探す
      const existing = findByDedupeKey(queue, input.dedupeKey);
      // 既存があり、かつ toast の場合に限り置換
      if (existing !== null && existing.notification.kind === "toast") {
        // 既存のタイマーを停止（duration をリセット）
        clearTimer(existing.notification.id);
        // 置換後の duration（未指定なら defaultDuration を採用）
        const nextDuration = input.duration ?? defaultDuration;
        // 置換後の通知（ID と createdAt は据え置き、内容のみ更新）
        const replaced: ToastNotification = {
          ...existing.notification,
          level: input.level ?? existing.notification.level,
          title: input.title,
          message: input.message,
          duration: nextDuration,
          actions: freezeActions(input.actions),
          meta: freezeMeta(input.meta),
        };
        // 配列の同じ位置に上書き
        const frozen = freezeNotification(replaced);
        queue[existing.index] = frozen;
        // update イベントを通知
        emit({ type: "update", notification: frozen });
        // duration > 0 なら自動消去タイマーを再設定
        scheduleAutoDismiss(frozen.id, nextDuration);
        // ID は据え置きで返す
        return frozen.id;
      }
    }
    // 新規 toast の生成
    const id = idFactory();
    // 表示時間（未指定なら defaultDuration を採用）
    const duration = input.duration ?? defaultDuration;
    // 完成オブジェクト
    const notification: ToastNotification = {
      id,
      kind: "toast",
      level: input.level ?? "info",
      title: input.title,
      message: input.message,
      duration,
      actions: freezeActions(input.actions),
      meta: freezeMeta(input.meta),
      dedupeKey: input.dedupeKey,
      createdAt: now(),
    };
    const frozenNotification = freezeNotification(notification);
    // キュー末尾に追加
    queue.push(frozenNotification);
    // add イベントを通知
    emit({ type: "add", notification: frozenNotification });
    // 上限超過のときは最古 toast を破棄
    enforceQueueLimit();
    // duration > 0 なら自動消去タイマーを設定
    scheduleAutoDismiss(id, duration);
    // 利用側に ID を返す
    return id;
  };

  // dialog の本体（Promise を返す）
  const pushDialog = (input: DialogInput): Promise<DialogResult> => {
    // dispose 後は即座に dismissed:true で解決（pending には登録しない）
    if (disposed) {
      return Promise.resolve({ dismissed: true });
    }
    // 新規 ID を採番
    const id = idFactory();
    // 完成オブジェクト
    const notification: DialogNotification = {
      id,
      kind: "dialog",
      level: input.level ?? "info",
      title: input.title,
      message: input.message,
      actions: freezeActions(input.actions),
      dismissible: input.dismissible,
      meta: freezeMeta(input.meta),
      dedupeKey: input.dedupeKey,
      createdAt: now(),
    };
    const frozenNotification = freezeNotification(notification);
    // キュー末尾に追加
    queue.push(frozenNotification);
    // add イベントを通知
    emit({ type: "add", notification: frozenNotification });
    // 上限超過のときは最古 toast を破棄（dialog/confirm のみの場合は何も削除しない）
    enforceQueueLimit();
    // Promise を構築して pending に登録
    return new Promise<DialogResult>((resolve) => {
      pendingDialogs.set(id, { resolve });
    });
  };

  // confirm の本体（Promise<boolean> を返す）
  const pushConfirm = (input: ConfirmInput): Promise<boolean> => {
    // dispose 後は即座に false 解決（pending には登録しない）
    if (disposed) {
      return Promise.resolve(false);
    }
    // 新規 ID を採番
    const id = idFactory();
    // 完成オブジェクト（既定 level は警告）
    const notification: ConfirmNotification = {
      id,
      kind: "confirm",
      level: input.level ?? "warning",
      title: input.title,
      message: input.message,
      confirmLabel: input.confirmLabel,
      cancelLabel: input.cancelLabel,
      destructive: input.destructive,
      meta: freezeMeta(input.meta),
      dedupeKey: input.dedupeKey,
      createdAt: now(),
    };
    const frozenNotification = freezeNotification(notification);
    // キュー末尾に追加
    queue.push(frozenNotification);
    // add イベントを通知
    emit({ type: "add", notification: frozenNotification });
    // 上限超過のときは最古 toast を破棄
    enforceQueueLimit();
    // Promise 構築 + pending 登録
    return new Promise<boolean>((resolve) => {
      pendingConfirms.set(id, { resolve });
    });
  };

  // dialog を reason 付きで解決する（UI 側のボタン押下用）
  const resolveDialog = (id: string, reason?: string): void => {
    // 防御的ガード：現状の dispose 実装では pendingDialogs が空になるためガードを外しても自然に no-op だが、
    // 将来 dispose の振る舞いが変わった場合の安全弁として明示的に残す
    if (disposed) {
      return;
    }
    // 該当 pending を取り出し
    const pending = pendingDialogs.get(id);
    // 未登録 ID なら何もしない（idempotent）
    if (pending === undefined) {
      return;
    }
    // 登録を解除（多重解決防止）
    pendingDialogs.delete(id);
    // キューから削除（remove イベントも発火）
    removeFromQueue(id);
    // 解決
    pending.resolve({ dismissed: true, reason });
  };

  // confirm を boolean で解決する
  const resolveConfirm = (id: string, value: boolean): void => {
    // 防御的ガード：現状の dispose 実装では pendingConfirms が空になるためガードを外しても自然に no-op だが、
    // 将来 dispose の振る舞いが変わった場合の安全弁として明示的に残す
    if (disposed) {
      return;
    }
    // 該当 pending を取り出し
    const pending = pendingConfirms.get(id);
    // 未登録 ID なら何もしない（idempotent）
    if (pending === undefined) {
      return;
    }
    // 登録を解除
    pendingConfirms.delete(id);
    // キューから削除
    removeFromQueue(id);
    // 解決
    pending.resolve(value);
  };

  // 指定 ID を閉じる（toast / dialog / confirm のいずれにも対応）
  const dismiss = (id: string): void => {
    // 防御的ガード：現状の dispose 実装では queue / pending が空になるためガードを外しても自然に no-op だが、
    // 将来 dispose の振る舞いが変わった場合の安全弁として明示的に残す
    if (disposed) {
      return;
    }
    // pending な dialog があれば dismissed として解決（reason は undefined）
    if (pendingDialogs.has(id)) {
      // 既存の解決ルートで完結させる
      resolveDialog(id, undefined);
      return;
    }
    // pending な confirm があれば false で解決
    if (pendingConfirms.has(id)) {
      resolveConfirm(id, false);
      return;
    }
    // それ以外（toast 等）は単にキューから削除
    removeFromQueue(id);
  };

  // 全削除（kind 指定があればその種別だけ）
  const dismissAll = (kind?: NotificationKind): void => {
    // 防御的ガード：現状の dispose 実装では queue が空になるためガードを外しても自然に no-op だが、
    // 将来 dispose の振る舞いが変わった場合の安全弁として明示的に残す
    if (disposed) {
      return;
    }
    // 削除対象 ID の一覧を先に作る（forEach 中の配列改変回避）
    const targets = queue
      .filter((n) => kind === undefined || n.kind === kind)
      .map((n) => n.id);
    // 順次 dismiss
    for (const id of targets) {
      dismiss(id);
    }
  };

  // subscribe 実装：listener を登録し、解除関数を返す
  const subscribe = (listener: NotificationListener): (() => void) => {
    // dispose 後は listener を登録せず、no-op の解除関数だけ返す
    if (disposed) {
      return () => {};
    }
    // listener 登録
    listeners.add(listener);
    // 解除関数（再呼び出し安全）
    return () => {
      listeners.delete(listener);
    };
  };

  // dispose: タイマー停止と pending 解決、購読者への remove 通知
  const dispose = (): void => {
    // 二度目以降の dispose は no-op（冪等性を保証）
    if (disposed) {
      return;
    }
    // フラグを先に立てる（emit 中の dispose 再呼び出しでも先に弾く）
    disposed = true;
    // 全タイマーを停止
    for (const id of Array.from(timers.keys())) {
      clearTimer(id);
    }
    // 購読者へ remove イベントを発火するための queue スナップショット
    // listeners をクリアする前にイベントを送り、UI 側もキュー空に同期できるようにする
    const snapshot = queue.slice();
    // キュー本体を先に空にする（emit 中に getAll() が呼ばれても空になっている）
    queue = [];
    // スナップショット順に remove イベントを発火
    for (const notification of snapshot) {
      emit({ type: "remove", notification });
    }
    // 全 dialog を未指定で解決（remove イベント発火後に解決）
    for (const id of Array.from(pendingDialogs.keys())) {
      // 同期処理中なので keys() で得た id は必ず get() で値を持つ（! で非 null を断言）
      const pending = pendingDialogs.get(id)!;
      pendingDialogs.delete(id);
      pending.resolve({ dismissed: true });
    }
    // 全 confirm を false で解決
    for (const id of Array.from(pendingConfirms.keys())) {
      // 同上：必ず値が存在する
      const pending = pendingConfirms.get(id)!;
      pendingConfirms.delete(id);
      pending.resolve(false);
    }
    // listener 群をクリア（全イベント発火後に解放）
    listeners.clear();
  };

  // Manager 公開オブジェクト
  return {
    // toast 発行
    toast: pushToast,
    // dialog 発行
    dialog: pushDialog,
    // confirm 発行
    confirm: pushConfirm,
    // 個別閉じる
    dismiss,
    // まとめて閉じる
    dismissAll,
    // dialog/confirm の解決 API
    resolveDialog,
    resolveConfirm,
    // 現在の通知一覧スナップショット（読み取り専用）
    getAll: () => queue.slice(),
    // 購読
    subscribe,
    // クリーンアップ
    dispose,
  };
}
