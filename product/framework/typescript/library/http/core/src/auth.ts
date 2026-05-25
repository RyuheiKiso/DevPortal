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
export function createStaticAuth(
  headers: Record<string, string>,
): AuthProvider {
  return {
    // getAuthHeaders 実装：渡されたヘッダをコピーして返す（外部からの mutation を避ける）
    async getAuthHeaders(): Promise<Record<string, string>> {
      return { ...headers };
    },
  };
}
