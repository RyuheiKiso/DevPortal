// Vitest のテスト設定込みの defineConfig を取り込む
import { defineConfig } from 'vitest/config'
// React 向けの公式プラグインを取り込む
import react from '@vitejs/plugin-react'

// Vitest（Vite ベース）の設定を定義してエクスポートする
export default defineConfig({
  // 使用するプラグイン
  plugins: [
    // React（JSX）を有効化する
    react(),
  ],
  // テストの設定
  test: {
    // describe/it/expect をグローバルに使えるようにする
    globals: true,
    // ブラウザ DOM を模した jsdom 環境で実行する
    environment: 'jsdom',
    // 各テストファイルの前に読み込むセットアップファイル
    setupFiles: ['./src/test/setup.ts'],
  },
})
