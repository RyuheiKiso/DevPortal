// React のクラスコンポーネント関連を取り込み
import { Component, type ErrorInfo, type ReactNode } from "react";
// core の Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";

// ErrorBoundary の props
export interface ErrorBoundaryProps {
  // エラー発生時にログを出す Logger（省略時はログを出さない）
  logger?: Logger;
  // エラー時に表示するフォールバック（要素 or 関数）
  fallback?: ReactNode | ((error: Error) => ReactNode);
  // ログ通知に加えて任意の副作用を行うコールバック
  onError?: (error: Error, info: ErrorInfo) => void;
  // resetKeys のいずれかが変化したら error 状態を解除する（react-error-boundary 互換）
  resetKeys?: readonly unknown[];
  // 通常時に描画する子要素
  children: ReactNode;
}

// ErrorBoundary の state（エラー本体を保持）
interface ErrorBoundaryState {
  // 現在の捕捉エラー（無ければ null）
  error: Error | null;
}

// resetKeys 配列を Object.is で要素ごとに比較
function resetKeysChanged(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  // 両方 undefined / 同一参照なら変化なし
  if (prev === next) return false;
  // 片方だけ undefined なら変化あり
  if (prev === undefined || next === undefined) return true;
  // 長さが違えば変化あり
  if (prev.length !== next.length) return true;
  // 各要素を比較
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  // 変化なし
  return false;
}

// React の Error Boundary を提供するクラスコンポーネント
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // 初期状態（エラー無し）
  state: ErrorBoundaryState = { error: null };

  // エラーから派生 state を返す（React 17+ の Error Boundary フック）
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // state.error をセットしてフォールバックを描画させる
    return { error };
  }

  // エラーの実通知（ログ出力と onError 呼び出し）。logger.error が throw しても boundary 自身は壊さない
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logger があれば error レベルで通知（呼出失敗は console.warn で 1 行だけ漏らす）
    if (this.props.logger) {
      try {
        // React 19 で componentStack が null になり得るため null は undefined に正規化
        this.props.logger.error("react.errorBoundary", {
          error,
          componentStack: info.componentStack ?? undefined,
        });
      } catch (loggerErr) {
        // ログ通知自体が落ちても boundary は機能させ続ける
        // eslint-disable-next-line no-console
        console.warn("@k1s0-ts-logger/react: ErrorBoundary logger.error threw", loggerErr);
      }
    }
    // 任意のコールバックも保護的に呼ぶ（失敗しても boundary は機能し続ける）
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch (onErrorErr) {
        // eslint-disable-next-line no-console
        console.warn("@k1s0-ts-logger/react: ErrorBoundary onError threw", onErrorErr);
      }
    }
  }

  // resetKeys のいずれかが変化したら error 状態を解除し、children の再描画を許す
  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // error 状態でなければチェック不要
    if (this.state.error === null) return;
    // resetKeys に変化があれば state をクリア
    if (resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  // 状態に応じて子 or フォールバックを描画
  render(): ReactNode {
    // エラー無しなら通常描画
    if (this.state.error === null) {
      return this.props.children;
    }
    // 関数フォールバックなら呼んで結果を使う
    if (typeof this.props.fallback === "function") {
      return this.props.fallback(this.state.error);
    }
    // 値フォールバック（省略時は null で何も描画しない）
    return this.props.fallback ?? null;
  }
}
