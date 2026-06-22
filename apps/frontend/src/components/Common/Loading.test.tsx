/**
 * Unit tests for Loading component
 * 
 * Tests cover:
 * - Component rendering
 * - Size variants
 * - Text display
 * - Fullscreen mode
 * - Loading overlay
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Loading, LoadingOverlay } from './Loading';

describe('Loading', () => {
  it('should render loading spinner', () => {
    render(<Loading />);
    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('aria-label', '加载中');
  });

  it('should render with small size', () => {
    render(<Loading size="small" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('w-4', 'h-4');
  });

  it('should render with medium size', () => {
    render(<Loading size="medium" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('w-8', 'h-8');
  });

  it('should render with large size', () => {
    render(<Loading size="large" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('w-12', 'h-12');
  });

  it('should display optional text', () => {
    render(<Loading text="加载中..." />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('should not display text when not provided', () => {
    const { container } = render(<Loading />);
    const text = container.querySelector('p');
    expect(text).not.toBeInTheDocument();
  });

  it('should apply custom color', () => {
    render(<Loading color="text-red-500" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('text-red-500');
  });

  it('should render as fullscreen overlay', () => {
    const { container } = render(<Loading fullscreen />);
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass('bg-black/20', 'backdrop-blur-sm');
  });

  it('should render inline by default', () => {
    const { container } = render(<Loading />);
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeInTheDocument();
  });
});

describe('LoadingOverlay', () => {
  it('should render children', () => {
    render(
      <LoadingOverlay isLoading={false}>
        <div>Content</div>
      </LoadingOverlay>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should show loading overlay when isLoading is true', () => {
    const { container } = render(
      <LoadingOverlay isLoading={true}>
        <div>Content</div>
      </LoadingOverlay>
    );
    
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    
    const overlay = container.querySelector('.absolute.inset-0');
    expect(overlay).toBeInTheDocument();
  });

  it('should hide loading overlay when isLoading is false', () => {
    render(
      <LoadingOverlay isLoading={false}>
        <div>Content</div>
      </LoadingOverlay>
    );
    
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should pass size prop to Loading component', () => {
    render(
      <LoadingOverlay isLoading={true} size="large">
        <div>Content</div>
      </LoadingOverlay>
    );
    
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveClass('w-12', 'h-12');
  });

  it('should pass text prop to Loading component', () => {
    render(
      <LoadingOverlay isLoading={true} text="处理中...">
        <div>Content</div>
      </LoadingOverlay>
    );
    
    expect(screen.getByText('处理中...')).toBeInTheDocument();
  });
});
