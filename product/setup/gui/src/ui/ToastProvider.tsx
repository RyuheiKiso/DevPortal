// トースト通知の状態管理と表示を担当するプロバイダーコンポーネント
// アプリ全体を <ToastProvider> で包み、useToast() フックでどこからでも通知を表示できる

// React の各種フックと型をインポートする
import React, { createContext, useCallback, useContext, useState } from 'react';
// トーストコンポーネントとデータ型をインポートする
import { Toast, ToastData } from './Toast';
// CSS Modules のスタイルをインポートする
import styles from './Toast.module.css';

// useToast フックが提供する値の型定義
interface ToastContextValue {
  // 成功通知を表示する関数
  showSuccess: (message: string, duration?: number) => void;
  // エラー通知を表示する関数
  showDanger: (message: string, duration?: number) => void;
  // 情報通知を表示する関数
  showInfo: (message: string, duration?: number) => void;
}

// トーストコンテキストのオブジェクト
const ToastContext = createContext<ToastContextValue | null>(null);

// トーストの表示時間のデフォルト値（ミリ秒）
const DEFAULT_DURATION = 3000;

// 一意な ID を生成するカウンター（グローバル変数として管理する）
let toastIdCounter = 0;

// アプリ全体でトースト通知を管理・表示するプロバイダーコンポーネント
export function ToastProvider({ children }: { children: React.ReactNode }) {
  // 現在表示中のトーストリストを state で管理する
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // 指定した ID のトーストを削除する関数
  const dismiss = useCallback((id: string) => {
    // 指定 ID 以外のトーストを残して state を更新する
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // トーストを追加して指定時間後に自動削除する共通関数
  const show = useCallback((message: string, variant: ToastData['variant'], duration: number) => {
    // 一意な ID を生成する
    const id = String(++toastIdCounter);
    // 新しいトーストを state に追加する
    setToasts((prev) => [...prev, { id, message, variant }]);
    // 指定時間後に自動削除するタイマーをセットする
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  // 成功通知を表示するコールバック関数
  const showSuccess = useCallback((message: string, duration = DEFAULT_DURATION) => {
    // 成功 variant でトーストを表示する
    show(message, 'success', duration);
  }, [show]);

  // エラー通知を表示するコールバック関数
  const showDanger = useCallback((message: string, duration = DEFAULT_DURATION) => {
    // 危険 variant でトーストを表示する
    show(message, 'danger', duration);
  }, [show]);

  // 情報通知を表示するコールバック関数
  const showInfo = useCallback((message: string, duration = DEFAULT_DURATION) => {
    // 情報 variant でトーストを表示する
    show(message, 'info', duration);
  }, [show]);

  // コンテキストとトーストレンダリングを組み合わせて提供する
  return (
    // トースト操作関数を子コンポーネント全体に提供する
    <ToastContext.Provider value={{ showSuccess, showDanger, showInfo }}>
      {/* アプリの子コンポーネントを描画する */}
      {children}
      {/* 現在表示中のトーストを画面右下に絶対配置するコンテナ */}
      <div className={styles.toastContainer}>
        {/* 各トーストを順番に描画する */}
        {toasts.map((toast) => (
          <Toast
            // トーストの一意 ID をキーに使用する
            key={toast.id}
            // トーストのデータをスプレッドで渡す
            {...toast}
            // 閉じるコールバックを渡す
            onClose={dismiss}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ToastContext を取得するカスタムフック
export function useToast(): ToastContextValue {
  // コンテキストから値を取得する
  const ctx = useContext(ToastContext);
  // ToastProvider 外で使用された場合はエラーを投げる
  if (!ctx) throw new Error('useToast は ToastProvider の内部でのみ使用できます');
  // トースト操作関数を返す
  return ctx;
}
