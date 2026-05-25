import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { normalizeError, type AppError, type NormalizeOptions } from "@k1s0-ts-error/core";

export interface ErrorBoundaryFallbackProps {
  error: AppError;
  reset(): void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ComponentType<ErrorBoundaryFallbackProps>;
  onError?: (error: AppError, info: ErrorInfo) => void;
  normalizeOptions?: NormalizeOptions;
}

interface ErrorBoundaryState {
  error: AppError | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(caught: unknown): ErrorBoundaryState {
    return { error: normalizeError(caught, { component: "ErrorBoundary" }) };
  }

  override componentDidCatch(caught: unknown, info: ErrorInfo): void {
    // props の normalizeOptions を反映した AppError を onError と fallback の両方に使う
    const error = normalizeError(caught, this.props.normalizeOptions ?? { component: "ErrorBoundary" });
    // static getDerivedStateFromError で作られた暫定値を props 反映済みの値に置き換える
    this.setState({ error });
    // 呼び出し元へ正規化済みエラーを通知する
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      const fallback = this.props.fallback;
      if (typeof fallback === "function") {
        const Fallback = fallback;
        return <Fallback error={this.state.error} reset={this.reset} />;
      }
      return fallback ?? null;
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  Wrapped: ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, "children">,
): ComponentType<P> {
  // ラップ後も React DevTools で追いやすい名前を付ける
  function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <Wrapped {...props} />
      </ErrorBoundary>
    );
  }
  // displayName は監視やテスト時の診断に使う
  WithErrorBoundary.displayName = `withErrorBoundary(${Wrapped.displayName ?? Wrapped.name ?? "Component"})`;
  // HOC を返す
  return WithErrorBoundary;
}
