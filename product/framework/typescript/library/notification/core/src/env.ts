// 環境判定ヘルパ
// repo 共通方針として `process.env.NODE_ENV` を `globalThis` 経由で読む
// （`@types/node` 非依存 / バンドラ DCE には乗らないが runtime 判定として一貫させる）

// `globalThis.process.env.NODE_ENV` 文字列を取得する（解決不能な環境では undefined を返す）
// `process.env` の getter が throw する稀なケースも内部で握りつぶす
export function getNodeEnv(): string | undefined {
  // try で全アクセスをくるんで getter の throw を握る
  try {
    // globalThis 経由で process オブジェクトを取得（ブラウザ等では undefined のことがある）
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    // optional chaining で env / NODE_ENV を辿る
    return proc?.env?.NODE_ENV;
  } catch {
    // getter / Proxy などが throw した場合は判定不能として undefined を返す
    return undefined;
  }
}

// `NODE_ENV === "production"` の厳格判定
// `"prod"` や `"PRODUCTION"` 等の略記は production と見做さない（保守的判定）
export function isProduction(): boolean {
  // 単純な strict 比較で確定したケースのみ true
  return getNodeEnv() === "production";
}

// 開発モード判定
// `NODE_ENV === "development"` の strict 一致、または React Native の `__DEV__` グローバルが true の場合
// production 既知のときは早期 false（`__DEV__` が undefined でも production を覆さない）
export function isDevelopment(): boolean {
  // NODE_ENV の値を取得
  const env = getNodeEnv();
  // production が明示されているなら dev ではない
  if (env === "production") {
    return false;
  }
  // NODE_ENV が development なら確定 dev
  if (env === "development") {
    return true;
  }
  // React Native の `__DEV__` グローバルを duck typing 経由で読む
  const dev = (globalThis as { __DEV__?: unknown }).__DEV__;
  // 真偽値で明示的に true の場合のみ dev とみなす
  if (dev === true) {
    return true;
  }
  // それ以外（NODE_ENV が test / staging / 未定義など）は dev とは判定しない
  return false;
}
