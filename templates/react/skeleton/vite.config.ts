// Vite の設定を定義するヘルパーを取り込む
import { defineConfig } from 'vite'
// React 向けの公式プラグインを取り込む
import react from '@vitejs/plugin-react'

// Vite の設定を定義してエクスポートする
export default defineConfig({
  // 使用するプラグイン
  plugins: [
    // React（JSX / Fast Refresh）を有効化する
    react(),
  ],
  // 開発サーバーの設定
  server: {
    // 待ち受けるポート
    port: ${{ values.dev_port }},
  },
})
