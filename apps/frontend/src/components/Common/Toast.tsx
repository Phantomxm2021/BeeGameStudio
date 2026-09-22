import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AnimatedToastStack, type AnimatedToast } from '../beui/registry/components/motion/animated-toast-stack';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastProps {
  type: ToastType;
  message: string;
  onDismiss: () => void;
  duration?: number;
  isVisible?: boolean;
}

export interface ToastContainerProps {
  toasts: Array<{ id: string; type: ToastType; message: string }>;
  onDismiss: (id: string) => void;
}

const toBeUiToast = (toast: ToastContainerProps['toasts'][number]): AnimatedToast => ({
  id: toast.id,
  title: toast.message,
  status: toast.type === 'warning' ? 'neutral' : toast.type,
  ...(toast.type === 'warning' ? { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> } : {}),
});

const classNames = { title: 'whitespace-normal break-words' };

/** The application API stays stable; BeUI owns the entire toast surface/motion. */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return <AnimatedToastStack toasts={toasts.map(toBeUiToast)} onDismiss={onDismiss}
    placement="fixed" position="bottom-right" maxVisible={4} className="z-[10000]" classNames={classNames} />;
}

/** Single-toast entry used by component examples; global expiry belongs to useToast. */
export function Toast({ type, message, onDismiss, duration = 3000, isVisible = true }: ToastProps) {
  useEffect(() => {
    if (!isVisible || duration <= 0) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, isVisible, onDismiss]);
  return <AnimatedToastStack toasts={isVisible ? [toBeUiToast({ id: 'single-toast', type, message })] : []}
    onDismiss={onDismiss} placement="static" classNames={classNames} />;
}

export default Toast;
