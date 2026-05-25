// core の Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";

// グローバルハンドラ登録時の追加オプション
export interface GlobalHandlersOptions {
  // 未処理 Promise を fatal レベルにする（既定: false。error レベルで出す）
  fatalForUnhandled?: boolean;
}

// モジュールスコープのアクティブハンドル管理（HMR / 重複呼び出しでの listener 増殖を防ぐ）
// logger インスタンスごとに最新の解除関数を保持し、再登録時に古いものを解除する
const activeUninstall = new WeakMap<Logger, () => void>();

// window.onerror / unhandledrejection を Logger に流すユーティリティ
// 戻り値は冪等な解除関数。SSR 環境では no-op として何もせず () => void を返す。
// 同じ logger で再度呼ばれた場合は、内部で前回登録を解除してから新規登録する。
export function installGlobalHandlers(
  logger: Logger,
  options: GlobalHandlersOptions = {},
): () => void {
  // SSR 環境（window が無い）では何もせず no-op の解除関数を返す
  if (typeof window === "undefined") {
    return () => {};
  }

  // 同一 logger に対する以前の登録があれば先に解除（HMR / StrictMode 二重マウント対策）
  const prev = activeUninstall.get(logger);
  if (prev !== undefined) {
    prev();
  }

  // unhandledrejection をどのレベルで通知するか
  const rejectionLevel: "error" | "fatal" = options.fatalForUnhandled ? "fatal" : "error";

  // 同期エラー用のハンドラ（window.onerror）
  const handleError = (event: ErrorEvent): void => {
    // error が Error 形式で取得できればそれを、無ければ message を使う
    logger.error("window.onerror", {
      error: event.error ?? event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };

  // 未処理 Promise rejection のハンドラ
  const handleRejection = (event: PromiseRejectionEvent): void => {
    // reason を error として渡す（rejectionLevel に応じて呼ぶメソッドを切替）
    logger[rejectionLevel]("window.unhandledrejection", { error: event.reason });
  };

  // イベントを登録
  window.addEventListener("error", handleError);
  // 未処理 Promise rejection も登録
  window.addEventListener("unhandledrejection", handleRejection);

  // 解除済みフラグ（冪等性を保つ）
  let removed = false;
  // 解除関数本体
  const uninstall = (): void => {
    // 既に解除済みなら何もしない
    if (removed) {
      return;
    }
    // フラグ更新
    removed = true;
    // それぞれのリスナを解除
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
    // WeakMap から自身を削除（自分が最新なら）
    // 単一スレッド JS では再 install 時の prev() 実行中も WeakMap は前回の uninstall を保持しているため
    // この比較は常に真となるが、将来の並行モデル変更や手動マップ操作に備えた防衛的チェック
    /* v8 ignore next 3 */
    if (activeUninstall.get(logger) === uninstall) {
      activeUninstall.delete(logger);
    }
  };
  // 最新の uninstall を WeakMap に記録
  activeUninstall.set(logger, uninstall);
  // 戻り値として呼出側に解除関数を返す
  return uninstall;
}
