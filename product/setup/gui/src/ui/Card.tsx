// 罫線・角丸・白背景のコンテナコンポーネント
// コンポーネントカード・情報パネル・フォームグループ等のコンテナとして使用する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './Card.module.css';

// Card コンポーネントの Props 型
interface CardProps {
  // カード内に表示するコンテンツ
  children: React.ReactNode;
  // パディングをゼロにする（カード内で独自レイアウトを持つ場合）
  noPadding?: boolean;
  // サイズを小さくする（sm）
  size?: 'sm' | 'md';
  // クリック可能なカードにする（ホバー効果が付く）
  interactive?: boolean;
  // クリックハンドラ（interactive 時に使用）
  onClick?: () => void;
  // 追加の CSS クラス
  className?: string;
  // HTML の role 属性
  role?: string;
}

// 罫線と角丸を持つ標準カードコンテナコンポーネント
export function Card({
  children,
  noPadding = false,
  size = 'md',
  interactive = false,
  onClick,
  className,
  role,
}: CardProps) {
  // 適用するクラスを結合して CSS クラス文字列を生成する
  const cls = [
    // ベーススタイル
    styles.card,
    // sm の場合のみサイズクラスを適用する
    size === 'sm' ? styles.sm : undefined,
    // noPadding の場合はパディングを除去するクラスを適用する
    noPadding ? styles.noPadding : undefined,
    // インタラクティブの場合はホバー効果クラスを適用する
    interactive ? styles.interactive : undefined,
    // 外部から渡されたクラス
    className,
  ].filter(Boolean).join(' ');

  // カード要素を描画する
  return (
    <div
      // 生成した CSS クラスを適用する
      className={cls}
      // クリックハンドラを付与する
      onClick={onClick}
      // role 属性を付与する
      role={role}
      // インタラクティブの場合はキーボードでフォーカス可能にする
      tabIndex={interactive ? 0 : undefined}
      // インタラクティブの場合は Enter/Space でクリックを発火させる
      onKeyDown={interactive && onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      } : undefined}
    >
      {children}
    </div>
  );
}
