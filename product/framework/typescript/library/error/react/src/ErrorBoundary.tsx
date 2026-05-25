// React の Component API と関連型を取り込み
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
// core の正規化と公開型を取り込み
import { normalizeError, type AppError, type NormalizeOptions } from "@k1s0-ts-error/core";

// fallback コンポーネントに渡される props
export interface ErrorBoundaryFallbackProps {
  // 正規化済みの AppError
  error: AppError;
  // 内部 state を初期化して再描画させるリセットハンドラ
  reset(): void;
}

// ErrorBoundary 自身に渡す props
export interface ErrorBoundaryProps {
  // 保護対象の React 要素
  children: ReactNode;
  // fallback ノード or fallback コンポーネント（component の場合は AppError を受け取れる）
  fallback?: ReactNode | ComponentType<ErrorBoundaryFallbackProps>;
  // 正規化済みエラーと React の info を受け取るコールバック
  onError?: (error: AppError, info: ErrorInfo) => void;
  // normalizeError へ渡す追加オプション
  normalizeOptions?: NormalizeOptions;
}

// boundary 内部 state
interface ErrorBoundaryState {
  // 正規化済みの AppError（null なら通常描画）
  error: AppError | null;
}

// React の Error Boundary 実装本体
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // 初期 state はエラー無し
  override state: ErrorBoundaryState = { error: null };

  // 子で発生した例外を state へ反映する static フック
  // props にアクセスできないため、ここでは既定 normalizeOptions のみで正規化する
  static getDerivedStateFromError(caught: unknown): ErrorBoundaryState {
    return { error: normalizeError(caught, { component: "ErrorBoundary" }) };
  }

  // 例外捕捉時の副作用（onError 呼び出し + 必要なら props 反映の再正規化）
  override componentDidCatch(caught: unknown, info: ErrorInfo): void {
    // props.normalizeOptions が指定されていれば、それを反映した AppError で state を上書き
    if (this.props.normalizeOptions !== undefined) {
      const refined = normalizeError(caught, this.props.normalizeOptions);
      this.setState({ error: refined });
      this.props.onError?.(refined, info);
      return;
    }
    // option 未指定なら getDerivedStateFromError が作った AppError がそのまま正解
    // getDerivedStateFromError は必ず非 null AppError を返すため、ここでの state.error は確定値
    this.props.onError?.(this.state.error as AppError, info);
  }

  // fallback から呼べる reset ハンドラ
  reset = (): void => {
    // error を null に戻すと次回 render から子が再描画される
    this.setState({ error: null });
  };

  // 描画ロジック
  override render(): ReactNode {
    // エラー保持中は fallback 経路を選択
    if (this.state.error !== null) {
      const fallback = this.props.fallback;
      // 関数なら component として扱い AppError と reset を流し込む
      if (typeof fallback === "function") {
        const Fallback = fallback;
        return <Fallback error={this.state.error} reset={this.reset} />;
      }
      // ノードならそのまま描画、未指定なら null
      return fallback ?? null;
    }

    // 通常時は子をそのまま描画
    return this.props.children;
  }
}

// 任意コンポーネントを ErrorBoundary で囲む HOC（ラッパ utility）
export function withErrorBoundary<P extends object>(
  Wrapped: ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, "children">,
): ComponentType<P> {
  // 内部関数コンポーネント（displayName を後で付け替える）
  function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <Wrapped {...props} />
      </ErrorBoundary>
    );
  }
  // displayName は監視やテスト時の診断に使う（空文字列も fallback したいので || を使用）
  WithErrorBoundary.displayName = `withErrorBoundary(${Wrapped.displayName || Wrapped.name || "Component"})`;
  // HOC を返す
  return WithErrorBoundary;
}
