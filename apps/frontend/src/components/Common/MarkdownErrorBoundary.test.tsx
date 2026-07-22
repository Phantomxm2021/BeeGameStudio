import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';

// Component that throws an error for testing
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test rendering error');
  }
  return <div>Normal content</div>;
};

describe('MarkdownErrorBoundary', () => {
  beforeEach(() => {
    // Clear console.error mock before each test
    vi.clearAllMocks();
    // Suppress console.error in tests to avoid noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should render children when no error occurs', () => {
    render(
      <MarkdownErrorBoundary messageId="test-1" rawContent="# Test">
        <div>Test content</div>
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should display fallback UI when error occurs', () => {
    render(
      <MarkdownErrorBoundary messageId="test-2" rawContent="# Test markdown">
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Rendering Error')).toBeInTheDocument();
    expect(screen.getByText('Retry Render')).toBeInTheDocument();
  });

  it('should display raw markdown content in fallback', () => {
    const rawContent = '# Test Heading\n\nSome content';
    
    render(
      <MarkdownErrorBoundary messageId="test-3" rawContent={rawContent}>
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Raw Markdown:')).toBeInTheDocument();
    // Use getByText with function matcher to handle whitespace
    expect(screen.getByText((content, element) => {
      return element?.tagName === 'PRE' && element.textContent?.trim() === rawContent.trim();
    })).toBeInTheDocument();
  });

  it('should call onError callback when error occurs', () => {
    const onError = vi.fn();
    
    render(
      <MarkdownErrorBoundary
        messageId="test-4"
        rawContent="# Test"
        onError={onError}
      >
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String)
      })
    );
  });

  it('should log error details to console', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error');
    
    render(
      <MarkdownErrorBoundary messageId="test-5" rawContent="# Test content">
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
    // Find the call that contains our custom log message
    const customLogCall = consoleErrorSpy.mock.calls.find(
      call => call[0] === '[Markdown] Rendering error:'
    );
    expect(customLogCall).toBeDefined();
    expect(customLogCall![1]).toMatchObject({
      messageId: 'test-5',
      contentPreview: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  it('should have a retry button that can be clicked', () => {
    const infoLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(
      <MarkdownErrorBoundary messageId="test-6" rawContent="# Test">
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    // Error fallback should be visible
    expect(screen.getByText('Rendering Error')).toBeInTheDocument();
    
    // Verify retry button exists
    const retryButton = screen.getByText('Retry Render');
    expect(retryButton).toBeInTheDocument();
    
    // Verify button is clickable (doesn't throw)
    expect(() => fireEvent.click(retryButton)).not.toThrow();
    expect(infoLog).toHaveBeenCalled();
    infoLog.mockRestore();
  });

  it('should use custom fallback when provided', () => {
    const customFallback = <div>Custom error message</div>;
    
    render(
      <MarkdownErrorBoundary
        messageId="test-7"
        rawContent="# Test"
        fallback={customFallback}
      >
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Custom error message')).toBeInTheDocument();
    expect(screen.queryByText('Rendering Error')).not.toBeInTheDocument();
  });

  it('should truncate long content in error log', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const longContent = 'a'.repeat(500);
    
    render(
      <MarkdownErrorBoundary messageId="test-8" rawContent={longContent}>
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    // Find the call that contains our custom log message
    const customLogCall = consoleErrorSpy.mock.calls.find(
      call => call[0] === '[Markdown] Rendering error:'
    );
    expect(customLogCall).toBeDefined();
    const contentPreview = customLogCall![1].contentPreview;
    expect(contentPreview.length).toBe(200);
  });

  it('should display error details in development mode', () => {
    // Mock development environment
    const originalEnv = import.meta.env.DEV;
    import.meta.env.DEV = true;

    render(
      <MarkdownErrorBoundary messageId="test-9" rawContent="# Test">
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Error Details:')).toBeInTheDocument();
    expect(screen.getByText(/Test rendering error/)).toBeInTheDocument();

    // Restore environment
    import.meta.env.DEV = originalEnv;
  });

  it('should handle empty raw content gracefully', () => {
    render(
      <MarkdownErrorBoundary messageId="test-10" rawContent="">
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    expect(screen.getByText('Rendering Error')).toBeInTheDocument();
    expect(screen.getByText('Raw Markdown:')).toBeInTheDocument();
  });

  it('should handle very long raw content in fallback', () => {
    const longContent = '# '.repeat(1000) + 'Very long content';
    
    render(
      <MarkdownErrorBoundary messageId="test-11" rawContent={longContent}>
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    const preElement = screen.getByText(longContent);
    expect(preElement).toBeInTheDocument();
    expect(preElement.className).toContain('max-h-64');
    expect(preElement.className).toContain('overflow-auto');
  });

  it('should preserve markdown special characters in fallback', () => {
    const specialContent = '```javascript\nconst x = `test`;\n```\n| Col1 | Col2 |\n|------|------|\n| A | B |';
    
    render(
      <MarkdownErrorBoundary messageId="test-12" rawContent={specialContent}>
        <ThrowError shouldThrow={true} />
      </MarkdownErrorBoundary>
    );

    // Use function matcher to handle whitespace
    expect(screen.getByText((content, element) => {
      return element?.tagName === 'PRE' && element.textContent?.trim() === specialContent.trim();
    })).toBeInTheDocument();
  });
});
