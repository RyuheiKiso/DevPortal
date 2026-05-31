// React の状態管理フック useState を取り込む
import { useState } from 'react'
// このコンポーネント用のスタイルシートを取り込む
import './App.css'

// アプリケーションのルートコンポーネント
function App() {
  // ボタンのクリック回数を保持する状態
  const [count, setCount] = useState(0)

  // 画面を描画して返す
  return (
    // アプリ全体のコンテナ要素
    <main className="app">
      {/* アプリの表示名を見出しとして表示する */}
      <h1>${{ values.app_title }}</h1>
      {/* アプリの説明文を表示する */}
      <p className="description">${{ values.description }}</p>
      {/* クリックでカウントを増やすボタン */}
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        {/* 現在のカウント値を表示する */}
        count is {count}
      </button>
      {/* 開発の手引き */}
      <p className="hint">
        {/* 編集すべきファイルを案内する */}
        <code>src/App.tsx</code> を編集して開発を始めてください。
      </p>
    </main>
  )
}

// 他モジュールから利用できるよう既定エクスポートする
export default App
