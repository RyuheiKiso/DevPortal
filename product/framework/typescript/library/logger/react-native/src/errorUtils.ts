// core の Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";

// React Native の ErrorUtils 型（公開されていないため最低限のシグネチャを宣言）
// 実装環境によっては getGlobalHandler が undefined / null を返すことがあるため、
// 戻り値型をユニオンにして null チェックを必須にしている
interface RNErrorUtils {
  // 既存のグローバルエラーハンドラを取得 (未設定なら undefined / null を返しうる)
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | undefined | null;
  // グローバルエラーハンドラを差し替え
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

// ハンドラ型 (関数または未設定)
type ErrorHandlerFn = (error: unknown, isFatal?: boolean) => void;

// global からの取り出し時に使う型
type GlobalWithErrorUtils = typeof globalThis & { ErrorUtils?: RNErrorUtils };

// グローバルハンドラ登録時のオプション
export interface NativeGlobalHandlerOptions {
  // isFatal=true のときに使うレベル（既定: "fatal"）
  fatalLevel?: "fatal" | "error";
  // isFatal=false のときに使うレベル（既定: "error"）
  nonFatalLevel?: "fatal" | "error" | "warn";
  // ハンドラ実行後に直前のハンドラを呼ぶか（既定: true。RN の赤画面表示を保持）
  callPreviousHandler?: boolean;
}

// ErrorUtils.setGlobalHandler を使ってグローバル例外を Logger に流す
// 戻り値は冪等な解除関数（直前のハンドラに戻す）
export function installGlobalErrorHandler(
  logger: Logger,
  options: NativeGlobalHandlerOptions = {},
): () => void {
  // ErrorUtils をグローバルから取得（React Native ランタイムで提供される）
  const target = globalThis as GlobalWithErrorUtils;
  const errorUtils = target.ErrorUtils;
  // ErrorUtils が存在しない環境（テスト等）では no-op
  if (errorUtils === undefined) {
    return () => {};
  }

  // オプションの既定値を確定
  const fatalLevel = options.fatalLevel ?? "fatal";
  const nonFatalLevel = options.nonFatalLevel ?? "error";
  const callPrevious = options.callPreviousHandler ?? true;
  // 直前のハンドラを保持（解除時に戻すため）
  // ErrorUtils 実装によっては未登録時に undefined / null を返すため、
  // 必ず関数型かどうかをチェックしてから保持する (typeof !== "function" は null として正規化)
  const rawPrevious = errorUtils.getGlobalHandler();
  const previous: ErrorHandlerFn | null = typeof rawPrevious === "function" ? rawPrevious : null;

  // 新しいハンドラ
  const handler = (error: unknown, isFatal?: boolean): void => {
    // レベルを選択
    const level = isFatal ? fatalLevel : nonFatalLevel;
    // Logger に通知（fatal は logger.fatal、それ以外は logger[level]）
    logger[level]("react-native.globalError", { error, isFatal });
    // 直前のハンドラを呼ぶ設定 _かつ_ previous が関数のときのみ呼ぶ
    // (旧実装は previous が undefined のとき `previous is not a function` で throw していた)
    if (callPrevious && previous !== null) {
      previous(error, isFatal);
    }
  };

  // グローバルハンドラを差し替え
  errorUtils.setGlobalHandler(handler);

  // 解除済みフラグ
  let removed = false;
  // 解除関数: 自身が最新ハンドラのときだけ直前のハンドラに戻す
  // （他者が後から付け替えていた場合はその handler を尊重して触らない）
  return () => {
    // 二重解除を防ぐ
    if (removed) {
      return;
    }
    removed = true;
    // 現在のグローバルハンドラを確認
    const current = errorUtils.getGlobalHandler();
    // 自身が install した handler のままなら previous に戻す。違うなら他者が上書きしているので何もしない
    if (current === handler) {
      // previous が null の場合は no-op handler を登録する (setGlobalHandler に
      // undefined/null を渡すと環境によっては落ちるため、空関数で安全に戻す)
      errorUtils.setGlobalHandler(previous ?? ((): void => undefined));
    }
  };
}
