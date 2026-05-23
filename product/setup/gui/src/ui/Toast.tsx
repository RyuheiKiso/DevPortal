// 画面右下に表示する短時間の通知メッセージコンポーネント
// インストール完了・設定保存成功・エラー通知等に使用する

// CSS Modules のスタイルをインポートする
// react-jsx transform を使用しているため React の明示的インポートは不要
import styles from './Toast.module.css';
// アイコンコンポーネントをインポートする
import { Icon } from './Icon';
// トースト variant に対応する lucide-react アイコンをインポートする
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
// lucide-react の LucideIcon 型をインポートする
import type { LucideIcon } from 'lucide-react';

// トーストのデータ型（ToastProvider で管理する）
export interface ToastData {
  // トーストを一意に識別する ID
  id: string;
  // 表示するメッセージ
  message: string;
  // トーストの外観（省略時は info）
  variant?: 'success' | 'danger' | 'info';
}

// Toast コンポーネントが受け取る Props 型
interface ToastProps extends ToastData {
  // トーストを閉じるコールバック
  onClose: (id: string) => void;
}

// variant に対応するアイコンマップ
const ICON_MAP: Record<string, LucideIcon> = {
  // 成功通知には塗りつぶし円チェックアイコン
  success: CheckCircle2,
  // 危険通知にはバツ印の円アイコン
  danger: XCircle,
  // 情報通知にはインフォメーションアイコン
  info: Info,
};

// variant に対応するアイコン色マップ
const COLOR_MAP: Record<string, string> = {
  // 成功は成功色を使用する
  success: 'var(--success)',
  // 危険は危険色を使用する
  danger: 'var(--danger)',
  // 情報は情報色を使用する
  info: 'var(--info)',
};

// 1 件分のトースト通知コンポーネント
export function Toast({ id, message, variant = 'info', onClose }: ToastProps) {
  // variant に対応するアイコンコンポーネントを取得する
  const IconComponent = ICON_MAP[variant];
  // variant に対応するアイコン色を取得する
  const iconColor = COLOR_MAP[variant];

  // トーストの CSS クラスを生成する
  const cls = [
    // ベーススタイル
    styles.toast,
    // variant に対応するカラークラス（左ボーダー色）
    styles[variant],
  ].filter(Boolean).join(' ');

  // トースト要素を描画する
  return (
    <div className={cls} role="alert" aria-live="polite">
      {/* variant に対応するアイコンを表示する */}
      <span className={styles.toastIcon}>
        <Icon icon={IconComponent} size={16} color={iconColor} />
      </span>
      {/* 通知メッセージを表示する */}
      <span className={styles.toastMessage}>{message}</span>
      {/* 閉じるボタン */}
      <button
        // 閉じるボタンのスタイルを適用する
        className={styles.toastClose}
        // クリックでこのトーストを閉じる
        onClick={() => onClose(id)}
        // アクセシブルラベルを付与する
        aria-label="通知を閉じる"
      >
        <Icon icon={X} size={14} />
      </button>
    </div>
  );
}
