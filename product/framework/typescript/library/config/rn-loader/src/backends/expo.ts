// 共通エラークラスを取り込む
import { ConfigLoaderError } from "../errors.js";
// FileSystemBackend 型を取り込む
import type { FileSystemBackend } from "../types.js";

// expo-file-system の特殊ディレクトリを抽象化するリテラル
// document: アプリ専用永続データ
// cache: キャッシュ
// undefined: filePath を絶対 URI として扱う
export type ExpoBaseDir = "document" | "cache";

// createExpoBackend のオプション
export interface ExpoBackendOptions {
  // ベースディレクトリ (省略時は絶対 URI 扱い)
  baseDir?: ExpoBaseDir;
}

// loadExpoFSAdapter が返すアダプタ
// 新 File API と legacy API の差分をここで吸収し、本体には統一した形で渡す
interface ExpoFSAdapter {
  // 指定 URI を UTF-8 文字列として読む
  readFile(uri: string): Promise<string>;
  // 指定 URI が存在するかを返す
  exists(uri: string): Promise<boolean>;
  // 永続データディレクトリ URI (取得不能なら null)
  documentDirectory: string | null;
  // キャッシュディレクトリ URI (取得不能なら null)
  cacheDirectory: string | null;
}

// 新 File API: File クラスのコンストラクタ型
type FileCtor = new (uri: string) => {
  // 新 API は File クラスの text() メソッドで文字列読込
  text(): Promise<string>;
  // exists はインスタンスプロパティ
  exists: boolean;
};

// 新 File API: Paths オブジェクトの型
interface PathsObject {
  // ドキュメントディレクトリは uri を持つオブジェクト
  document?: { uri: string };
  // キャッシュディレクトリも同様
  cache?: { uri: string };
}

// expo-file-system モジュールを動的に取り込み、新 API or legacy API のアダプタを返す
// 未インストール時は BACKEND_UNAVAILABLE を投げる
async function loadExpoFSAdapter(): Promise<ExpoFSAdapter> {
  // 文字列変数経由で動的 import (peerDep optional のため型解決をスキップしたい)
  const moduleId = "expo-file-system";
  // 動的 import で peerDep を遅延ロード
  let mod: unknown;
  try {
    // vitest の vi.doMock が効くように dynamic import を使う
    mod = await import(moduleId);
  } catch (cause) {
    // インストール案内付きで BACKEND_UNAVAILABLE を投げる
    throw new ConfigLoaderError(
      "expo-file-system is not installed. Run: npm install expo-file-system",
      "BACKEND_UNAVAILABLE",
      cause,
    );
  }
  // CJS 互換のため default プロパティ優先、無ければ namespace 全体を採用
  // ("default" の存在は in で先に確認する。vitest の厳格チェック回避のため)
  const namespace = mod as Record<string, unknown>;
  const candidate = "default" in namespace ? namespace.default : namespace;
  const fs = candidate as Record<string, unknown>;

  // 新 API (Expo SDK 52+): File クラスが存在するならそちらを優先する
  // legacy API は SDK 52 で deprecated、SDK 54 で expo-file-system/legacy へ分離されたため
  // ("File" の存在は in で先に確認する。vitest の動的 import 結果に対する厳格チェック回避のため)
  if ("File" in fs && typeof fs.File === "function") {
    // File コンストラクタを取り出す
    const FileCtor = fs.File as FileCtor;
    // Paths は SDK バージョンによっては undefined の可能性もあるためオプショナル扱い
    const Paths = fs.Paths as PathsObject | undefined;
    // 新 API でアダプタを返す
    return {
      // text() メソッドで UTF-8 として読込
      async readFile(uri: string): Promise<string> {
        // ファイルインスタンスを作って text() を呼ぶ
        return new FileCtor(uri).text();
      },
      // exists はインスタンスプロパティとして同期取得可能だが、I/F の都合で Promise 化
      async exists(uri: string): Promise<boolean> {
        // インスタンスの exists プロパティを返す
        return new FileCtor(uri).exists;
      },
      // Paths.document.uri を documentDirectory として返す (なければ null)
      documentDirectory: Paths?.document?.uri ?? null,
      // Paths.cache.uri を cacheDirectory として返す (なければ null)
      cacheDirectory: Paths?.cache?.uri ?? null,
    };
  }

  // legacy API (SDK <52): readAsStringAsync + getInfoAsync を使う
  // 型解決をスキップするため Function 型でキャストして呼び出す
  const readAsStringAsync = fs.readAsStringAsync as (uri: string) => Promise<string>;
  const getInfoAsync = fs.getInfoAsync as (uri: string) => Promise<{ exists: boolean }>;
  // legacy API でアダプタを返す
  return {
    // readAsStringAsync を委譲 (デフォルトで UTF-8)
    async readFile(uri: string): Promise<string> {
      // 結果文字列をそのまま返す
      return readAsStringAsync(uri);
    },
    // getInfoAsync の exists プロパティを返す
    async exists(uri: string): Promise<boolean> {
      // 情報取得後 exists を返す
      const info = await getInfoAsync(uri);
      return info.exists;
    },
    // legacy API の documentDirectory (環境によっては null)
    documentDirectory: (fs.documentDirectory as string | null | undefined) ?? null,
    // legacy API の cacheDirectory
    cacheDirectory: (fs.cacheDirectory as string | null | undefined) ?? null,
  };
}

// Expo の documentDirectory/cacheDirectory は末尾スラッシュ付き URI のため
// 単純に連結して URI を生成する
function joinUri(base: string, relative: string): string {
  // base 末尾がスラッシュなら relative の先頭スラッシュを除去
  const trimmedBase = base.endsWith("/") ? base : `${base}/`;
  // relative 先頭スラッシュは取り除く
  const trimmedRel = relative.replace(/^\/+/, "");
  // 結合
  return `${trimmedBase}${trimmedRel}`;
}

// 絶対 URI 判定 (RN/Expo で使われる代表的なスキームを網羅)
// file:// / http:// / https:// / content:// / asset:// 始まりは絶対と扱う
function isAbsoluteUri(filePath: string): boolean {
  // 一般的なスキームを正規表現で検出
  return /^(file|https?|content|asset|ph):\/\//i.test(filePath);
}

// baseDir リテラルから実体 URI を解決する
// baseDir が undefined、または filePath が絶対 URI 指定なら filePath をそのまま返す
function resolveUri(
  // 呼び出し側が指定したパス
  filePath: string,
  // ベースディレクトリ種別
  baseDir: ExpoBaseDir | undefined,
  // expo-file-system 本体 (定数アクセス用)
  FS: ExpoFSAdapter,
): string {
  // baseDir 未指定、または絶対 URI なら filePath をそのまま返す
  if (baseDir === undefined || isAbsoluteUri(filePath)) {
    return filePath;
  }
  // baseDir に応じてディレクトリ URI を選ぶ
  const base = baseDir === "document" ? FS.documentDirectory : FS.cacheDirectory;
  // Expo のディレクトリは Web 等では null になりうる
  if (base === null) {
    // ベースディレクトリが取れない環境では BACKEND_UNAVAILABLE 扱い
    throw new ConfigLoaderError(
      `expo-file-system ${baseDir}Directory is not available on this platform`,
      "BACKEND_UNAVAILABLE",
    );
  }
  // 解決後の URI を返す
  return joinUri(base, filePath);
}

// expo-file-system を使う FileSystemBackend を生成する
// 各 readFile/exists 呼び出しで FS を遅延ロードする (peerDep optional のため)
export function createExpoBackend(
  // ベースディレクトリ等のオプション
  options: ExpoBackendOptions = {},
): FileSystemBackend {
  // オプションを内部変数に展開
  const { baseDir } = options;
  // FileSystemBackend インターフェイスを満たすオブジェクトを返す
  return {
    // 指定 URI を UTF-8 で読み出して文字列で返す
    async readFile(filePath: string): Promise<string> {
      // アダプタを取得 (BACKEND_UNAVAILABLE 経路はここから飛ぶ可能性あり)
      const FS = await loadExpoFSAdapter();
      // ベースディレクトリと結合して実 URI を得る
      const resolved = resolveUri(filePath, baseDir, FS);
      // 先に存在確認し、無ければ FILE_NOT_FOUND として明示的に区別する
      if (!(await FS.exists(resolved))) {
        // ファイル未存在を明示
        throw new ConfigLoaderError(
          `Config file not found: ${resolved}`,
          "FILE_NOT_FOUND",
        );
      }
      // 読込本体は try-catch で I/O 例外を包む
      try {
        // 新/legacy 双方のアダプタで UTF-8 文字列を返す
        return await FS.readFile(resolved);
      } catch (cause) {
        // 失敗は IO_ERROR にまとめる (cause で元エラーを保持)
        throw new ConfigLoaderError(
          `I/O error while reading config file: ${resolved}`,
          "IO_ERROR",
          cause,
        );
      }
    },
    // 指定 URI にファイルが存在するかを返す
    async exists(filePath: string): Promise<boolean> {
      // アダプタを取得
      const FS = await loadExpoFSAdapter();
      // ベースディレクトリと結合して実 URI を得る
      const resolved = resolveUri(filePath, baseDir, FS);
      // アダプタの exists を委譲
      return FS.exists(resolved);
    },
  };
}
