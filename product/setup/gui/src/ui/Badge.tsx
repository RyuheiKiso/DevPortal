// ステータスや分類を示す小さなラベルコンポーネント
// サービス状態（稼働中/停止/エラー等）やカテゴリの表示に使用する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './Badge.module.css';

// バッジの外観を決める variant 型
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

// Badge コンポーネントの Props 型
interface BadgeProps {
  // バッジのテキストラベル
  children: React.ReactNode;
  // バッジの外観（ステータスに合わせて選択する）
  variant?: BadgeVariant;
  // 先頭にステータスドット（小さい丸）を表示するかどうか
  dot?: boolean;
  // 追加の CSS クラス
  className?: string;
}

// ステータスや分類を示す小さなピル型ラベルコンポーネント
export function Badge({
  children,
  variant = 'neutral',
  dot = false,
  className,
}: BadgeProps) {
  // variant と外部クラスを結合して CSS クラス文字列を生成する
  const cls = [
    // ベーススタイル
    styles.badge,
    // variant に対応するクラス
    styles[variant],
    // 外部から渡されたクラス
    className,
  ].filter(Boolean).join(' ');

  // バッジ要素を描画する（dot が true の場合はドットを先頭に表示する）
  return (
    <span className={cls}>
      {/* dot が true の場合はステータスドットを表示する */}
      {dot && <span className={styles.dot} />}
      {/* バッジのテキストラベル */}
      {children}
    </span>
  );
}
