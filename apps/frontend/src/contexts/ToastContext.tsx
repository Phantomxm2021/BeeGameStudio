/**
 * Toast Context
 * 
 * Provides a global toast notification system accessible throughout the app.
 * This context wraps the useToast hook and makes it available to all components.
 * 
 * Requirements: 12.1, 12.2, 12.4, 12.5
 */

import React, { createContext, useContext } from 'react';
import { useToast, type UseToastReturn } from '../hooks/useToast';
import { ToastContainer } from '../components/Common/Toast';

/**
 * Toast context type
 */
type ToastContextType = UseToastReturn;

/**
 * Toast context
 */
const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * Toast provider props
 */
interface ToastProviderProps {
  children: React.ReactNode;
}

/**
 * Toast provider component
 * 
 * Wraps the application and provides toast notification functionality
 * to all child components via context.
 * 
 * @example
 * ```tsx
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 * ```
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const toast = useToast();

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast notifications
 * 
 * Must be used within a ToastProvider.
 * 
 * @returns Toast notification functions
 * @throws Error if used outside ToastProvider
 * 
 * @example
 * ```tsx
 * const { showSuccess, showError } = useToastContext();
 * 
 * showSuccess('操作成功');
 * showError('操作失败');
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useToastContext = (): ToastContextType => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToastContext must be used within a ToastProvider');
  }

  return context;
};
