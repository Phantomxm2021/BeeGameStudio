# Toast Notification Component

Toast 通知组件用于向用户显示临时的反馈消息，支持成功、错误和警告三种类型。

## 功能特性

- ✅ **三种通知类型**：success（成功）、error（错误）、warning（警告）
- ⏱️ **自动隐藏**：默认 3 秒后自动消失
- 🎨 **流畅动画**：使用 Framer Motion 实现进入/退出动画
- 📱 **响应式设计**：适配不同屏幕尺寸
- ♿ **可访问性**：支持 ARIA 属性和键盘操作
- 🎯 **多通知堆叠**：支持同时显示多个通知

## 使用方法

### 基础用法

```tsx
import { ToastContainer } from './components/Common';
import { useToast } from './hooks/useToast';

function MyComponent() {
  const { toasts, showSuccess, showError, showWarning, dismissToast } = useToast();
  
  const handleSuccess = () => {
    showSuccess('操作成功完成！');
  };
  
  const handleError = () => {
    showError('操作失败，请重试');
  };
  
  const handleWarning = () => {
    showWarning('请注意：这是一个警告');
  };
  
  return (
    <div>
      <button onClick={handleSuccess}>显示成功通知</button>
      <button onClick={handleError}>显示错误通知</button>
      <button onClick={handleWarning}>显示警告通知</button>
      
      {/* 在组件树的顶层放置 ToastContainer */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

### 在 API 调用中使用

```tsx
import { useToast } from './hooks/useToast';
import { api } from './services/api';

function ProjectManager() {
  const { toasts, showSuccess, showError, dismissToast } = useToast();
  
  const createProject = async (name: string) => {
    try {
      await api.createProject({ name });
      showSuccess('项目创建成功');
    } catch (error) {
      showError('创建项目失败，请稍后重试');
    }
  };
  
  return (
    <div>
      <button onClick={() => createProject('New Project')}>
        创建项目
      </button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

### 在 WebSocket 连接中使用

```tsx
import { useToast } from './hooks/useToast';
import { useWebSocket } from './hooks/useWebSocket';

function ChatWindow() {
  const { toasts, showSuccess, showError, dismissToast } = useToast();
  
  const { ws } = useWebSocket({
    projectId: 'project-123',
    onMessage: (message) => {
      // Handle message
    },
    onError: () => {
      showError('WebSocket 连接失败，正在重试...');
    },
    onClose: () => {
      showWarning('WebSocket 连接已断开');
    }
  });
  
  return (
    <div>
      {/* Chat content */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
```

### 应用级集成

推荐在应用的根组件中集成 Toast 通知系统：

```tsx
// App.tsx
import { ToastContainer } from './components/Common';
import { useToast } from './hooks/useToast';
import { ToastContext } from './contexts/ToastContext';

function App() {
  const toast = useToast();
  
  return (
    <ToastContext.Provider value={toast}>
      <div className="app">
        {/* Your app content */}
        <Sidebar />
        <MainContent />
        
        {/* Toast Container at app level */}
        <ToastContainer 
          toasts={toast.toasts} 
          onDismiss={toast.dismissToast} 
        />
      </div>
    </ToastContext.Provider>
  );
}
```

然后在任何子组件中使用：

```tsx
import { useContext } from 'react';
import { ToastContext } from './contexts/ToastContext';

function ChildComponent() {
  const { showSuccess } = useContext(ToastContext);
  
  return (
    <button onClick={() => showSuccess('操作成功')}>
      执行操作
    </button>
  );
}
```

## API 参考

### Toast 组件

```tsx
interface ToastProps {
  type: 'success' | 'error' | 'warning';
  message: string;
  isVisible: boolean;
  onDismiss: () => void;
  duration?: number; // 默认 3000ms
}
```

### ToastContainer 组件

```tsx
interface ToastContainerProps {
  toasts: Array<{
    id: string;
    type: 'success' | 'error' | 'warning';
    message: string;
  }>;
  onDismiss: (id: string) => void;
}
```

### useToast Hook

```tsx
interface UseToastReturn {
  toasts: ToastItem[];
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showToast: (type: ToastType, message: string) => void;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}
```

## 样式定制

Toast 组件使用 Tailwind CSS 进行样式设计。如果需要自定义样式，可以修改 `Toast.tsx` 中的类名：

```tsx
// 修改颜色
const getToastColors = (type: ToastType): string => {
  switch (type) {
    case 'success':
      return 'bg-green-500 text-white'; // 修改为你的颜色
    case 'error':
      return 'bg-red-500 text-white';
    case 'warning':
      return 'bg-yellow-500 text-white';
  }
};
```

## 动画配置

Toast 使用 Framer Motion 实现动画。可以通过修改 `motion.div` 的属性来自定义动画效果：

```tsx
<motion.div
  initial={{ opacity: 0, y: -50, scale: 0.9 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: -20, scale: 0.95 }}
  transition={{
    duration: 0.3,
    ease: [0.4, 0, 0.2, 1]
  }}
>
```

## 可访问性

Toast 组件遵循 WCAG 2.1 可访问性标准：

- 使用 `role="alert"` 标记通知区域
- 使用 `aria-live="polite"` 确保屏幕阅读器能够读取通知
- 使用 `aria-atomic="true"` 确保完整读取通知内容
- 提供关闭按钮的 `aria-label`

## 性能优化

- 使用 `AnimatePresence` 管理动画生命周期
- 使用 `useCallback` 优化回调函数
- 自动清理定时器，避免内存泄漏
- 限制同时显示的通知数量（建议不超过 5 个）

## 最佳实践

1. **在应用根组件中放置 ToastContainer**：确保通知在所有内容之上显示
2. **使用简短明确的消息**：通知消息应该简洁明了，避免过长
3. **选择合适的通知类型**：
   - Success：操作成功完成
   - Error：操作失败或发生错误
   - Warning：需要用户注意的信息
4. **避免过度使用**：不要为每个小操作都显示通知
5. **提供上下文**：错误消息应该包含足够的信息帮助用户理解问题

## 相关需求

- **Requirement 12.1**: REST API 请求失败时显示错误提示
- **Requirement 12.2**: WebSocket 连接失败时显示错误提示
- **Requirement 12.4**: 操作成功时显示成功提示
- **Requirement 12.5**: 错误提示显示 3 秒后自动隐藏

## 示例

查看 `Toast.example.tsx` 文件获取更多使用示例。
