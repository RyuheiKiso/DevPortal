// コンポーネントの描画と要素取得のためのユーティリティを取り込む
import { render, screen } from '@testing-library/react'
// jest-dom のカスタムマッチャを取り込む
import '@testing-library/jest-dom'
// Vitest のテスト関数を取り込む
import { describe, it, expect } from 'vitest'
// テスト対象のルートコンポーネントを取り込む
import App from './App'

// App コンポーネントのテストをまとめる
describe('App', () => {
  // 見出し（レベル1）が表示されることを検証する
  it('アプリの見出しを表示する', () => {
    // App を仮想 DOM に描画する
    render(<App />)
    // h1 見出しが存在することを確認する
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  // カウントボタンが表示されることを検証する
  it('カウントボタンを表示する', () => {
    // App を仮想 DOM に描画する
    render(<App />)
    // "count is" を含むボタンが存在することを確認する
    expect(screen.getByRole('button', { name: /count is/i })).toBeInTheDocument()
  })
})
