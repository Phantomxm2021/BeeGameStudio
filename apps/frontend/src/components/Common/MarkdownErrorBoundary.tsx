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
	        <div className="markdown-error-fallback rounded-2xl border border-red-400/20 bg-red-950/20 p-4">
          <div className="error-header flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg
	                className="h-5 w-5 text-red-300"
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
	              <span className="type-footnote text-red-200">
                Rendering Error
              </span>
            </div>
            <button
              onClick={this.handleRetry}
	              className="type-button rounded-full border border-red-300/30 bg-white/10 px-3 py-1 text-red-100 transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-red-300/40"
            >
              Retry Render
            </button>
          </div>

          {/* Error details in development mode */}
          {import.meta.env.DEV && error && (
	            <div className="mb-3 rounded-xl border border-red-400/20 bg-white/[0.04] p-2">
	              <p className="type-footnote mb-1 text-red-200">
                Error Details:
              </p>
	              <p className="type-code-sm break-all text-red-300">
                {error.toString()}
              </p>
            </div>
          )}

          {/* Raw markdown content fallback */}
          <div className="raw-markdown-container">
	            <p className="type-footnote mb-2 text-zinc-400">Raw Markdown:</p>
	            <pre className="raw-markdown type-code-sm max-h-64 overflow-auto rounded-xl border border-white/10 bg-white/[0.04] p-3 whitespace-pre-wrap break-words text-zinc-300">
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
