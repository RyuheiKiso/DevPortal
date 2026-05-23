// Stepper 内のステップ進捗を示す 2px 細線バーコンポーネント
// percent に応じて幅が変化するアクセントカラーの横バーを描画する

// CSS Modules のスタイルをインポートする
import styles from './LinearProgress.module.css';

// LinearProgress コンポーネントが受け取る Props の型定義
interface LinearProgressProps {
  // 進捗率（0〜100）
  percent: number;
}

// 細線プログレスバーコンポーネント
export function LinearProgress({ percent }: LinearProgressProps) {
  // percent を 0〜100 の範囲にクランプする
  const clamped = Math.max(0, Math.min(100, percent));

  // トラックとバーを描画する
  return (
    <div
      // トラック（背景）の役割を明示するアクセシビリティ属性を付与する
      role="progressbar"
      // 現在の進捗値をスクリーンリーダーに伝える
      aria-valuenow={clamped}
      // 最小値をスクリーンリーダーに伝える
      aria-valuemin={0}
      // 最大値をスクリーンリーダーに伝える
      aria-valuemax={100}
      // トラック（背景バー）のスタイルを適用する
      className={styles.track}
    >
      {/* 進捗部分（percent に応じて幅が変化する）*/}
      <div className={styles.bar} style={{ width: `${clamped}%` }} />
    </div>
  );
}
