// このファイルは GUI 起動時に表示するスプラッシュ画面コンポーネントを定義する
// ダッシュボードがロード中の間、アプリ名とスピナーを全画面で表示する

// React をインポートする
import React from 'react';

// Splash コンポーネントのプロパティ型定義
interface SplashProps {
  // true のとき不透明度 0 へのフェードアウトを開始する
  fadingOut: boolean;
}

// Splash: 起動時スプラッシュ画面を表示する関数コンポーネント
export const Splash: React.FC<SplashProps> = ({ fadingOut }) => {
  return (
    // 画面全体を覆う固定配置オーバーレイ
    <div
      style={{
        // 全画面に固定配置する
        position: 'fixed',
        inset: 0,
        // ダッシュボードのヘッダーと同系のダークスレートを背景色にする
        background: '#1e293b',
        // z-index を高く設定してダッシュボードより前面に表示する
        zIndex: 9999,
        // コンテンツを縦横中央に配置する
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        // fadingOut が true のとき不透明度 0 へ滑らかに遷移する
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
        // ポインターイベントはフェードアウト中も無効にして操作をブロックしない
        pointerEvents: fadingOut ? 'none' : 'all',
      }}
    >
      {/* アプリタイトルとサブラベルのコンテナ */}
      <div style={{ textAlign: 'center' }}>
        {/* アプリ名「DevPortal」を大きく表示する */}
        <div style={{
          fontSize: '36px',
          fontWeight: '800',
          color: '#f8fafc',
          letterSpacing: '-1px',
          lineHeight: 1.1,
        }}>
          DevPortal
        </div>
        {/* サブラベル「SETUP」を小さく表示する */}
        <div style={{
          fontSize: '11px',
          fontWeight: '600',
          letterSpacing: '4px',
          textTransform: 'uppercase',
          color: '#94a3b8',
          marginTop: '6px',
        }}>
          Setup
        </div>
      </div>

      {/* スピナーと「起動中」テキストのコンテナ */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '8px',
      }}>
        {/* CSS アニメーションで回転するスピナー */}
        <div style={{
          width: '18px',
          height: '18px',
          // 上部のみボーダーを色付けして回転することでスピナーに見せる
          border: '2px solid rgba(148, 163, 184, 0.3)',
          borderTopColor: '#94a3b8',
          borderRadius: '50%',
          // index.css に定義した @keyframes spin を使用する
          animation: 'spin 0.8s linear infinite',
        }} />
        {/* 起動中テキスト */}
        <span style={{
          fontSize: '13px',
          color: '#64748b',
        }}>
          起動中…
        </span>
      </div>
    </div>
  );
};
