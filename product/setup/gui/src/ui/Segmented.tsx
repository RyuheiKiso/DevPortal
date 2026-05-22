// セグメントコントロール（排他的選択肢をボタン群で表現する）UI プリミティブ
// テーマ選択・モード選択など、少数の排他オプションを横並びボタンで切り替える

// CSS Modules のスタイルをインポートする
import styles from './Segmented.module.css';

// セグメントの各選択肢の型定義
export interface SegmentOption {
  // 選択肢の内部値（onChange に渡される）
  value: string;
  // 選択肢のラベルテキスト（ボタンに表示される）
  label: string;
}

// Segmented コンポーネントが受け取る Props 型定義
interface SegmentedProps {
  // 選択肢の配列
  options: SegmentOption[];
  // 現在選択されている選択肢の value
  value: string;
  // 選択肢が変更されたときのコールバック（新しい value を渡す）
  onChange: (value: string) => void;
  // 操作を無効にするフラグ（省略時は有効）
  disabled?: boolean;
}

// セグメントコントロールコンポーネント
export function Segmented({ options, value, onChange, disabled }: SegmentedProps) {
  // セグメントコンテナを描画する
  return (
    <div className={styles.segmented}>
      {/* 各選択肢をボタンとして描画する */}
      {options.map((opt) => (
        <button
          // 選択肢の value をキーに使用する
          key={opt.value}
          // フォーム送信を防ぐために type="button" を明示する
          type="button"
          // ベーススタイルと、現在選択されている場合のアクティブスタイルを結合する
          className={[
            styles.option,
            value === opt.value ? styles.active : '',
          ].filter(Boolean).join(' ')}
          // クリック時に onChange コールバックで新しい value を通知する
          onClick={() => onChange(opt.value)}
          // disabled フラグが true の場合はボタンを無効にする
          disabled={disabled}
        >
          {/* 選択肢のラベルテキスト */}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
