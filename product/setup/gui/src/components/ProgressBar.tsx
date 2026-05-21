// このファイルはシンプルなプログレスバーを表示する React コンポーネントを定義する
// percent プロパティに応じて幅が変化するバーを表示する

// React をインポートする（JSX 変換に必要）
import React from 'react';

// ProgressBar のプロパティ型定義
interface ProgressBarProps {
  // 進捗率（0〜100）
  percent: number;
  // バーの上に表示するラベルテキスト（省略可能）
  label?: string;
}

// ProgressBar: シンプルなプログレスバーを表示する関数コンポーネント
export const ProgressBar: React.FC<ProgressBarProps> = ({ percent, label }) => {
  // percent を 0〜100 の範囲にクランプする
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    // プログレスバー全体のコンテナ
    <div style={{ marginBottom: '8px' }}>
      {/* ラベルが指定されている場合は上に表示する */}
      {label && (
        <div style={{ fontSize: '13px', marginBottom: '4px', color: '#374151' }}>
          {label}
        </div>
      )}

      {/* プログレスバーの背景（トラック部分） */}
      <div
        style={{
          width: '100%',
          height: '12px',
          background: '#e5e7eb',
          borderRadius: '6px',
          overflow: 'hidden',
        }}
      >
        {/* プログレスバーの進捗部分（percent に応じて幅が変化する） */}
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background: '#3b82f6',
            borderRadius: '6px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* 進捗率を数値で表示する */}
      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', textAlign: 'right' }}>
        {clamped}%
      </div>
    </div>
  );
};
