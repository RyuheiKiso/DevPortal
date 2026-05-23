// lucide-react の SVG アイコンを統一サイズ・統一ストロークで描画するラッパーコンポーネント
// アプリ内のアイコン描画はすべてこのコンポーネントを経由させて一貫性を保つ

// lucide-react の LucideIcon 型（アイコンコンポーネントの共通型）をインポートする
// react-jsx transform を使用しているため React の明示的インポートは不要
import type { LucideIcon } from 'lucide-react';

// アプリ内で使用するアイコンサイズの選択肢（14 / 16 / 20 の 3 段階に統一する）
export type IconSize = 14 | 16 | 20;

// Icon コンポーネントが受け取る Props の型定義
interface IconProps {
  // 描画する lucide-react アイコンコンポーネント（例: Settings, RefreshCw 等）
  icon: LucideIcon;
  // アイコンのサイズ（ピクセル単位、省略時は 16px）
  size?: IconSize;
  // アイコンの色（省略時は親要素の color を継承する currentColor）
  color?: string;
  // スクリーンリーダー向けのアクセシブルラベル（省略時は aria-hidden で装飾扱いにする）
  label?: string;
  // 外部から追加する CSS クラス名
  className?: string;
}

// 統一されたサイズ・ストローク幅でアイコンを描画するコンポーネント
export function Icon({
  icon: LucideIconComponent,
  size = 16,
  color = 'currentColor',
  label,
  className,
}: IconProps) {
  // lucide-react のアイコンコンポーネントを設定して描画する
  return (
    <LucideIconComponent
      // 統一サイズで描画する（px 単位）
      size={size}
      // ストローク幅を 1.5px に統一する（アプリ全体で一貫した線の太さ）
      strokeWidth={1.5}
      // 色は currentColor 継承が基本（親の CSS color を自動的に引き継ぐ）
      color={color}
      // label がない場合はスクリーンリーダーから隠して装飾として扱う
      aria-hidden={!label}
      // label がある場合はアクセシブルなラベルを付与する
      aria-label={label}
      // 外部から指定された追加クラスを適用する
      className={className}
    />
  );
}
