// 汎用ボタンコンポーネント: variant（外観）と size（大きさ）をサポートする
// アプリ内のすべてのボタンはこのコンポーネントを使用してスタイルを統一する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './Button.module.css';

// ボタンの外観を決める variant 型（4 種類）
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

// ボタンのサイズを決める型（2 種類）
export type ButtonSize = 'sm' | 'md';

// Button コンポーネントの Props 型（HTML ボタンの標準属性も引き継ぐ）
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // ボタンの外観を選択する（省略時は secondary）
  variant?: ButtonVariant;
  // ボタンの大きさを選択する（省略時は md）
  size?: ButtonSize;
}

// variant と size に応じた CSS クラスを付与する汎用ボタンコンポーネント
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  // variant・size・外部クラスを結合して CSS クラス文字列を生成する
  const cls = [
    // ベーススタイルのクラス
    styles.button,
    // variant に対応するクラス（primary / secondary / ghost / danger）
    styles[variant],
    // size に対応するクラス（sm / md）
    styles[size],
    // 外部から渡されたクラス
    className,
  // undefined や空文字を除去して結合する
  ].filter(Boolean).join(' ');

  // HTML button 要素として描画する（残りの属性はスプレッドで渡す）
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
