// 読み込み中を示す回転スピナーコンポーネント
// lucide-react の Loader2 アイコンを spin アニメーションで回転させる

// 回転するローダーアイコンをインポートする
// react-jsx transform を使用しているため React の明示的インポートは不要
import { Loader2 } from 'lucide-react';
// アイコンサイズの型をインポートする
import type { IconSize } from './Icon';

// Spinner コンポーネントの Props 型
interface SpinnerProps {
  // スピナーのサイズ（省略時は 16px）
  size?: IconSize;
  // スピナーの色（省略時は現在のテキスト色を継承）
  color?: string;
  // スクリーンリーダー向けのラベル（省略時は「読み込み中」）
  label?: string;
  // 追加の CSS クラス
  className?: string;
}

// global.css の @keyframes spin を使って Loader2 を回転させるスピナーコンポーネント
export function Spinner({
  size = 16,
  color = 'currentColor',
  label = '読み込み中',
  className,
}: SpinnerProps) {
  // スピナー要素を描画する（global.css の @keyframes spin を animation で適用する）
  return (
    <Loader2
      // 統一サイズで描画する
      size={size}
      // ストローク幅を 1.5px に統一する
      strokeWidth={1.5}
      // 色を設定する
      color={color}
      // spin アニメーションを無限ループで適用する（global.css の @keyframes spin を参照）
      style={{ animation: 'spin 1s linear infinite' }}
      // スクリーンリーダー向けのアクセシブルラベルを付与する
      aria-label={label}
      // 追加クラスを適用する
      className={className}
    />
  );
}
