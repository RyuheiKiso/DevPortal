// テーマ（ライト/ダーク/OS 追従）の切り替えと localStorage への永続化を担当するモジュール
// アプリ全体を <ThemeProvider> で包み、useTheme() フックでどこからでも操作できるようにする

// React の各種フックと型をインポートする
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// テーマの種別を表す文字列ユニオン型（ライト/ダーク/OS 設定に追従）
export type ThemeMode = 'light' | 'dark' | 'system';

// ThemeContext が子コンポーネントに提供する値の型
interface ThemeContextValue {
  // 現在のテーマ設定（light/dark/system のいずれか）
  mode: ThemeMode;
  // テーマを切り替えるコールバック（localStorage にも保存する）
  setMode: (mode: ThemeMode) => void;
  // 実際に HTML に適用されているテーマ（system の場合は OS に応じて解決済み）
  resolved: 'light' | 'dark';
}

// テーマ状態を子コンポーネント全体に伝達するためのコンテキストオブジェクト
const ThemeContext = createContext<ThemeContextValue | null>(null);

// localStorage に保存するテーマ設定のキー名
const STORAGE_KEY = 'devportal-theme';

// OS のダークモード設定を検出するメディアクエリ文字列
const DARK_MEDIA = '(prefers-color-scheme: dark)';

// localStorage から保存済みのテーマ設定を読み込む関数（未保存なら 'system' を返す）
function loadStoredMode(): ThemeMode {
  // localStorage に保存された値を取得する
  const stored = localStorage.getItem(STORAGE_KEY);
  // 保存値が有効な ThemeMode であればそれを返す
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  // 未設定の場合は OS 設定に追従するデフォルトを返す
  return 'system';
}

// 現在の OS テーマ設定を matchMedia で判定して返す関数
function getSystemResolved(): 'light' | 'dark' {
  // OS がダークモードを要求しているか判定する
  return window.matchMedia(DARK_MEDIA).matches ? 'dark' : 'light';
}

// ThemeMode を実際に HTML に適用するテーマ名（'light' | 'dark'）に解決する関数
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  // system モードの場合は OS 設定を参照する
  if (mode === 'system') return getSystemResolved();
  // それ以外はそのまま返す
  return mode;
}

// アプリ全体をテーマコンテキストで包むプロバイダーコンポーネント
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 初期テーマを localStorage から読み込んで state に設定する
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode);
  // 実際に HTML に適用されているテーマ名を管理する state
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(loadStoredMode()));

  // mode が変化したとき HTML の data-theme 属性を更新する副作用
  useEffect(() => {
    // 現在の mode から実際のテーマ名を解決する
    const newResolved = resolveTheme(mode);
    // <html> 要素の data-theme 属性をセットして CSS 変数を切り替える
    document.documentElement.setAttribute('data-theme', newResolved);
    // resolved state を新しいテーマ名で更新する
    setResolved(newResolved);
  }, [mode]);

  // system モードのとき OS ダークモード設定の変更をリアルタイム監視する副作用
  useEffect(() => {
    // system モード以外では監視が不要なので早期リターンする
    if (mode !== 'system') return;
    // prefers-color-scheme の変化を監視するメディアクエリオブジェクトを取得する
    const mq = window.matchMedia(DARK_MEDIA);
    // OS テーマが変わったとき data-theme を即時更新するハンドラ
    const handler = () => {
      // 変更後の OS テーマを取得する
      const newResolved = getSystemResolved();
      // <html> 要素に即時反映する
      document.documentElement.setAttribute('data-theme', newResolved);
      // resolved state も更新する
      setResolved(newResolved);
    };
    // メディアクエリにリスナーを登録する
    mq.addEventListener('change', handler);
    // コンポーネントのクリーンアップ時（mode 変更・アンマウント）にリスナーを解除する
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // テーマを変更し localStorage にも保存するメモ化されたコールバック
  const setMode = useCallback((newMode: ThemeMode) => {
    // React の state を更新する
    setModeState(newMode);
    // 次回起動時に復元できるよう localStorage に保存する
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  // テーマ情報をコンテキスト経由で子コンポーネント全体に提供する
  return (
    <ThemeContext.Provider value={{ mode, setMode, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ThemeContext を取得するカスタムフック（ThemeProvider の外で使われた場合にエラーを投げる）
export function useTheme(): ThemeContextValue {
  // ThemeContext から値を取得する
  const ctx = useContext(ThemeContext);
  // ThemeProvider 外で使用されている場合は開発時に明確なエラーを出す
  if (!ctx) throw new Error('useTheme は ThemeProvider の内部でのみ使用できます');
  // コンテキスト値を返す
  return ctx;
}
