// 成功・警告・エラー・情報を伝えるインラインバナーコンポーネント
// インストール完了・失敗・前提条件エラー等の結果表示に使用する

// React をインポートする
import React from 'react';
// CSS Modules のスタイルをインポートする
import styles from './Banner.module.css';
// アイコンコンポーネントをインポートする
import { Icon } from './Icon';
// バナー variant に対応する lucide-react アイコンをインポートする
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
// lucide-react の LucideIcon 型をインポートする
import type { LucideIcon } from 'lucide-react';

// バナーの外観を決める variant 型
export type BannerVariant = 'success' | 'warning' | 'danger' | 'info';

// Banner コンポーネントの Props 型
interface BannerProps {
  // バナーの外観（成功/警告/危険/情報から選択）
  variant: BannerVariant;
  // バナーの見出し（タイトル）テキスト
  title?: string;
  // バナーのメッセージ本文
  children: React.ReactNode;
  // アイコンを非表示にするかどうか（省略時は表示する）
  hideIcon?: boolean;
  // 追加の CSS クラス
  className?: string;
}

// variant に対応するアイコンマップ（lucide-react のアイコンコンポーネント）
const ICON_MAP: Record<BannerVariant, LucideIcon> = {
  // 成功には塗りつぶし円のチェックアイコン
  success: CheckCircle2,
  // 警告には三角形の警告アイコン
  warning: AlertTriangle,
  // 危険にはバツ印の円アイコン
  danger: XCircle,
  // 情報にはインフォメーションアイコン
  info: Info,
};

// variant に応じた見た目とアイコンを持つインラインバナーコンポーネント
export function Banner({
  variant,
  title,
  children,
  hideIcon = false,
  className,
}: BannerProps) {
  // variant に対応するアイコンコンポーネントを取得する
  const IconComponent = ICON_MAP[variant];

  // バナーの CSS クラスを生成する
  const cls = [
    // ベーススタイル
    styles.banner,
    // variant に対応するカラークラス
    styles[variant],
    // 外部から渡されたクラス
    className,
  ].filter(Boolean).join(' ');

  // バナー要素を描画する
  return (
    <div className={cls} role="alert">
      {/* hideIcon が false の場合はアイコンを表示する */}
      {!hideIcon && (
        <span className={styles.icon}>
          <Icon icon={IconComponent} size={16} />
        </span>
      )}
      {/* テキストコンテンツ領域 */}
      <div className={styles.content}>
        {/* title がある場合は見出しとして表示する */}
        {title && <div className={styles.title}>{title}</div>}
        {/* バナーの本文メッセージ */}
        {children}
      </div>
    </div>
  );
}
