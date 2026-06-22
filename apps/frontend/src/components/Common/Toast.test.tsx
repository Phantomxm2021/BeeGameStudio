/**
 * Toast Component Tests
 * 
 * Basic tests to verify Toast component functionality.
 * These tests ensure the component renders correctly and handles user interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast, ToastContainer } from './Toast';
import type { ToastType } from './Toast';

describe('Toast Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should render success toast with correct styling', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="success"
        message="操作成功"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    expect(screen.getByText('操作成功')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass('bg-green-500');
  });

  it('should render error toast with correct styling', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="error"
        message="操作失败"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    expect(screen.getByText('操作失败')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass('bg-red-500');
  });

  it('should render warning toast with correct styling', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="warning"
        message="请注意"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    expect(screen.getByText('请注意')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass('bg-yellow-500');
  });

  it('should call onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="success"
        message="测试消息"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    const closeButton = screen.getByLabelText('关闭通知');
    fireEvent.click(closeButton);
    
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should auto-dismiss after default duration (3000ms)', async () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="success"
        message="自动消失"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    expect(onDismiss).not.toHaveBeenCalled();
    
    // Fast-forward time by 3000ms
    vi.advanceTimersByTime(3000);
    
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should auto-dismiss after custom duration', async () => {
    const onDismiss = vi.fn();
    const customDuration = 5000;
    
    render(
      <Toast
        type="success"
        message="自定义时长"
        isVisible={true}
        onDismiss={onDismiss}
        duration={customDuration}
      />
    );
    
    // Fast-forward time by less than custom duration
    vi.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();
    
    // Fast-forward to custom duration
    vi.advanceTimersByTime(2000);
    
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should not render when isVisible is false', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="success"
        message="不可见"
        isVisible={false}
        onDismiss={onDismiss}
      />
    );
    
    expect(screen.queryByText('不可见')).not.toBeInTheDocument();
  });

  it('should have proper ARIA attributes', () => {
    const onDismiss = vi.fn();
    
    render(
      <Toast
        type="success"
        message="可访问性测试"
        isVisible={true}
        onDismiss={onDismiss}
      />
    );
    
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
  });
});

describe('ToastContainer Component', () => {
  it('should render multiple toasts', () => {
    const toasts = [
      { id: '1', type: 'success' as ToastType, message: '第一个通知' },
      { id: '2', type: 'error' as ToastType, message: '第二个通知' },
      { id: '3', type: 'warning' as ToastType, message: '第三个通知' }
    ];
    
    const onDismiss = vi.fn();
    
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    
    expect(screen.getByText('第一个通知')).toBeInTheDocument();
    expect(screen.getByText('第二个通知')).toBeInTheDocument();
    expect(screen.getByText('第三个通知')).toBeInTheDocument();
  });

  it('should call onDismiss with correct id when toast is dismissed', () => {
    const toasts = [
      { id: 'toast-1', type: 'success' as ToastType, message: '测试通知' }
    ];
    
    const onDismiss = vi.fn();
    
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    
    const closeButton = screen.getByLabelText('关闭通知');
    fireEvent.click(closeButton);
    
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('should render empty container when no toasts', () => {
    const onDismiss = vi.fn();
    
    const { container } = render(
      <ToastContainer toasts={[]} onDismiss={onDismiss} />
    );
    
    expect(container.firstChild).toBeNull();
  });
});
