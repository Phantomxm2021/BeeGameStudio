/**
 * Toast Component Demo
 * 
 * Interactive demo page to test and showcase the Toast notification component.
 * This can be used for manual testing and visual verification.
 */

import React, { useState } from 'react';
import { ToastContainer } from './Toast';
import { useToast } from '../../hooks/useToast';

export const ToastDemo: React.FC = () => {
  const { toasts, showSuccess, showError, showWarning, dismissToast, dismissAll } = useToast();
  const [customMessage, setCustomMessage] = useState('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Toast Notification Demo
          </h1>
          <p className="text-gray-600">
            测试和演示 Toast 通知组件的各种功能
          </p>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            快速测试
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => showSuccess('操作成功完成！')}
              className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
            >
              ✓ 成功通知
            </button>

            <button
              onClick={() => showError('操作失败，请重试')}
              className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
            >
              ✕ 错误通知
            </button>

            <button
              onClick={() => showWarning('请注意：这是一个警告')}
              className="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium"
            >
              ⚠ 警告通知
            </button>
          </div>
        </div>

        {/* Custom Message */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            自定义消息
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                消息内容
              </label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="输入自定义消息..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => customMessage && showSuccess(customMessage)}
                disabled={!customMessage}
                className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                显示成功
              </button>

              <button
                onClick={() => customMessage && showError(customMessage)}
                disabled={!customMessage}
                className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                显示错误
              </button>

              <button
                onClick={() => customMessage && showWarning(customMessage)}
                disabled={!customMessage}
                className="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                显示警告
              </button>
            </div>
          </div>
        </div>

        {/* Multiple Toasts */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            多个通知
          </h2>
          <div className="space-y-4">
            <button
              onClick={() => {
                showSuccess('第一个通知');
                setTimeout(() => showWarning('第二个通知'), 200);
                setTimeout(() => showError('第三个通知'), 400);
              }}
              className="px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors font-medium"
            >
              显示多个通知（堆叠效果）
            </button>

            <button
              onClick={() => {
                for (let i = 1; i <= 5; i++) {
                  setTimeout(() => showSuccess(`通知 #${i}`), i * 300);
                }
              }}
              className="px-6 py-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors font-medium"
            >
              显示 5 个连续通知
            </button>
          </div>
        </div>

        {/* Real-world Scenarios */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            实际场景模拟
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => {
                showSuccess('项目创建成功');
              }}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium text-left"
            >
              <div className="font-semibold">创建项目</div>
              <div className="text-sm opacity-90">模拟项目创建成功</div>
            </button>

            <button
              onClick={() => {
                showError('连接失败，请检查网络');
              }}
              className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-left"
            >
              <div className="font-semibold">网络错误</div>
              <div className="text-sm opacity-90">模拟网络连接失败</div>
            </button>

            <button
              onClick={() => {
                showWarning('WebSocket 连接已断开');
              }}
              className="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors font-medium text-left"
            >
              <div className="font-semibold">连接断开</div>
              <div className="text-sm opacity-90">模拟 WebSocket 断开</div>
            </button>

            <button
              onClick={() => {
                showSuccess('消息发送成功');
              }}
              className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-left"
            >
              <div className="font-semibold">发送消息</div>
              <div className="text-sm opacity-90">模拟消息发送成功</div>
            </button>
          </div>
        </div>

        {/* Control Panel */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            控制面板
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">
                当前活跃通知数量: <strong>{toasts.length}</strong>
              </span>
              <button
                onClick={dismissAll}
                disabled={toasts.length === 0}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                清除所有通知
              </button>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-medium text-gray-800 mb-2">
                活跃通知列表
              </h3>
              {toasts.length === 0 ? (
                <p className="text-gray-500 italic">暂无活跃通知</p>
              ) : (
                <ul className="space-y-2">
                  {toasts.map((toast) => (
                    <li
                      key={toast.id}
                      className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`
                          px-2 py-1 rounded text-xs font-medium
                          ${toast.type === 'success' ? 'bg-green-100 text-green-800' : ''}
                          ${toast.type === 'error' ? 'bg-red-100 text-red-800' : ''}
                          ${toast.type === 'warning' ? 'bg-yellow-100 text-yellow-800' : ''}
                        `}>
                          {toast.type}
                        </span>
                        <span className="text-gray-700">{toast.message}</span>
                      </div>
                      <button
                        onClick={() => dismissToast(toast.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            ℹ️ 使用说明
          </h3>
          <ul className="text-blue-800 space-y-1 text-sm">
            <li>• 通知会在 3 秒后自动消失</li>
            <li>• 可以点击通知右上角的 ✕ 按钮手动关闭</li>
            <li>• 多个通知会垂直堆叠显示</li>
            <li>• 通知使用 Framer Motion 实现流畅的进入/退出动画</li>
            <li>• 支持键盘操作和屏幕阅读器（ARIA 属性）</li>
          </ul>
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default ToastDemo;
