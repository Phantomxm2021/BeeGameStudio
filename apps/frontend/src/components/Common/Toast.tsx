/**
 * Toast notification component for the BeeGame frontend.
 *
 * Features:
 * - Auto-hide after 3 seconds
 * - Smooth enter/exit animations using Framer Motion
 * - Deduplication via useToast hook
 * 
 * Requirements: 12.1, 12.2, 12.4, 12.5
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastProps {
  type: ToastType;
  message: string;
  onDismiss: () => void;
  duration?: number;
  isVisible?: boolean;
}

const getToastIcon = (type: ToastType) => {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="w-5 h-5 text-green-100" />;
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-100" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-amber-100" />;
  }
};

const getToastColors = (type: ToastType): string => {
  switch (type) {
    case 'success':
      return 'bg-green-500 text-white';
    case 'error':
      return 'bg-red-500 text-white';
    case 'warning':
      return 'bg-yellow-500 text-white';
  }
};

export const Toast: React.FC<ToastProps> = ({
  type,
  message,
  onDismiss,
  duration = 3000,
  isVisible = true
}) => {
  // Auto-hide after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  if (!isVisible) {
    return null;
  }

  return (
    <motion.div
      className={`
        ${getToastColors(type)}
        rounded-full shadow-xl px-6 py-3
        flex items-center gap-3
        min-w-[280px] max-w-md
      `}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Icon */}
      <motion.div
        className="flex-shrink-0"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 15,
          delay: 0.1
        }}
      >
        {getToastIcon(type)}
      </motion.div>

      {/* Message */}
      <div className="type-footnote flex-1">
        {message}
      </div>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={onDismiss}
        className="flex h-6 w-6 items-center justify-center rounded-full text-white/90 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/70"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.div>
  );
};

export interface ToastContainerProps {
  toasts: Array<{
    id: string;
    type: ToastType;
    message: string;
  }>;
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss
}) => {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-3 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1, transition: { duration: 0.2 } }}
            className="pointer-events-auto"
          >
            <Toast
              type={toast.type}
              message={toast.message}
              onDismiss={() => onDismiss(toast.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Toast;
