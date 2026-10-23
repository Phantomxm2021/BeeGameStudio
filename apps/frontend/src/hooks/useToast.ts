import { useCallback, useMemo } from 'react';
import type { ToastType } from '../components/Common/Toast';
import { useAnimatedToastStack } from '../components/beui/registry/components/motion/animated-toast-stack';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

export interface UseToastReturn {
  toasts: ToastItem[];
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showToast: (type: ToastType, message: string) => void;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

/** Product naming/deduplication only. The BeUI hook owns timers and cleanup. */
export const useToast = (): UseToastReturn => {
  const { toasts: stack, setToasts, dismissToast, clearToasts } = useAnimatedToastStack({ defaultDuration: 3000 });
  const showToast = useCallback((type: ToastType, message: string) => {
    const status = type === 'warning' ? 'neutral' : type;
    setToasts(current => current.some(toast => toast.status === status && toast.title === message) ? current : [
      ...current,
      { id: crypto.randomUUID(), status, title: message, createdAt: Date.now(), duration: 3000 },
    ]);
  }, [setToasts]);
  const showSuccess = useCallback((message: string) => showToast('success', message), [showToast]);
  const showError = useCallback((message: string) => showToast('error', message), [showToast]);
  const showWarning = useCallback((message: string) => showToast('warning', message), [showToast]);
  const toasts = useMemo(() => stack.map(toast => ({
    id: toast.id, message: String(toast.title),
    type: (toast.status === 'success' || toast.status === 'error' ? toast.status : 'warning') as ToastType,
  })), [stack]);
  return { toasts, showSuccess, showError, showWarning, showToast, dismissToast, dismissAll: clearToasts };
};

export default useToast;
