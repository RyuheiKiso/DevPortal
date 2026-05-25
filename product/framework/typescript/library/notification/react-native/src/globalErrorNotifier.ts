// core から HttpError 連携と必要型を取り込み
import {
  fromHttpError,
  isHttpErrorLike,
  type NotificationManager,
  type ToastInput,
} from "@k1s0-ts-notification/core";

// React Native ErrorUtils の最小契約（duck typing）
interface RNErrorUtils {
  // 現在の global error handler を取得
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  // global error handler を差し替える
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

// globalThis に ErrorUtils が乗っているかを表す型
type GlobalWithErrorUtils = typeof globalThis & { ErrorUtils?: RNErrorUtils };

// 最小 Logger 契約（debug/info/warn/error の 4 メソッド）
// 反変性の都合で @k1s0-ts-logger/core の Logger 型をそのまま代入することはできないため、
// 必要なら 4 メソッドを満たす thin wrapper を作って渡してください。
export interface Logger {
  // デバッグ詳細
  debug(message: string, context?: unknown): void;
  // 通常情報
  info(message: string, context?: unknown): void;
  // 警告
  warn(message: string, context?: unknown): void;
  // エラー
  error(message: string, context?: unknown): void;
}

// 何もしない Logger 実装（logger 未指定時のフォールバック）
// 利用側が logger を渡さない場合の後方互換 100% / silent
const noopLogger: Logger = {
  /* v8 ignore next 3 */
  debug: (): void => {
    // noop（contract 維持のためのプレースホルダ）
  },
  /* v8 ignore next 3 */
  info: (): void => {
    // noop（contract 維持のためのプレースホルダ）
  },
  warn: (): void => {
    // noop（logger 未指定時の warn は意図的に黙る）
  },
  error: (): void => {
    // noop（logger 未指定時の error は意図的に黙る）
  },
};

// logger 自身が throw しても globalErrorNotifier 全体を破綻させないための一段ラッパ
// logger.warn / logger.error が throw する設定でも、try で囲んで完全に黙らせる
function safelyLog(
  logger: Logger,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: unknown,
): void {
  try {
    // 該当メソッドを呼ぶ
    logger[level](message, context);
  } catch {
    // logger 自体が壊れていても global handler 経路の保護を最優先
  }
}

// installGlobalErrorNotifier に渡すオプション
export interface GlobalErrorNotifierOptions {
  // fatal なエラーで使う既定レベル（未指定なら "error"）
  fatalLevel?: "error" | "warning";
  // fatal でないエラーで使う既定レベル（未指定なら "error"）
  nonFatalLevel?: "error" | "warning" | "info";
  // 既存ハンドラを後段で呼ぶか（既定 true）
  callPreviousHandler?: boolean;
  // dedupeKey を error ごとに決める関数（任意）
  dedupeKey?: (error: unknown, isFatal: boolean) => string | undefined;
  // toast 入力を完全に組み立てる関数（任意。指定があれば既定マッピングを使わない）
  buildToast?: (error: unknown, isFatal: boolean) => ToastInput;
  // 不可視な失敗（ErrorUtils 不在、toast 例外、resolver 例外など）を log するための任意 logger
  // 未指定時は noopLogger（後方互換 100% / silent）
  logger?: Logger;
  // previous handler を呼ぶときに `isFatal` を normalize 済み boolean に変換するか
  // 既定 false: 元の `isFatal`（undefined 含む）をそのまま渡す（Sentry/Bugsnag 等の下流契約を保つ）
  // true: `isFatal === true` の正規化結果（boolean）を渡す
  normalizeFatalForPrevious?: boolean;
}

// 同一 NotificationManager に対する直近の uninstall を保持する WeakMap
// 二重 install 時に前の install を自動 uninstall するためのレジストリ
const activeUninstallByManager = new WeakMap<NotificationManager, () => void>();

// グローバルエラーを通知 manager に流すハンドラを設置する
// 戻り値はアンインストール関数（idempotent）。ErrorUtils 不在の環境では no-op 関数を返す。
export function installGlobalErrorNotifier(
  manager: NotificationManager,
  options: GlobalErrorNotifierOptions = {},
): () => void {
  // 型確定済みの globalThis 経由で ErrorUtils を取得
  const target = globalThis as GlobalWithErrorUtils;
  const errorUtils = target.ErrorUtils;
  // logger は早めに確定（以降の経路で共通利用）
  const logger = options.logger ?? noopLogger;
  // ErrorUtils が無い環境（テスト / Web / SSR）では何もしない
  if (errorUtils === undefined) {
    // 失敗ではなく「環境不一致」なので warn 相当で記録（safelyLog 経由なので logger throw でも安全）
    safelyLog(logger, "warn", "globalErrorNotifier.errorUtilsUnavailable", undefined);
    return () => {};
  }

  // 同一 manager に対する重複 install は前の uninstall を先に呼んでから上書きする
  // これにより toast の N 重発火やハンドラチェーンの肥大化を防ぐ
  const previousUninstall = activeUninstallByManager.get(manager);
  if (previousUninstall !== undefined) {
    // 開発者に重複に気付かせるための warn（safelyLog 経由）
    safelyLog(logger, "warn", "globalErrorNotifier.replacingPreviousInstall", undefined);
    // 既存 uninstall が throw しても install を続行できるよう try で囲む
    try {
      previousUninstall();
    } catch (cause) {
      safelyLog(logger, "error", "globalErrorNotifier.previousUninstallFailed", { cause });
    }
  }

  // 既定値の確定
  const fatalLevel = options.fatalLevel ?? "error";
  const nonFatalLevel = options.nonFatalLevel ?? "error";
  const callPrevious = options.callPreviousHandler ?? true;
  // 後段に流すための旧 global handler を保存（getter が throw する稀ケースもガード）
  let previous: (error: unknown, isFatal?: boolean) => void;
  try {
    previous = errorUtils.getGlobalHandler();
  } catch (cause) {
    // 取得失敗時は no-op fallback を据える（install 自体は続行）
    safelyLog(logger, "error", "globalErrorNotifier.getPreviousHandlerFailed", { cause });
    previous = () => {};
  }

  // toast 入力を manager に渡す共通処理
  // - dedupeKey を後付けする（input に明示があればそれを優先）
  // - manager.toast 例外は握り潰すが logger.error で表面化する（safelyLog 経由）
  const toast = (input: ToastInput, dedupeKey: string | undefined): void => {
    // resolver 由来の dedupeKey は input.dedupeKey が未指定のときだけ付与
    const merged = input.dedupeKey === undefined && dedupeKey !== undefined
      ? { ...input, dedupeKey }
      : input;
    try {
      manager.toast(merged);
    } catch (cause) {
      // RN の global handler 経路を維持するため例外は呼出側に伝播させない
      // safelyLog で logger 自体の throw からも保護
      safelyLog(logger, "error", "globalErrorNotifier.toastFailed", { cause });
    }
  };

  // 任意の値を安全に文字列化する
  // - 通常は `error.message` または error 文字列、それ以外は String(error)
  // - String() / 値の toString が throw する poisoned 値でも例外を出さない
  const safeMessageFromError = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    // 任意 object 等は String 化を試みるが、toString/Symbol.toPrimitive が throw するケースを想定
    try {
      return String(error);
    } catch {
      return "[unconvertible error]";
    }
  };

  // ErrorUtils に登録する新ハンドラ
  const handler = (error: unknown, isFatal?: boolean): void => {
    // fatal の boolean 化（undefined を false に丸める。内部 / resolver 引数用）
    const fatal = isFatal === true;

    // dedupeKey resolver は独立 try/catch で保護（resolver 例外で handler 全体を死なせない）
    let dedupeKey: string | undefined;
    try {
      dedupeKey = options.dedupeKey?.(error, fatal);
    } catch (cause) {
      safelyLog(logger, "error", "globalErrorNotifier.dedupeKeyResolverFailed", { cause });
    }

    // buildToast / fromHttpError / 既定フォールバック全体を外殻 try/catch で保護
    // これにより buildToast の throw、fromHttpError の予期せぬ throw、String(error) の throw すべてを握る
    try {
      // buildToast 指定時はそれを優先
      if (options.buildToast !== undefined) {
        toast(options.buildToast(error, fatal), dedupeKey);
      } else if (isHttpErrorLike(error)) {
        // HttpErrorLike なら core の標準マッピングを通す
        toast(fromHttpError(error, { dedupeKey }), undefined);
      } else {
        // 上記いずれでもない場合はレベルだけ決めて生文字列で toast
        const level = fatal ? fatalLevel : nonFatalLevel;
        const message = safeMessageFromError(error);
        toast({ level, message }, dedupeKey);
      }
    } catch (cause) {
      // buildToast / fromHttpError / 文字列化のいずれかが throw した場合の最終防衛線
      safelyLog(logger, "error", "globalErrorNotifier.handlerFailed", { cause });
    }

    // 必要なら旧 handler を後段で呼ぶ
    // 既定では元の `isFatal`（undefined 含む）をそのまま渡し、下流の Sentry/Bugsnag 等の契約を保つ
    // `normalizeFatalForPrevious: true` 指定時のみ正規化済み boolean を渡す
    if (callPrevious) {
      const fatalForPrevious = options.normalizeFatalForPrevious === true ? fatal : isFatal;
      try {
        previous(error, fatalForPrevious);
      } catch (cause) {
        // previous handler の throw も握って global handler 経路を維持
        safelyLog(logger, "error", "globalErrorNotifier.previousHandlerFailed", { cause });
      }
    }
  };

  // global handler を差し替え（setGlobalHandler が throw する稀ケースもガード）
  try {
    errorUtils.setGlobalHandler(handler);
  } catch (cause) {
    // 失敗時は install 失敗とみなし、no-op uninstall を返す
    safelyLog(logger, "error", "globalErrorNotifier.setGlobalHandlerFailed", { cause });
    return () => {};
  }

  // 二重 uninstall を防ぐためのフラグ
  let removed = false;
  // uninstall 関数（self-reference 化のため変数宣言を分離）
  const uninstall = (): void => {
    // 二度目以降は no-op
    if (removed) {
      return;
    }
    removed = true;
    // 自分が現役の handler の場合だけ復元（他に差し替えられていたら触らない）
    let current: ((error: unknown, isFatal?: boolean) => void) | undefined;
    try {
      current = errorUtils.getGlobalHandler();
    } catch (cause) {
      // 取得失敗時は復元処理を諦める
      safelyLog(logger, "error", "globalErrorNotifier.getCurrentHandlerFailed", { cause });
    }
    if (current === handler) {
      // 復元の throw もガード
      try {
        errorUtils.setGlobalHandler(previous);
      } catch (cause) {
        safelyLog(logger, "error", "globalErrorNotifier.restorePreviousFailed", { cause });
      }
    }
    // 自分の uninstall が WeakMap に登録されたままなら除去
    // （他の install で上書きされていた場合は触らない）
    if (activeUninstallByManager.get(manager) === uninstall) {
      activeUninstallByManager.delete(manager);
    }
  };
  // WeakMap に自分の uninstall を登録（次回 install 時の自動置換に使う）
  activeUninstallByManager.set(manager, uninstall);
  return uninstall;
}
