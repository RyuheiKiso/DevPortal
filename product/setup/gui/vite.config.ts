// Vite の defineConfig ヘルパーをインポート（型補完のため）
import { defineConfig } from "vite";
// React 用の Vite プラグインをインポート（JSX/TSX を変換するため）
import react from "@vitejs/plugin-react";

// Vite 設定をデフォルトエクスポート
export default defineConfig({
  // 使用するプラグイン一覧（React プラグインのみ）
  plugins: [react()],
  // Tauri がコンソールを共有するため Vite による画面クリアを無効化
  clearScreen: false,
  // 開発サーバの設定セクション
  server: {
    // Tauri 側の devUrl と一致させる固定ポート
    port: 5173,
    // ポートが空いていない場合に別ポートへフォールバックさせない
    strictPort: true,
  },
});
