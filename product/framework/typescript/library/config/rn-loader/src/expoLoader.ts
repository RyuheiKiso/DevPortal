// Expo バックエンドのファクトリと関連型を取り込む
import { createExpoBackend } from "./backends/expo.js";
import type { ExpoBackendOptions } from "./backends/expo.js";
// 共通の Loader を組み立てるファクトリを取り込む
import { createLoader } from "./loader.js";
// Loader 型を取り込む
import type { Loader } from "./types.js";

// 公開: ベースディレクトリ識別リテラル
export type { ExpoBaseDir } from "./backends/expo.js";
// 公開: バックエンドファクトリ (より細かい制御をしたいユーザー向け)
export { createExpoBackend } from "./backends/expo.js";

// createExpoLoader のオプション (バックエンドオプションをそのまま再 export)
export type ExpoLoaderOptions = ExpoBackendOptions;

// expo-file-system バックエンドを使った Loader を 1 行で組み立てる便利関数
// 内部的には createExpoBackend → createLoader の合成
export function createExpoLoader(
  // ベースディレクトリ等のオプション
  options: ExpoLoaderOptions = {},
): Loader {
  // バックエンドを組み立てて Loader を返す
  return createLoader(createExpoBackend(options));
}
