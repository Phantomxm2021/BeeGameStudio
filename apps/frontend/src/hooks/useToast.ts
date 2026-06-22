/**
 * Custom hook for managing toast notifications.
 * 
 * Provides a simple API for showing success, error, and warning toasts.
 * Automatically manages toast lifecycle and dismissal.
 * 
 * Requirements: 12.1, 12.2, 12.4, 12.5
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ToastType } from '../components/Common/Toast';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

export interface UseToastReturn {
  /** Array of active toasts */
  toasts: ToastItem[];

  /** Show a success toast */
  showSuccess: (message: string) => void;

  /** Show an error toast */
  showError: (message: string) => void;

  /** Show a warning toast */
  showWarning: (message: string) => void;

  /** Show a toast with custom type */
  showToast: (type: ToastType, message: string) => void;

  /** Dismiss a specific toast by ID */
  dismissToast: (id: string) => void;

  /** Dismiss all toasts */
  dismissAll: () => void;
}

/**
 * Hook for managing toast notifications
 * 
 * @example
 * ```tsx
 * const { toasts, showSuccess, showError, dismissToast } = useToast();
 * 
 * // Show success toast
 * showSuccess('项目创建成功');
 * 
 * // Show error toast
 * showError('连接失败，请稍后重试');
 * 
 * // Render toasts
 * <ToastContainer toasts={toasts} onDismiss={dismissToast} />
 * ```
 */
export const useToast = (): UseToastReturn => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  /**
   * Show a toast notification
   */
  const showToast = useCallback((type: ToastType, message: string) => {
    // Prevent duplicate toasts (same type and message)
    if (toastsRef.current.some(t => t.type === type && t.message === message)) {
      return;
    }

    const id = `toast-${Date.now()}-${Math.random()}`;

    setToasts(prev => [...prev, { id, type, message }]);

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);
  }, []);

  /**
   * Show a success toast
   */
  const showSuccess = useCallback((message: string) => {
    showToast('success', message);
  }, [showToast]);

  /**
   * Show an error toast
   */
  const showError = useCallback((message: string) => {
    showToast('error', message);
  }, [showToast]);

  /**
   * Show a warning toast
   */
  const showWarning = useCallback((message: string) => {
    showToast('warning', message);
  }, [showToast]);

  /**
   * Dismiss a specific toast by ID
   */
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  /**
   * Dismiss all toasts
   */
  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    showSuccess,
    showError,
    showWarning,
    showToast,
    dismissToast,
    dismissAll
  };
};

export default useToast;
