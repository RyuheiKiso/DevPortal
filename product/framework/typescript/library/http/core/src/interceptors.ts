// interceptor の型を参照
import type {
  ErrorInterceptor,
  HttpRequest,
  HttpResponse,
  RequestInterceptor,
  ResponseInterceptor,
} from "./types.js";

// request interceptor 群を順次適用するヘルパ（reduce で連鎖）
export async function runRequestInterceptors(
  req: HttpRequest,
  list: readonly RequestInterceptor[],
): Promise<HttpRequest> {
  // 現在の req を作業変数として持つ
  let current = req;
  // 順次適用（前段の戻り値が次段の入力）
  for (const interceptor of list) {
    current = await interceptor(current);
  }
  return current;
}

// response interceptor 群を順次適用するヘルパ
export async function runResponseInterceptors(
  res: HttpResponse,
  list: readonly ResponseInterceptor[],
): Promise<HttpResponse> {
  // 現在の res を作業変数として持つ
  let current = res;
  // 順次適用
  for (const interceptor of list) {
    current = await interceptor(current);
  }
  return current;
}

// error interceptor 群を順次適用するヘルパ
// 契約上 interceptor は throw する責務だが、念のため最後に元エラーを throw する
export async function runErrorInterceptors(
  err: unknown,
  req: HttpRequest,
  list: readonly ErrorInterceptor[],
): Promise<never> {
  // 各 interceptor を順次起動（throw されたら呼び出し元へ伝播）
  for (const interceptor of list) {
    // 戻り値は never 型のはずだが、実装が return してきても次段で throw を継続
    await interceptor(err, req);
  }
  // 全 interceptor が throw しなかった場合の安全網として元エラーを throw
  throw err;
}
