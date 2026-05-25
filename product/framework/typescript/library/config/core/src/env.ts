// Env 型を types から取り込む
import type { Env } from "./types.js";

// 環境ごとの設定マップを表す型
// dev は完全な T を要求し、staging/prod は dev からの差分（Partial）のみで定義可能
export interface EnvConfigMap<T> {
  // 開発環境の完全な設定（ベースとして利用される）
  dev: T;
  // 検証環境の差分設定
  staging: Partial<T>;
  // 本番環境の差分設定
  prod: Partial<T>;
}

// dev をベースに env で指定された環境の差分をマージして返す
// オブジェクト型のみを対象（プリミティブの混在による予期せぬ展開を避ける）
export function mergeEnvConfig<T extends object>(
  // 環境別の設定マップ（dev + staging/prod の差分）
  map: EnvConfigMap<T>,
  // 適用する環境名
  env: Env,
): T {
  // dev は差分マージ不要なのでそのまま返す
  if (env === "dev") {
    // dev はベース定義そのまま返却
    return { ...map.dev };
  }
  // staging または prod の差分を取得
  const overrides = env === "staging" ? map.staging : map.prod;
  // dev をベースに差分を浅くマージして返す
  return { ...map.dev, ...overrides } as T;
}
