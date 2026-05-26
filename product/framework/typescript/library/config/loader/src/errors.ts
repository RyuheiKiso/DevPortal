// 失敗種別を識別するためのコード型を取り込む
import type { LoaderErrorCode } from "./types.js";

// loader が投げる唯一のエラークラス
// code で分岐し、cause で元エラーを保持して情報を失わない
export class ConfigLoaderError extends Error {
  // 失敗種別 (呼び出し側はこの値で switch する想定)
  readonly code: LoaderErrorCode;

  // メッセージ・コード・原因エラーを受け取って初期化する
  constructor(
    // 人間可読のエラーメッセージ
    message: string,
    // 失敗種別を表すコード
    code: LoaderErrorCode,
    // 元の例外 (なければ undefined)
    cause?: unknown,
  ) {
    // Error ベースクラスに message と cause を渡す
    // (cause は ES2022 標準オプションのため第二引数オブジェクトで指定)
    super(message, cause === undefined ? undefined : { cause });
    // instanceof 判定が壊れないように name を明示
    this.name = "ConfigLoaderError";
    // code フィールドへ格納
    this.code = code;
  }
}
