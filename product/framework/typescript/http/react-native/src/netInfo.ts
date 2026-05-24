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
  // オフライン時に待機している resolver 群
  const waiters: Array<() => void> = [];
  // 状態変化を購読し、unsubscribe を保持（A9）
  const unsubscribe = mod.addEventListener((state) => {
    const next = state.isConnected === true;
    // オフライン→オンライン復帰時に待機中の resolver を解放
    if (!online && next) {
      const list = waiters.splice(0, waiters.length);
      for (const fn of list) {
        fn();
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
    // queueWhenOffline: オンライン復帰を待つ（Promise を保留、dispose で reject）
    await new Promise<void>((resolve, reject) => {
      // dispose 後に enqueue されたら即 reject
      if (disposed) {
        reject(
          new HttpError({
            message: "netInfo aware disposed",
            code: "OFFLINE",
            retryable: false,
            requestId: req.requestId,
          }),
        );
        return;
      }
      waiters.push(resolve);
    });
    return req;
  };
  // dispose: 購読解除 + 待機中の resolver を解放（ループからの出口を与える）
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    // 待機中の resolver を全部解放（後段 interceptor で online 判定が false なら再度 reject される）
    const pending = waiters.splice(0, waiters.length);
    for (const fn of pending) {
      fn();
    }
  };
  // 既存 interceptors の後ろに追加して派生クライアントを返す
  const wrapped = client.withConfig({
    requestInterceptors: [interceptor],
  });
  return { client: wrapped, dispose };
}
