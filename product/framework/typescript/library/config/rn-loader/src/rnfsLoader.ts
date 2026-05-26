// RNFS バックエンドのファクトリと関連型を取り込む
import { createRNFSBackend } from "./backends/rnfs.js";
import type { RNFSBackendOptions } from "./backends/rnfs.js";
// 共通の Loader を組み立てるファクトリを取り込む
import { createLoader } from "./loader.js";
// Loader 型を取り込む
import type { Loader } from "./types.js";

// 公開: ベースディレクトリ識別リテラル
export type { RNFSBaseDir } from "./backends/rnfs.js";
// 公開: バックエンドファクトリ (より細かい制御をしたいユーザー向け)
export { createRNFSBackend } from "./backends/rnfs.js";

// createRNFSLoader のオプション (バックエンドオプションをそのまま再 export)
export type RNFSLoaderOptions = RNFSBackendOptions;

// react-native-fs バックエンドを使った Loader を 1 行で組み立てる便利関数
// 内部的には createRNFSBackend → createLoader の合成
export function createRNFSLoader(
  // ベースディレクトリ等のオプション
  options: RNFSLoaderOptions = {},
): Loader {
  // バックエンドを組み立てて Loader を返す
  return createLoader(createRNFSBackend(options));
}
