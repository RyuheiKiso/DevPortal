// grpc-web 風 Client の rpcCall を Promise 化する薄いアダプタ
import { HttpError } from "../errors.js";
import type {
  GrpcCallError,
  GrpcMetadata,
  GrpcMethodDescriptor,
  GrpcWebLikeClient,
} from "./types.js";
import { grpcStatusToHttpError } from "./errors.js";

// rpcCall コールバックを Promise<Res> に変換する
// signal が abort された場合は HttpError(code: "ABORTED") で reject
export function invokeUnary<Req, Res>(
  client: GrpcWebLikeClient,
  url: string,
  request: Req,
  metadata: GrpcMetadata,
  desc: GrpcMethodDescriptor<Req, Res>,
  signal: AbortSignal | undefined,
  requestId: string,
): Promise<Res> {
  // signal.reason が TimeoutError なら TIMEOUT、それ以外は ABORTED として正規化
  const buildAbortError = (reason: unknown): HttpError => {
    // TimeoutError 由来の中断は別コードに分類（呼出側の判定容易化のため）
    const isTimeout = reason instanceof DOMException && reason.name === "TimeoutError";
    return new HttpError({
      message: isTimeout ? "request timed out" : "request aborted",
      code: isTimeout ? "TIMEOUT" : "ABORTED",
      retryable: false,
      requestId,
    });
  };
  return new Promise<Res>((resolve, reject) => {
    // 既に abort 済みなら即時 reject
    if (signal !== undefined && signal.aborted) {
      reject(buildAbortError(signal.reason));
      return;
    }
    // 解決済みフラグ（abort と通常完了が二重に走らないように）
    let settled = false;
    // abort 購読ハンドラ
    const onAbort = (): void => {
      // 二重解決防止（once:true で 1 度のみ呼ばれるが、callback が先に settled にした場合の安全網）
      /* v8 ignore next 3 */
      if (settled) {
        return;
      }
      settled = true;
      reject(buildAbortError(signal?.reason));
    };
    // signal がある場合のみ購読
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // rpcCall 実行（コールバックで成功/失敗を受け取る）
    client.rpcCall<Req, Res>(
      url,
      request,
      metadata,
      desc,
      (err: GrpcCallError | null, response: Res) => {
        // 二重解決防止（abort 後のコールバックを無視）
        if (settled) {
          return;
        }
        settled = true;
        // signal リスナを解除
        if (signal !== undefined) {
          signal.removeEventListener("abort", onAbort);
        }
        // gRPC 由来のエラーは HttpError に正規化して reject
        if (err !== null && err.code !== 0) {
          reject(grpcStatusToHttpError(err, requestId));
          return;
        }
        // 成功時は response をそのまま返す
        resolve(response);
      },
    );
  });
}
