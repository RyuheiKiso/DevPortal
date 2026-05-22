// アイコンのみを内包する正方形ボタンコンポーネント
// テーマトグル・ツールバーアクション・テーブル行操作等に使用する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './IconButton.module.css';

// IconButton コンポーネントの Props 型（HTML ボタンの標準属性も引き継ぐ）
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // ボタンのサイズ（省略時は標準 = 32px）
  size?: 'sm' | 'md' | 'lg';
  // アクティブ（選択中）状態かどうか
  active?: boolean;
  // スクリーンリーダー向けのアクセシブルラベル（aria-label）—必須
  'aria-label': string;
}

// アイコンを中央に配置する正方形ボタンコンポーネント
export function IconButton({
  size = 'md',
  active = false,
  className,
  children,
  ...rest
}: IconButtonProps) {
  // size・active 状態・外部クラスを結合して CSS クラス文字列を生成する
  const cls = [
    // ベーススタイル
    styles.iconButton,
    // sm・lg の場合のみサイズクラスを適用する（md はデフォルト）
    size !== 'md' ? styles[size] : undefined,
    // アクティブな場合はハイライトクラスを適用する
    active ? styles.active : undefined,
    // 外部から渡されたクラス
    className,
  // undefined や空文字を除去して結合する
  ].filter(Boolean).join(' ');

  // HTML button 要素として描画する
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
