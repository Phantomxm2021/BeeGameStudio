import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { metricsTracker } from '../../utils/metricsTracker';
import { errorLogger } from '../../utils/errorLogger';

/**
 * Props for MarkdownErrorBoundary component
 */
interface MarkdownErrorBoundaryProps {
  /** Child components to render (typically ReactMarkdown) */
  children: ReactNode;
  /** Optional custom fallback UI to display on error */
  fallback?: ReactNode;
  /** Optional callback invoked when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Unique identifier for the message being rendered */
  messageId: string;
  /** Raw markdown content to display in fallback UI */
  rawContent: string;
}

/**
 * State for MarkdownErrorBoundary component
 */
interface MarkdownErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The error object if an error was caught */
  error?: Error;
}

/**
 * MarkdownErrorBoundary Component
 * 
 * React Error Boundary specifically designed for markdown rendering errors.
 * Catches rendering errors and provides fallback UI with raw markdown display.
 * 
 * This component wraps ReactMarkdown components to prevent rendering errors
 * from crashing the entire application. When an error occurs, it displays
 * the raw markdown content in a code block and provides a retry button.
 * 
 * Features:
 * - Catches all React errors during markdown rendering
 * - Displays user-friendly fallback UI with raw markdown
 * - Provides "Retry Render" button for recovery
 * - Logs detailed error information for debugging
 * - Tracks rendering failure metrics
 * - Shows error details in development mode
 * 
 * Usage:
 * ```tsx
 * <MarkdownErrorBoundary 
 *   messageId={message.id} 
 *   rawContent={message.content}
 *   onError={(error) => console.error(error)}
 * >
 *   <ReactMarkdown>{message.content}</ReactMarkdown>
 * </MarkdownErrorBoundary>
 * ```
 * 
 * Requirements: 3.6, 5.1, 5.2, 5.4
 */
class MarkdownErrorBoundary extends Component<
  MarkdownErrorBoundaryProps,
  MarkdownErrorBoundaryState
> {
  constructor(props: MarkdownErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: undefined,
    };
  }

  /**
   * Static lifecycle method called when an error is thrown
   * Updates state to trigger fallback UI rendering
   * 
   * @param error - The error that was thrown
   * @returns Partial state update to trigger error UI
   */
  static getDerivedStateFromError(error: Error): Partial<MarkdownErrorBoundaryState> {
    // Update state to trigger fallback UI
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Lifecycle method called after an error is caught
   * Logs error details and tracks metrics
   * 
   * @param error - The error that was thrown
   * @param errorInfo - Additional error information including component stack
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { messageId, rawContent, onError } = this.props;

    // Log detailed error information
    console.error('[Markdown] Rendering error:', {
      error,
      errorInfo,
      messageId,
      contentPreview: rawContent.substring(0, 200),
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // Log to error logger
    errorLogger.error('rendering', 'Markdown rendering failed', {
      messageId,
      error: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
      contentPreview: rawContent.substring(0, 200)
    });

    // Track rendering failure metrics
    metricsTracker.incrementRenderFailures();

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }
  }

  /**
   * Handles retry button click
   * Resets error state to attempt re-rendering the markdown content
   */
  handleRetry = (): void => {
    // Log retry attempt
    errorLogger.info('rendering', 'Retrying markdown render', {
      messageId: this.props.messageId
    });
    
    // Reset error state to retry rendering
    this.setState({
      hasError: false,
      error: undefined,
    });
  };

  /**
   * Renders either the children (on success) or fallback UI (on error)
   * 
   * @returns The rendered component
   */
  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, rawContent } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      return (
        <div className="markdown-error-fallback border border-red-200 rounded-lg p-4 bg-red-50">
          <div className="error-header flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-red-600"
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
              <span className="text-sm font-medium text-red-800">
                Rendering Error
              </span>
            </div>
            <button
              onClick={this.handleRetry}
              className="px-3 py-1 text-sm font-medium text-red-700 bg-white border border-red-300 rounded hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
            >
              Retry Render
            </button>
          </div>

          {/* Error details in development mode */}
          {import.meta.env.DEV && error && (
            <div className="mb-3 p-2 bg-white rounded border border-red-200">
              <p className="text-xs font-semibold text-red-700 mb-1">
                Error Details:
              </p>
              <p className="text-xs text-red-600 font-mono break-all">
                {error.toString()}
              </p>
            </div>
          )}

          {/* Raw markdown content fallback */}
          <div className="raw-markdown-container">
            <p className="text-xs text-gray-600 mb-2">Raw Markdown:</p>
            <pre className="raw-markdown text-xs bg-white p-3 rounded border border-gray-300 overflow-auto max-h-64 whitespace-pre-wrap break-words font-mono text-gray-800">
              {rawContent}
            </pre>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default MarkdownErrorBoundary;
