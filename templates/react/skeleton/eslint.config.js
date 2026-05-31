// JavaScript の推奨ルールセットを取り込む
import js from '@eslint/js'
// 各実行環境のグローバル変数定義を取り込む
import globals from 'globals'
// React Hooks 用の ESLint プラグインを取り込む
import reactHooks from 'eslint-plugin-react-hooks'
// React Fast Refresh 用の ESLint プラグインを取り込む
import reactRefresh from 'eslint-plugin-react-refresh'
// TypeScript 向けの ESLint 設定ヘルパーを取り込む
import tseslint from 'typescript-eslint'

// ESLint のフラット設定をエクスポートする
export default tseslint.config(
  // ビルド出力はチェック対象から除外する
  { ignores: ['dist'] },
  {
    // 適用する基本ルール（JS 推奨 + TS 推奨）
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    // 対象とするファイル
    files: ['**/*.{ts,tsx}'],
    // 言語環境の設定
    languageOptions: {
      // 対応する ECMAScript バージョン
      ecmaVersion: 2022,
      // 利用可能なグローバル変数（ブラウザ）
      globals: globals.browser,
    },
    // 使用するプラグイン
    plugins: {
      // React Hooks のルール
      'react-hooks': reactHooks,
      // React Fast Refresh のルール
      'react-refresh': reactRefresh,
    },
    // 適用するルール
    rules: {
      // React Hooks の推奨ルールを適用する
      ...reactHooks.configs.recommended.rules,
      // Fast Refresh のためコンポーネントのみのエクスポートを促す
      'react-refresh/only-export-components': [
        // 警告レベルで通知する
        'warn',
        // 定数のエクスポートは許可する
        { allowConstantExport: true },
      ],
    },
  },
)
