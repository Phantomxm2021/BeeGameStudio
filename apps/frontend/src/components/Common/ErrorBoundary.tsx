import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary 组件
 * 
 * 捕获子组件树中的 JavaScript 错误，记录错误日志，并显示降级 UI
 * 
 * Requirements: 12.1, 12.2
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // 更新 state 使下一次渲染能够显示降级 UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录错误到控制台
    console.error('ErrorBoundary caught an error:', {
      error,
      errorInfo,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // 更新 state 保存错误信息
    this.setState({
      errorInfo,
    });
  }

  handleRefresh = (): void => {
    // 刷新页面
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 降级 UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-muted px-4">
          <div className="max-w-md w-full bg-background rounded-lg shadow-lg p-8">
            <div className="flex items-center justify-center w-16 h-16 mx-auto bg-muted rounded-full mb-4">
              <svg
                className="w-8 h-8 text-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

	            <h2 className="type-title-3 mb-2 text-center text-muted-foreground">
              出错了
            </h2>

	            <p className="type-callout mb-6 text-center text-muted-foreground">
              应用遇到了一个错误，请刷新页面重试。
            </p>

            {/* 错误详情（仅在开发环境显示） */}
            {import.meta.env.DEV && this.state.error && (
	              <div className="mb-6 max-h-48 overflow-auto rounded-2xl border border-border bg-muted p-4">
	                <p className="type-footnote mb-2 text-muted-foreground">
                  错误详情：
                </p>
	                <p className="type-code-sm break-all text-foreground">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <details className="mt-2">
	                    <summary className="type-footnote cursor-pointer text-muted-foreground hover:text-muted-foreground">
                      组件堆栈
                    </summary>
	                    <pre className="type-code-sm mt-2 whitespace-pre-wrap text-muted-foreground">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <button
              onClick={this.handleRefresh}
	              className="type-button w-full rounded-full bg-secondary px-4 py-3 text-secondary-foreground transition-colors duration-200 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
