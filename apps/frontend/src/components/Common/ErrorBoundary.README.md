# ErrorBoundary 组件

## 概述

ErrorBoundary 是一个 React 错误边界组件，用于捕获子组件树中的 JavaScript 错误，记录错误日志，并显示降级 UI，防止整个应用崩溃。

## 需求

- **Requirements 12.1**: REST API 请求失败时显示错误提示消息
- **Requirements 12.2**: WebSocket 连接失败时显示连接错误提示

## 功能特性

1. **错误捕获**: 捕获子组件树中的所有 JavaScript 错误
2. **错误日志**: 将错误详情记录到浏览器控制台，包括：
   - 错误对象
   - 错误信息
   - 组件堆栈
   - 时间戳
3. **降级 UI**: 显示用户友好的错误页面，而不是白屏
4. **刷新功能**: 提供刷新页面按钮，允许用户重试
5. **开发模式**: 在开发环境中显示详细的错误信息和组件堆栈

## 使用方法

### 基本用法

在应用的根组件中包裹 ErrorBoundary：

```tsx
import ErrorBoundary from './components/Common/ErrorBoundary';
import App from './App';

function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
```

### 局部使用

为特定组件提供独立的错误处理：

```tsx
import ErrorBoundary from './components/Common/ErrorBoundary';
import ChatWindow from './components/Chat/ChatWindow';

function ChatPage() {
  return (
    <div>
      <h1>聊天页面</h1>
      <ErrorBoundary>
        <ChatWindow />
      </ErrorBoundary>
    </div>
  );
}
```

### 嵌套使用

不同区域使用独立的 ErrorBoundary，实现局部错误隔离：

```tsx
import ErrorBoundary from './components/Common/ErrorBoundary';

function Dashboard() {
  return (
    <ErrorBoundary>
      <div className="dashboard">
        <ErrorBoundary>
          <Sidebar />
        </ErrorBoundary>
        
        <ErrorBoundary>
          <MainContent />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
}
```

## 降级 UI 设计

当捕获到错误时，ErrorBoundary 会显示：

1. **错误图标**: 红色警告图标，视觉上明确表示错误状态
2. **错误标题**: "出错了"
3. **错误描述**: "应用遇到了一个错误，请刷新页面重试。"
4. **刷新按钮**: 蓝色按钮，点击后刷新整个页面
5. **错误详情** (仅开发环境):
   - 错误消息
   - 组件堆栈（可展开/折叠）

## 错误日志格式

ErrorBoundary 会将以下信息记录到控制台：

```javascript
{
  error: Error,              // 错误对象
  errorInfo: ErrorInfo,      // React 错误信息
  componentStack: string,    // 组件堆栈跟踪
  timestamp: string          // ISO 格式的时间戳
}
```

## 注意事项

### ErrorBoundary 无法捕获的错误

1. **事件处理器中的错误**: 使用 try-catch 处理
2. **异步代码中的错误**: 使用 Promise.catch() 或 async/await try-catch
3. **服务端渲染错误**: 需要服务端错误处理
4. **ErrorBoundary 自身的错误**: 需要更上层的 ErrorBoundary

### 最佳实践

1. **在应用根部使用**: 确保整个应用都被保护
2. **局部使用**: 为关键功能区域提供独立的错误处理
3. **错误上报**: 在生产环境中，考虑将错误上报到错误监控服务（如 Sentry）
4. **用户体验**: 提供清晰的错误信息和恢复选项
5. **测试**: 确保 ErrorBoundary 在各种错误场景下都能正常工作

## 样式

ErrorBoundary 使用 Tailwind CSS 进行样式设计，包括：

- 响应式布局
- 现代化的卡片设计
- 清晰的视觉层次
- 友好的交互反馈

## 扩展

如果需要自定义 ErrorBoundary 的行为，可以：

1. **自定义降级 UI**: 修改 `render()` 方法中的 JSX
2. **错误上报**: 在 `componentDidCatch()` 中添加错误上报逻辑
3. **错误恢复**: 添加重置错误状态的方法（不刷新页面）
4. **错误分类**: 根据不同错误类型显示不同的 UI

## 示例

查看 `ErrorBoundary.example.tsx` 文件获取完整的使用示例。

## 相关文档

- [React Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [Design Document: Error Handling](../../.kiro/specs/web-frontend-interface/design.md#error-handling)
