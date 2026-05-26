// ConfigLoaderError.code に入りうる識別子のユニオン
// 呼び出し側はこの値で catch 後の分岐を書く
export type LoaderErrorCode =
  // 対象ファイルが見つからない (ENOENT)
  | "FILE_NOT_FOUND"
  // 上記以外の I/O 系失敗 (EISDIR / EACCES 等)
  | "IO_ERROR"
  // 拡張子が JSON/YAML 以外で、どのパーサも選択できない
  | "UNSUPPORTED_EXT"
  // JSON.parse もしくは YAML パーサが失敗
  | "PARSE_ERROR";
