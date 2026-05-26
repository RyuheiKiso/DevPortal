// zod の ZodType 型を取り込む (Loader 型定義に必要)
import type { z } from "zod";
// core から EnvConfigMap 型を取り込む (loadEnvConfigMap の戻り値型として使う)
import type { EnvConfigMap } from "@k1s0-ts-config/core";

// ConfigLoaderError.code に入りうる識別子のユニオン
// 呼び出し側はこの値で catch 後の分岐を書く
export type LoaderErrorCode =
  // 対象ファイルが見つからない
  | "FILE_NOT_FOUND"
  // その他 I/O 系失敗
  | "IO_ERROR"
  // 拡張子が JSON/YAML 以外で、どのパーサも選択できない
  | "UNSUPPORTED_EXT"
  // JSON.parse もしくは YAML パーサが失敗
  | "PARSE_ERROR"
  // peerDep (react-native-fs / expo-file-system) が未インストール
  | "BACKEND_UNAVAILABLE";

// 上位ローダがファイルシステムへ問い合わせる抽象
// 各バックエンド (rnfs / expo / 将来の OTA 等) がこのインターフェイスを満たす
export interface FileSystemBackend {
  // 指定パスを UTF-8 で読んで文字列を返す
  readFile(filePath: string): Promise<string>;
  // 指定パスの存在確認 (loadEnvConfigMap の staging/prod 任意判定で使用)
  exists(filePath: string): Promise<boolean>;
}

// createLoader が返す統一インターフェイス
// 呼び出し側はバックエンド種別を気にせず同じ API で利用できる
export interface Loader {
  // ファイル 1 枚を読んで unknown を返す
  loadConfig(filePath: string): Promise<unknown>;
  // zod スキーマで検証して T 型を返す
  loadAndValidate<T>(filePath: string, schema: z.ZodType<T>): Promise<T>;
  // dir 配下の dev/staging/prod を EnvConfigMap 形式にまとめる
  loadEnvConfigMap(dir: string): Promise<EnvConfigMap<Record<string, unknown>>>;
  // 指定パスにファイルが存在するかを返す (バックエンド経由のパス解決を含む)
  exists(filePath: string): Promise<boolean>;
}
