// 共通エラークラスを公開 (instanceof / code 判定用)
export { ConfigLoaderError } from "./errors.js";
// 公開型 (FileSystemBackend / Loader / LoaderErrorCode)
export type { FileSystemBackend, Loader, LoaderErrorCode } from "./types.js";

// 低レベル: 任意のバックエンドから Loader を組み立てる
export { createLoader } from "./loader.js";

// react-native-fs バックエンドを使う Loader ファクトリ
export { createRNFSBackend, createRNFSLoader } from "./rnfsLoader.js";
export type { RNFSBaseDir, RNFSLoaderOptions } from "./rnfsLoader.js";

// expo-file-system バックエンドを使う Loader ファクトリ
export { createExpoBackend, createExpoLoader } from "./expoLoader.js";
export type { ExpoBaseDir, ExpoLoaderOptions } from "./expoLoader.js";
