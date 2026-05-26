// 共通エラークラスを取り込む
import { ConfigLoaderError } from "../errors.js";
// FileSystemBackend 型を取り込む
import type { FileSystemBackend } from "../types.js";
// パス結合ユーティリティ (loader.ts と同じロジックを共有する)
import { joinPath, isAbsolutePath } from "../pathUtils.js";

// react-native-fs の特殊ディレクトリを抽象化するリテラル
// documents: 永続データ (RNFS.DocumentDirectoryPath)
// cache: 一時データ (RNFS.CachesDirectoryPath)
// undefined: filePath を絶対パスとして扱う
export type RNFSBaseDir = "documents" | "cache";

// createRNFSBackend のオプション
export interface RNFSBackendOptions {
  // ベースディレクトリ (省略時は絶対パス扱い)
  baseDir?: RNFSBaseDir;
}

// 動的 import の解決結果に期待する API 形 (RNFS の上位互換を許容)
interface RNFSModule {
  // ファイル読込
  readFile(path: string, encoding: string): Promise<string>;
  // 存在確認
  exists(path: string): Promise<boolean>;
  // 永続データディレクトリのパス定数
  DocumentDirectoryPath: string;
  // キャッシュディレクトリのパス定数
  CachesDirectoryPath: string;
}

// react-native-fs モジュールを動的に取り込んで本体の API オブジェクトを返す
// 未インストール時は BACKEND_UNAVAILABLE を投げる
async function loadRNFS(): Promise<RNFSModule> {
  // 文字列変数経由で動的 import (peerDep optional のため型解決をスキップしたい)
  const moduleId = "react-native-fs";
  // 動的 import で peerDep を遅延ロード (未インストール時は例外)
  let mod: unknown;
  try {
    // dynamic import を経由 (vitest の vi.doMock が効くようにするため)
    mod = await import(moduleId);
  } catch (cause) {
    // インストール案内付きで BACKEND_UNAVAILABLE を投げる
    throw new ConfigLoaderError(
      "react-native-fs is not installed. Run: npm install react-native-fs",
      "BACKEND_UNAVAILABLE",
      cause,
    );
  }
  // CJS 互換のため default プロパティ優先、無ければ namespace 全体を採用
  // ("default" の存在は in で先に確認する。動的 import 結果に直接 .default アクセスすると
  //  vitest が厳格チェックで落ちるため)
  const namespace = mod as Record<string, unknown>;
  const candidate = "default" in namespace ? namespace.default : namespace;
  // 必要なフィールドが揃っているとみなしてキャスト
  return candidate as RNFSModule;
}

// baseDir リテラルから実体ディレクトリパスへ解決する
// baseDir が undefined の場合、または filePath が絶対パス指定の場合は filePath をそのまま返す
function resolvePath(
  // 呼び出し側が指定したパス
  filePath: string,
  // ベースディレクトリ種別
  baseDir: RNFSBaseDir | undefined,
  // RNFS 本体 (定数アクセス用)
  RNFS: RNFSModule,
): string {
  // baseDir 未指定、または filePath が絶対パスなら filePath をそのまま返す
  // (絶対パスに baseDir を結合すると不正なパスになるのを防ぐ)
  if (baseDir === undefined || isAbsolutePath(filePath)) {
    return filePath;
  }
  // documents なら DocumentDirectoryPath、cache なら CachesDirectoryPath を採用
  const base = baseDir === "documents" ? RNFS.DocumentDirectoryPath : RNFS.CachesDirectoryPath;
  // 解決後のパスを返す
  return joinPath(base, filePath);
}

// react-native-fs を使う FileSystemBackend を生成する
// 各 readFile/exists 呼び出しで RNFS を遅延ロードする (peerDep optional のため)
export function createRNFSBackend(
  // ベースディレクトリ等のオプション
  options: RNFSBackendOptions = {},
): FileSystemBackend {
  // オプションを内部変数に展開
  const { baseDir } = options;
  // FileSystemBackend インターフェイスを満たすオブジェクトを返す
  return {
    // 指定パスを UTF-8 で読み出して文字列で返す
    async readFile(filePath: string): Promise<string> {
      // RNFS 本体を取得 (BACKEND_UNAVAILABLE 経路はここから飛ぶ可能性あり)
      const RNFS = await loadRNFS();
      // ベースディレクトリと結合して実パスを得る
      const resolved = resolvePath(filePath, baseDir, RNFS);
      // 先に存在確認し、無ければ FILE_NOT_FOUND として明示的に区別する
      // (RNFS の readFile はプラットフォーム依存のエラー文言になるため信頼できない)
      if (!(await RNFS.exists(resolved))) {
        // ファイル未存在を明示
        throw new ConfigLoaderError(
          `Config file not found: ${resolved}`,
          "FILE_NOT_FOUND",
        );
      }
      // 読込本体は try-catch で I/O 例外を包む
      try {
        // UTF-8 で文字列として読み込む
        return await RNFS.readFile(resolved, "utf8");
      } catch (cause) {
        // 失敗は IO_ERROR にまとめる (cause で元エラーを保持)
        throw new ConfigLoaderError(
          `I/O error while reading config file: ${resolved}`,
          "IO_ERROR",
          cause,
        );
      }
    },
    // 指定パスがファイルとして存在するかを返す
    async exists(filePath: string): Promise<boolean> {
      // RNFS 本体を取得
      const RNFS = await loadRNFS();
      // ベースディレクトリと結合して実パスを得る
      const resolved = resolvePath(filePath, baseDir, RNFS);
      // RNFS の exists をそのまま委譲
      return RNFS.exists(resolved);
    },
  };
}
