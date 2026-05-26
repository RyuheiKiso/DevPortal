// 共通エラークラスを公開 (呼び出し側で instanceof / code 判定するため)
export { ConfigLoaderError } from "./errors.js";
// エラーコード型エイリアスを公開
export type { LoaderErrorCode } from "./types.js";

// 低レベル: ファイル読込 + パースのみ
export { loadConfig, loadConfigSync } from "./load.js";

// 高レベル: zod スキーマでの検証まで一気通貫
export { loadAndValidate, loadAndValidateSync } from "./validate.js";

// 環境別マージ用: dev/staging/prod を EnvConfigMap 形にまとめる
export { loadEnvConfigMap, loadEnvConfigMapSync } from "./loadEnv.js";
