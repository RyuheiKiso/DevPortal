// HTTP クライアント関連の型と HttpError を core から取り込み
import { HttpError } from "@k1s0-ts-http/core";
import type {
  HttpClient,
  Logger,
  RequestInterceptor,
} from "@k1s0-ts-http/core";

// NetInfo モジュールの最小型契約（@react-native-community/netinfo を直接 import しない）
interface NetInfoState {
  // 接続状態（true / false / null）
  isConnected: boolean | null;
}
interface NetInfoModule {
  // 状態変化購読（unsubscribe 関数を返す）
  addEventListener: (handler: (state: NetInfoState) => void) => () => void;
  // 現在状態を 1 回取得（初期値解決用、A10）
  fetch: () => Promise<NetInfoState>;
}

interface OfflineWaiter {
  resolve: () => void;
  reject: (err: HttpError) => void;
  requestId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function getAbortReason(signal: AbortSignal | undefined): unknown {
  return (signal as { reason?: unknown } | undefined)?.reason;
}

// createNetInfoAware のオプション
export interface NetInfoAwareOptions {
  // オフライン時に即 reject するか（既定 true、queueWhenOffline と排他）
  rejectWhenOffline?: boolean;
  // オフライン時にキューイングしてオンライン復帰時に再開するか（既定 false）
  queueWhenOffline?: boolean;
  // 状態変化を記録する Logger（任意）
  logger?: Logger;
}

// createNetInfoAware の戻り値（client と subscriber 解除用 dispose を返す、A9）
export interface NetInfoAware {
  // wrap された HttpClient（Provider に渡す）
  client: HttpClient;
  // NetInfo 購読を解除し、待機中の waiters を offline として reject する（unmount 時に呼ぶ）
  dispose: () => void;
}

// 親 HttpClient を wrap し NetInfo による接続監視を加える
// @react-native-community/netinfo が未インストールなら no-op として親クライアント + 空 dispose を返す
export async function createNetInfoAware(
  client: HttpClient,
  opts: NetInfoAwareOptions = {},
): Promise<NetInfoAware> {
  // peerDep の動的 import を試みる
  let mod: NetInfoModule | undefined = undefined;
  try {
    // default export として NetInfo を取得
    const imported = (await import("@react-native-community/netinfo")) as {
      default: NetInfoModule;
    };
    mod = imported.default;
  } catch {
    // 未インストール環境では no-op で親クライアントを返す
    return { client, dispose: () => undefined };
  }
  // 設定値の解決（既定: reject 派）
  const rejectWhenOffline = opts.rejectWhenOffline ?? true;
  const queueWhenOffline = opts.queueWhenOffline ?? false;
  const logger = opts.logger;
  // 初期状態を fetch で取得（楽観前提を回避、A10）
  const initial = await mod.fetch();
  let online = initial.isConnected === true;
  // オフライン時に待機している request 群
  const waiters: OfflineWaiter[] = [];
  // 状態変化を購読し、unsubscribe を保持（A9）
  const unsubscribe = mod.addEventListener((state) => {
    const next = state.isConnected === true;
    // オフライン→オンライン復帰時に待機中の resolver を解放
    if (!online && next) {
      const list = waiters.splice(0, waiters.length);
      for (const waiter of list) {
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.resolve();
      }
      logger?.info("netinfo.online", { resumed: list.length });
    } else if (online && !next) {
      logger?.warn("netinfo.offline");
    }
    online = next;
  });
  // dispose 済みフラグ
  let disposed = false;
  // request interceptor として接続状態をチェック
  const interceptor: RequestInterceptor = async (req) => {
    // オンラインなら素通し
    if (online) return req;
    // オフライン時の挙動を分岐
    if (rejectWhenOffline && !queueWhenOffline) {
      // 即時 reject
      throw new HttpError({
        message: "offline",
        code: "OFFLINE",
        retryable: false,
        requestId: req.requestId,
      });
    }
    // queueWhenOffline: オンライン復帰を待つ。signal abort / dispose では reject する。
    await new Promise<void>((resolve, reject) => {
      const rejectWith = (message: string, code: string, cause?: unknown): void => {
        reject(
          new HttpError({
            message,
            code,
            retryable: false,
            requestId: req.requestId,
            cause,
          }),
        );
      };
      // dispose 後に enqueue されたら即 reject
      if (disposed) {
        rejectWith("netInfo aware disposed", "OFFLINE");
        return;
      }
      if (req.signal?.aborted === true) {
        rejectWith("request aborted while offline", "ABORTED", getAbortReason(req.signal));
        return;
      }
      const waiter: OfflineWaiter = {
        resolve,
        reject: (err) => reject(err),
        requestId: req.requestId,
        signal: req.signal,
      };
      waiter.onAbort = (): void => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        rejectWith("request aborted while offline", "ABORTED", getAbortReason(req.signal));
      };
      if (req.signal !== undefined) {
        req.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      waiters.push(waiter);
    });
    if (disposed) {
      throw new HttpError({
        message: "netInfo aware disposed",
        code: "OFFLINE",
        retryable: false,
        requestId: req.requestId,
      });
    }
    return req;
  };
  // dispose: 購読解除 + 待機中の resolver を解放（ループからの出口を与える）
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    // 待機中 request を全部 reject する。
    const pending = waiters.splice(0, waiters.length);
    for (const waiter of pending) {
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(
        new HttpError({
          message: "netInfo aware disposed",
          code: "OFFLINE",
          retryable: false,
          requestId: waiter.requestId,
        }),
      );
    }
  };
  // 既存 interceptors の後ろに追加して派生クライアントを返す
  const wrapped = client.withConfig({
    requestInterceptors: [interceptor],
  });
  return { client: wrapped, dispose };
}
