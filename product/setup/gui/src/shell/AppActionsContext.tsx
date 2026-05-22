// TopBar から Overview の操作関数（ステータス更新・前提チェック）を呼び出すための共有コンテキスト
// Overview がマウント時に関数を登録し、TopBar がそれを呼び出す ref ベースのパターンを使用する

// React のコンテキスト関連 API をインポートする
import { createContext, useContext } from 'react';

// コンテキストが提供する ref オブジェクトの型定義
// ref を使うことで関数の更新時に不要な再レンダリングを防ぐ
export interface AppActionsRefs {
  // ステータスを再取得する関数への ref（Overview の loadStatuses を格納する）
  loadStatuses: React.MutableRefObject<() => Promise<void>>;
  // 前提条件チェックを実行する関数への ref（Overview の handlePrereqCheck を格納する）
  prereqCheck: React.MutableRefObject<() => Promise<void>>;
}

// アプリ全体のアクション ref を共有するコンテキスト
// AppShell で提供され、TopBar と Overview が使用する
export const AppActionsContext = createContext<AppActionsRefs | null>(null);

// AppActionsContext を取得するカスタムフック
// Overview と TopBar から使用する
export function useAppActions(): AppActionsRefs | null {
  // コンテキストから ref オブジェクトを取得して返す
  return useContext(AppActionsContext);
}
