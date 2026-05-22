// TopBar から Overview の操作関数（ステータス更新・前提チェック）を呼び出すための共有コンテキスト
// Overview がマウント時に関数を登録し、TopBar がそれを呼び出す ref ベースのパターンを使用する
// ローディング状態はコンテキスト側で一元管理し、TopBar と Overview で二重発火しないようにする

// React のコンテキスト関連 API をインポートする
import { createContext, useContext } from 'react';

// Overview が登録する実際の関数を格納する ref の型定義
// ref を使うことで関数の更新時に不要な再レンダリングを防ぐ
export interface AppActionsRefs {
  // ステータスを再取得する関数への ref（Overview の内部関数を格納する）
  loadStatusesRef: React.MutableRefObject<() => Promise<void>>;
  // 前提条件チェックを実行する関数への ref（Overview の内部関数を格納する）
  prereqCheckRef: React.MutableRefObject<() => Promise<void>>;
}

// コンテキストが提供する値の型定義
// ローディング状態と呼び出しラッパー関数を含む
export interface AppActionsContextValue extends AppActionsRefs {
  // ステータス更新が実行中かどうか（TopBar・Overview 両方が参照する共通状態）
  isRefreshing: boolean;
  // 前提チェックが実行中かどうか（TopBar・Overview 両方が参照する共通状態）
  isPrereqChecking: boolean;
  // ローディング管理込みのステータス更新ラッパー関数（二重発火防止を内部で行う）
  runLoadStatuses: () => Promise<void>;
  // ローディング管理込みの前提チェックラッパー関数（二重発火防止を内部で行う）
  runPrereqCheck: () => Promise<void>;
}

// アプリ全体のアクション情報を共有するコンテキスト
// AppShell で提供され、TopBar と Overview が使用する
export const AppActionsContext = createContext<AppActionsContextValue | null>(null);

// AppActionsContext を取得するカスタムフック
// Overview と TopBar から使用する
export function useAppActions(): AppActionsContextValue | null {
  // コンテキストから値オブジェクトを取得して返す
  return useContext(AppActionsContext);
}
