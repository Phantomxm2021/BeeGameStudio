/**
 * Toast Component Usage Examples
 * 
 * This file demonstrates how to use the Toast notification component
 * in various scenarios throughout the application.
 */

import React from 'react';
import { ToastContainer } from './Toast';
import { useToast } from '../../hooks/useToast';

/**
 * Example 1: Basic Toast Usage
 * Shows how to display success, error, and warning toasts
 */
export const BasicToastExample: React.FC = () => {
  const { toasts, showSuccess, showError, showWarning, dismissToast } = useToast();

  return (
    <div className="p-8 space-y-4">
      <h2 className="text-2xl font-bold mb-4">Toast Examples</h2>

      <div className="flex gap-4">
        <button
          onClick={() => showSuccess('操作成功完成！')}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Show Success Toast
        </button>

        <button
          onClick={() => showError('操作失败，请重试')}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Show Error Toast
        </button>

        <button
          onClick={() => showWarning('请注意：这是一个警告')}
          className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Show Warning Toast
        </button>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/**
 * Example 2: API Error Handling
 * Shows how to use toasts for API error feedback
 */
export const ApiErrorExample: React.FC = () => {
  const { toasts, showSuccess, showError, dismissToast } = useToast();

  const handleApiCall = async () => {
    try {
      // Simulate API call
      const response = await fetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Project' })
      });

      if (!response.ok) {
        throw new Error('API request failed');
      }

      showSuccess('项目创建成功');
    } catch {
      showError('创建项目失败，请稍后重试');
    }
  };

  return (
    <div className="p-8">
      <button
        onClick={handleApiCall}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Create Project
      </button>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/**
 * Example 3: WebSocket Connection Status
 * Shows how to use toasts for connection status feedback
 */
export const WebSocketStatusExample: React.FC = () => {
  const { toasts, showSuccess, showError, showWarning, dismissToast } = useToast();

  const handleConnect = () => {
    showSuccess('WebSocket 连接成功');
  };

  const handleDisconnect = () => {
    showWarning('WebSocket 连接已断开');
  };

  const handleError = () => {
    showError('WebSocket 连接失败，正在重试...');
  };

  return (
    <div className="p-8 space-y-4">
      <h2 className="text-2xl font-bold mb-4">WebSocket Status</h2>

      <div className="flex gap-4">
        <button
          onClick={handleConnect}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Connect
        </button>

        <button
          onClick={handleDisconnect}
          className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Disconnect
        </button>

        <button
          onClick={handleError}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Simulate Error
        </button>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/**
 * Example 4: Multiple Toasts
 * Shows how multiple toasts stack vertically
 */
export const MultipleToastsExample: React.FC = () => {
  const { toasts, showSuccess, showError, showWarning, dismissToast } = useToast();

  const handleShowMultiple = () => {
    showSuccess('第一个通知');
    setTimeout(() => showWarning('第二个通知'), 200);
    setTimeout(() => showError('第三个通知'), 400);
  };

  return (
    <div className="p-8">
      <button
        onClick={handleShowMultiple}
        className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
      >
        Show Multiple Toasts
      </button>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

/**
 * Example 5: Integration with App Component
 * Shows how to integrate toast notifications at the app level
 */
export const AppIntegrationExample: React.FC = () => {
  const { toasts, showSuccess, dismissToast } = useToast();

  // This would typically be in your App.tsx or main layout component
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Your app content */}
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">My Application</h1>
        <button
          onClick={() => showSuccess('Welcome to the app!')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Show Welcome Message
        </button>
      </div>

      {/* Toast Container - placed at app level */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default BasicToastExample;
