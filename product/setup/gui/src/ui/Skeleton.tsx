// データ読み込み中に表示するプレースホルダーアニメーションコンポーネント
// 非同期データ取得中のローディング状態を視覚的に示すために使用する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './Skeleton.module.css';

// Skeleton コンポーネントの Props 型
interface SkeletonProps {
  // スケルトンの形状（テキスト行 / 見出し / 丸型）
  variant?: 'text' | 'heading' | 'circle';
  // 幅（CSS 値文字列 例: '100%', '200px'）
  width?: string | number;
  // 高さ（CSS 値文字列 例: '16px', 32）
  height?: string | number;
  // 追加の CSS クラス
  className?: string;
}

// データ読み込み中のプレースホルダーを表示するコンポーネント
export function Skeleton({
  variant = 'text',
  width,
  height,
  className,
}: SkeletonProps) {
  // 適用するクラスを結合する
  const cls = [
    // ベーススタイル
    styles.skeleton,
    // variant に対応するクラス
    styles[variant],
    // 外部から渡されたクラス
    className,
  ].filter(Boolean).join(' ');

  // 幅と高さをインラインスタイルで設定する（動的な値のため CSS Modules 外で指定）
  const inlineStyle: React.CSSProperties = {
    // 幅が指定されている場合に適用する
    ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    // 高さが指定されている場合に適用する
    ...(height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
  };

  // スケルトン要素を描画する
  return (
    <span
      // 生成した CSS クラスを適用する
      className={cls}
      // 動的サイズをインラインスタイルで適用する
      style={inlineStyle}
      // スクリーンリーダーからは隠す
      aria-hidden="true"
    />
  );
}
