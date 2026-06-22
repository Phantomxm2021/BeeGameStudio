/**
 * ErrorBoundary 使用示例
 * 
 * 此文件展示如何使用 ErrorBoundary 组件来捕获和处理组件错误
 */

import { useState } from 'react';
import ErrorBoundary from './ErrorBoundary';

// 示例：一个会抛出错误的组件
function BuggyComponent() {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    // 模拟组件错误
    throw new Error('这是一个测试错误！');
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-2">正常组件</h3>
      <p className="text-gray-600 mb-4">
        点击下面的按钮会触发一个错误，ErrorBoundary 会捕获它并显示降级 UI。
      </p>
      <button
        onClick={() => setShouldThrow(true)}
        className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
      >
        触发错误
      </button>
    </div>
  );
}

// 示例：在应用根组件中使用 ErrorBoundary
export function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 p-8">
        <h1 className="text-3xl font-bold mb-8">ErrorBoundary 示例</h1>
        <div className="bg-white rounded-lg shadow p-6">
          <BuggyComponent />
        </div>
      </div>
    </ErrorBoundary>
  );
}

// 示例：嵌套使用 ErrorBoundary（局部错误处理）
export function NestedErrorBoundaryExample() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 p-8">
        <h1 className="text-3xl font-bold mb-8">嵌套 ErrorBoundary 示例</h1>
        
        <div className="grid grid-cols-2 gap-4">
          {/* 左侧组件有独立的 ErrorBoundary */}
          <ErrorBoundary>
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">左侧面板</h2>
              <BuggyComponent />
            </div>
          </ErrorBoundary>

          {/* 右侧组件有独立的 ErrorBoundary */}
          <ErrorBoundary>
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">右侧面板</h2>
              <p className="text-gray-600">
                这个面板不会受到左侧面板错误的影响。
              </p>
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;
