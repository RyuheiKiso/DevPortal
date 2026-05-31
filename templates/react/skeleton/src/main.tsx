// 開発時の警告を強化する StrictMode を取り込む
import { StrictMode } from 'react'
// クライアント描画用の createRoot を取り込む
import { createRoot } from 'react-dom/client'
// グローバルスタイルを取り込む
import './index.css'
// アプリのルートコンポーネントを取り込む
import App from './App.tsx'

// id="root" の要素を取得してルートを生成し、アプリを描画する
createRoot(document.getElementById('root')!).render(
  // 開発時の警告を強化する StrictMode で包む
  <StrictMode>
    {/* アプリのルートコンポーネント */}
    <App />
  </StrictMode>,
)
