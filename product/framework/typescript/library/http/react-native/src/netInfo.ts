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
    // Promise executor 内のシーケンスを以下の順序で再構成して race を排除する:
    //   ① disposed / aborted の事前チェック (即時 reject)
    //   ② waiter 構築 + onAbort 定義
    //   ③ signal への abort リスナ登録
    //   ④ online 再チェック (登録の前後で復帰した場合に即 resolve)
    //   ⑤ aborted 再チェック (③ で同期発火しなかったが間際で abort された場合)
    //   ⑥ waiters 配列へ push
    // ③〜⑥ の間で online 復帰 / abort が起きても、listener 登録済み + 後段の再チェックにより
    // waiter がキューに居残るリーク (= waiter が永遠に解放されない) を防ぐ。
    await new Promise<void>((resolve, reject) => {
      // 共通 reject helper (HttpError を組み立てて reject する)
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
      // ① 事前チェック: dispose 後 / 既に abort 済みなら即 reject
      if (disposed) {
        rejectWith("netInfo aware disposed", "OFFLINE");
        return;
      }
      if (req.signal?.aborted === true) {
        rejectWith("request aborted while offline", "ABORTED", getAbortReason(req.signal));
        return;
      }
      // ② waiter を構築 (onAbort は ③ で登録するため先に組み立てる)
      const waiter: OfflineWaiter = {
        resolve,
        reject: (err) => reject(err),
        requestId: req.requestId,
        signal: req.signal,
      };
      // abort 発火時のハンドラ: 自分が waiters に居れば抜き、reject する
      waiter.onAbort = (): void => {
        // 自分の位置を捜して取り除く (まだ push されていない場合は -1 で no-op)
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        // reject する (Promise 既決ならこの reject は no-op)
        rejectWith("request aborted while offline", "ABORTED", getAbortReason(req.signal));
      };
      // ③ signal への abort リスナ登録 (once:true なので 1 回で自動解除)
      if (req.signal !== undefined) {
        req.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      // ④ online 再チェック: ① と ③ の間に online が回復した場合は即 resolve
      // (NetInfo の addEventListener コールバックは別タスクで発火するため、ここで online が true なら
      //  リスナによる解放を待たずに直接 resolve しても安全)
      // ※ 同期実行内では online が変化しない実装が大半だが、将来 ② の中で await を挟む変更や
      //   NetInfo 実装の差異 (同期発火) に備えた防御コード。テストでの自然な到達は困難なため
      //   coverage からは除外する。
      /* v8 ignore next 8 */
      if (online) {
        // 登録した abort リスナを除去 (リーク防止)
        if (req.signal !== undefined && waiter.onAbort !== undefined) {
          req.signal.removeEventListener("abort", waiter.onAbort);
        }
        resolve();
        return;
      }
      // ⑤ aborted 再チェック: ③ の登録より前に abort が立っていた可能性を補完
      // (現代の AbortSignal.addEventListener は abort 後の登録でリスナを発火させないため、
      //  ここで明示的に再チェックしないとリーク経路が残る)
      // ※ TypeScript は ① の早期 return で `signal.aborted` を false に狭めるが、
      //   実行時には ②〜④ の間に変化しうるため、`Boolean(...)` で narrowing を解除する。
      //   同期実行内では到達しないが、AbortSignal 実装差異への防御として残す。
      /* v8 ignore next 7 */
      if (Boolean(req.signal?.aborted)) {
        if (req.signal !== undefined && waiter.onAbort !== undefined) {
          req.signal.removeEventListener("abort", waiter.onAbort);
        }
        rejectWith("request aborted while offline", "ABORTED", getAbortReason(req.signal));
        return;
      }
      // ⑥ ここまで来たら本当にオフラインかつ未 abort、列に並ぶ
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
