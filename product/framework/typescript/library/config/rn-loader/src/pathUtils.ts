// rn-loader 内部で共有するパス操作ユーティリティ
//
// RN/Expo/RNW の各環境では node:path が必ずしも利用できないため、
// 必要最小限のロジックをこのファイルで自前実装する。
// loader.ts と backends/rnfs.ts の両方から参照されることで、
// 区切り文字の扱いを 1 箇所に集約する。

// dir の区切り文字を尊重して baseName と結合する
// Windows (RNW) の DocumentDirectoryPath は "C:\\Users\\..." 形式のため、
// "/" で結合すると "C:\\Users\\...\\LocalState/app.json" のような混在パスになり、
// RNFS の Windows 実装が解決に失敗する可能性があるため統一する。
//
// 規則:
//   ・dir に "\\" を含み "/" を含まない → "\\" を採用 (純 Windows パス)
//   ・それ以外 → "/" を採用 (POSIX パス、または区切り無し、または混在)
// 混在パス ("C:\\Users/app") は実用上稀なため POSIX を優先する。
export function joinPath(dir: string, baseName: string): string {
  // 末尾のスラッシュ/バックスラッシュを正規化（後段の区切り重複を避ける）
  const trimmed = dir.replace(/[\\/]+$/, "");
  // dir に含まれる区切り文字を検出して採用する
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  // 検出した区切り文字で結合
  return `${trimmed}${separator}${baseName}`;
}

// 絶対パスかどうかを判定する
// POSIX 絶対パス (/...)、Windows ドライブレター (C:\... / C:/...)、UNC (\\\\server\\...) をカバー
export function isAbsolutePath(filePath: string): boolean {
  // 正規表現で 3 形式を網羅
  return /^([\\/]|[A-Za-z]:[\\/])/.test(filePath);
}
