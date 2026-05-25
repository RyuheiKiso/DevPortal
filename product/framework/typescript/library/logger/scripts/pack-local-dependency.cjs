// ファイル操作用の Node.js 標準モジュールを読み込む
const fs = require("node:fs");
// パス解決用の Node.js 標準モジュールを読み込む
const path = require("node:path");

// CLI 引数から動作モードと対象 dependency を取り出す
const [mode, dependencyName, requestedValue] = process.argv.slice(2);
// 現在ディレクトリの package.json を対象にする
const packageJsonPath = path.resolve("package.json");
// publish/pack 中だけ使うバックアップファイル名を決める
const backupPath = path.resolve(".package.json.pack-backup");

// JSON ファイルを読み込む
function readJson(filePath) {
  // UTF-8 で読み込んで JSON として parse する
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// JSON ファイルを書き込む
function writeJson(filePath, value) {
  // 既存の package.json と同じ 2 spaces 形式で書き戻す
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// バックアップがあれば package.json を復元する
function restoreBackup() {
  // バックアップがない場合は何もしない
  if (!fs.existsSync(backupPath)) {
    // 復元しなかったことを返す
    return false;
  }
  // バックアップを package.json に戻す
  fs.copyFileSync(backupPath, packageJsonPath);
  // 使い終わったバックアップを削除する
  fs.rmSync(backupPath, { force: true });
  // 復元したことを返す
  return true;
}

// restore モードならバックアップ復元だけを行う
if (mode === "restore") {
  // package.json を元に戻す
  restoreBackup();
  // 正常終了する
  process.exit(0);
}

// prepare モード以外または引数不足は使い方エラーにする
if (mode !== "prepare" || dependencyName === undefined || requestedValue === undefined) {
  // 呼び出し側に正しい引数形式を伝える
  throw new Error("Usage: pack-local-dependency.cjs prepare <dependency-name> <version|value> | restore");
}

// 前回の異常終了で残ったバックアップを先に復元する
restoreBackup();

// package.json を読み込む
const packageJson = readJson(packageJsonPath);
// version 指定なら自身の version、それ以外なら指定値を使う
const nextValue = requestedValue === "version" ? packageJson.version : requestedValue;

// dependency に設定する値が空でない文字列か確認する
if (typeof nextValue !== "string" || nextValue.length === 0) {
  // 値を導出できない場合は明示的に失敗させる
  throw new Error(`Cannot derive a publish dependency value for ${dependencyName}`);
}

// カンマ区切りで複数 dependency をまとめて差し替える (1 prepack 呼び出しで複数 file: 依存を処理可能にするため)
const dependencyNames = dependencyName
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

// 引数解析後に対象 dependency が空配列だった場合は使い方エラーにする
if (dependencyNames.length === 0) {
  // dependency 名が 1 つも無い場合は明示的に失敗させる
  throw new Error("At least one dependency name must be provided (comma-separated)");
}

// 各 dependency が package.json に存在するか事前に検証する (途中で fail しても backup を取らないため)
for (const name of dependencyNames) {
  // 対象 dependency が package.json に存在するか確認する
  if (packageJson.dependencies === undefined || packageJson.dependencies[name] === undefined) {
    // dependency がない場合は設定ミスとして失敗させる
    throw new Error(`${name} is not listed in dependencies`);
  }
}

// 現在の package.json をバックアップする
fs.copyFileSync(packageJsonPath, backupPath);
// 各 dependency を publish 用の値へ一括で差し替える
for (const name of dependencyNames) {
  // 該当 dependency を書き換える
  packageJson.dependencies[name] = nextValue;
}
// 差し替え後の package.json を書き戻す
writeJson(packageJsonPath, packageJson);
