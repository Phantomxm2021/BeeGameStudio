# Loading Component

加载指示器组件，用于显示加载状态。

## 功能特性

- ✅ 旋转动画效果
- ✅ 支持三种尺寸（small、medium、large）
- ✅ 可选文字标签
- ✅ 自定义颜色
- ✅ 全屏遮罩模式
- ✅ 内容遮罩层模式
- ✅ 无障碍支持（ARIA 属性）

## 使用方法

### 基础用法

```tsx
import { Loading } from '@/components/Common';

// 默认中等尺寸
<Loading />
```

### 不同尺寸

```tsx
// 小尺寸
<Loading size="small" />

// 中等尺寸（默认）
<Loading size="medium" />

// 大尺寸
<Loading size="large" />
```

### 带文字标签

```tsx
<Loading text="加载中..." />
<Loading size="large" text="处理中，请稍候..." />
```

### 自定义颜色

```tsx
<Loading color="text-blue-500" />
<Loading color="text-green-500" text="加载成功" />
<Loading color="text-red-500" text="加载失败" />
```

### 全屏加载

```tsx
<Loading fullscreen text="加载中..." />
```

### 加载遮罩层

```tsx
import { LoadingOverlay } from '@/components/Common';

<LoadingOverlay isLoading={isLoading} text="加载数据中...">
  <div>
    {/* 你的内容 */}
  </div>
</LoadingOverlay>
```

## API

### Loading Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| size | `'small' \| 'medium' \| 'large'` | `'medium'` | 加载器尺寸 |
| text | `string` | - | 可选的文字标签 |
| color | `string` | `'text-blue-500'` | 自定义颜色类名 |
| fullscreen | `boolean` | `false` | 是否显示为全屏遮罩 |

### LoadingOverlay Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| isLoading | `boolean` | - | 是否显示加载状态 |
| children | `ReactNode` | - | 要包裹的内容 |
| size | `'small' \| 'medium' \| 'large'` | `'medium'` | 加载器尺寸 |
| text | `string` | - | 可选的文字标签 |

## 使用场景

### 1. 聊天消息加载

```tsx
const ChatWindow = () => {
  const { isLoading } = useChat();
  
  return (
    <div className="chat-window">
      {messages.map(msg => <Message key={msg.id} {...msg} />)}
      
      {isLoading && (
        <div className="flex items-center gap-2">
          <Loading size="small" />
          <span>AI 正在思考...</span>
        </div>
      )}
    </div>
  );
};
```

### 2. 数据加载遮罩

```tsx
const ProjectList = () => {
  const { projects, isLoading } = useProjects();
  
  return (
    <LoadingOverlay isLoading={isLoading} text="加载项目列表...">
      <div className="project-list">
        {projects.map(project => (
          <ProjectItem key={project.id} {...project} />
        ))}
      </div>
    </LoadingOverlay>
  );
};
```

### 3. 全屏加载

```tsx
const App = () => {
  const { isInitializing } = useApp();
  
  return (
    <>
      {isInitializing && (
        <Loading fullscreen size="large" text="初始化应用..." />
      )}
      
      <MainContent />
    </>
  );
};
```

### 4. 按钮加载状态

```tsx
const SubmitButton = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  return (
    <button
      disabled={isSubmitting}
      className="flex items-center gap-2"
    >
      {isSubmitting && <Loading size="small" color="text-white" />}
      {isSubmitting ? '提交中...' : '提交'}
    </button>
  );
};
```

## 样式定制

组件使用 Tailwind CSS 类名，可以通过 `color` 属性自定义颜色：

```tsx
// 使用 Tailwind 颜色类
<Loading color="text-purple-500" />
<Loading color="text-orange-600" />

// 使用自定义颜色（需要在 tailwind.config.js 中配置）
<Loading color="text-brand-primary" />
```

## 无障碍支持

- 使用 `role="status"` 标记加载状态
- 使用 `aria-label="加载中"` 提供屏幕阅读器支持
- 使用 `aria-live="polite"` 通知状态变化

## 动画实现

使用 Framer Motion 实现流畅的旋转动画：

```tsx
<motion.div
  animate={{ rotate: 360 }}
  transition={{
    duration: 1,
    repeat: Infinity,
    ease: 'linear'
  }}
/>
```

## 性能优化

- 使用 CSS transform 实现动画，性能优异
- 组件轻量，不影响页面性能
- 支持按需加载

## 相关组件

- `Toast` - 通知提示组件
- `ErrorBoundary` - 错误边界组件

## 需求映射

- **Requirements 7.3**: 创建 Loading 加载组件
  - ✅ 实现旋转动画
  - ✅ 支持不同尺寸

## 示例代码

查看 `Loading.example.tsx` 获取更多使用示例。
