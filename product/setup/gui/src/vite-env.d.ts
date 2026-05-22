/// <reference types="vite/client" />

// CSS Modules ファイル（*.module.css）を TypeScript から import したときの型宣言
// Vite がビルド時に CSS クラス名を文字列としてマッピングするため、この型定義が必要
declare module '*.module.css' {
  // クラス名（文字列キー）に対して CSS Modules が生成するスコープ付きクラス名を返す
  const classes: { readonly [key: string]: string };
  // default export としてクラスマップをエクスポートする
  export default classes;
}
