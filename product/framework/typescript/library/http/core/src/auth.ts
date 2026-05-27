// AuthProvider 契約は types.ts に定義済み
import type { AuthProvider } from "./types.js";

// Bearer 認証用のヘッダ供給を簡単に作るヘルパ
// token は同期/非同期どちらでも返してよい（token 更新の async に対応）
export function createBearerAuth(
  getToken: () => string | Promise<string>,
): AuthProvider {
  return {
    // getAuthHeaders 実装：token を取得して Authorization ヘッダを返す
    async getAuthHeaders(): Promise<Record<string, string>> {
      // token を取得（同期戻りも await で吸収可能）
      const token = await getToken();
      // Bearer スキームで返却
      return { Authorization: `Bearer ${token}` };
    },
  };
}

// 静的なヘッダ集合を毎回返す AuthProvider を作るヘルパ
// 初期化時に 1 度だけスナップショットを取り、その後の外部 mutation は反映しない
// (利用者が「静的」と信じて頼ったコードが、後から差し換えられないことを保証する)
export function createStaticAuth(
  headers: Record<string, string>,
): AuthProvider {
  // ファクトリ呼出時点のスナップショットを closure に保持 (1 度だけコピー)
  const snapshot: Record<string, string> = { ...headers };
  // 万一 closure に保持した snapshot を `Object.assign` 等で書き換えられても影響を出さないため freeze
  Object.freeze(snapshot);
  return {
    // getAuthHeaders 実装：snapshot のコピーを返す (返り値の mutation も snapshot に伝播しない)
    async getAuthHeaders(): Promise<Record<string, string>> {
      // 利用者側の mutation を防ぐためにコピーを返す
      return { ...snapshot };
    },
  };
}
