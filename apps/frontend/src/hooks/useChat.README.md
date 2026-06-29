# useChat Hook

## Overview

The `useChat` hook manages chat functionality for the BeeGame frontend. It integrates WebSocket communication, message routing, and chat operations into a single interface.

## Features

- **WebSocket Message Routing**: Automatically routes incoming WebSocket messages to appropriate handlers
- **Message Type Handling**: Supports all message types (token, status, tool_start, tool_end, usage, error_paused)
- **Chat Operations**: Provides methods for sending messages, continuing paused tasks, and stopping tasks
- **Loading State Management**: Tracks task execution state and provides loading indicators
- **Error Handling**: Comprehensive error handling with callbacks for custom error handling
- **Task Control**: Full control over task lifecycle (start, stop, continue)

## Requirements

This hook implements the following requirements:
- **1.1**: Send messages to backend via REST API
- **1.2**: Receive real-time responses via WebSocket
- **1.3**: Display streaming responses (token accumulation)
- **6.1**: Stop task functionality
- **6.2**: Task status tracking
- **6.3**: Error pause handling
- **6.4**: Continue task functionality
- **6.5**: Task state management
- **7.1**: Tool invocation start visualization
- **7.2**: Tool invocation end visualization

## Installation

The hook is already part of the project. Simply import it:

```typescript
import { useChat } from './hooks/useChat';
```

## Basic Usage

```typescript
import React, { useState } from 'react';
import { useChat } from './hooks/useChat';
import { useChatStore } from './store/chatStore';

const ChatComponent: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [input, setInput] = useState('');
  const { sendMessage, isLoading } = useChat({ projectId });
  const { messages } = useChatStore();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      await sendMessage(input);
      setInput('');
    }
  };
  
  return (
    <div>
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.sender}:</strong> {msg.content}
          </div>
        ))}
      </div>
      
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};
```

## API Reference

### `useChat(options: UseChatOptions): UseChatReturn`

#### Options

```typescript
interface UseChatOptions {
  /** Project ID for the chat session (required) */
  projectId: string;
  
  /** Callback when an error occurs (optional) */
  onError?: (error: Error) => void;
  
  /** Callback when a task completes (optional) */
  onTaskComplete?: () => void;
}
```

#### Return Value

```typescript
interface UseChatReturn {
  /** Send a message to the backend */
  sendMessage: (content: string) => Promise<void>;
  
  /** Continue a paused task */
  continueTask: () => Promise<void>;
  
  /** Stop the current task */
  stopTask: () => Promise<void>;
  
  /** Whether a task is currently being processed */
  isLoading: boolean;
  
  /** Current task ID (if any) */
  currentTaskId: string | null;
  
  /** Whether the task is paused and can be continued */
  canContinue: boolean;
}
```

## Advanced Usage

### Task Control

```typescript
const {
  sendMessage,
  continueTask,
  stopTask,
  isLoading,
  canContinue
} = useChat({
  projectId: 'project-123',
  onError: (error) => {
    console.error('Chat error:', error);
    alert(`Error: ${error.message}`);
  },
  onTaskComplete: () => {
    console.log('Task completed!');
  }
});

// Send a message
await sendMessage('Hello, AI team!');

// Stop the current task
if (isLoading) {
  await stopTask();
}

// Continue after error_paused
if (canContinue) {
  await continueTask();
}
```

### Error Handling

```typescript
const [error, setError] = useState<string | null>(null);

const { sendMessage } = useChat({
  projectId: 'project-123',
  onError: (err) => {
    setError(err.message);
    // Clear error after 5 seconds
    setTimeout(() => setError(null), 5000);
  }
});

// Display error banner
{error && (
  <div className="error-banner">
    <span>❌ {error}</span>
    <button onClick={() => setError(null)}>Close</button>
  </div>
)}
```

### Message Type Handling

The hook automatically handles different message types:

#### Token Messages (Streaming)
```typescript
// Automatically accumulates tokens into a single message
// Requirements: 1.3
{
  type: 'token',
  content: 'Hello',
  task_id: 'task-123',
  sender: 'logos'
}
```

#### Status Messages
```typescript
// Updates loading state based on status
// Requirements: 6.2
{
  type: 'status',
  content: 'finished', // or 'processing'
  task_id: 'task-123'
}
```

#### Tool Messages
```typescript
// Displays tool invocation notifications
// Requirements: 7.1, 7.2
{
  type: 'tool_start',
  tool: 'code_generator',
  task_id: 'task-123'
}

{
  type: 'tool_end',
  tool: 'code_generator',
  output: 'Generated code...',
  task_id: 'task-123'
}
```

#### Usage Messages
```typescript
// Updates token usage statistics
// Requirements: 4.3
{
  type: 'usage',
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150
  },
  task_id: 'task-123'
}
```

#### Error Paused Messages
```typescript
// Enables continue button
// Requirements: 6.3
{
  type: 'error_paused',
  content: 'An error occurred',
  error: 'Detailed error message',
  task_id: 'task-123'
}
```

## Integration with Stores

The hook integrates with two Zustand stores:

### Chat Store (`useChatStore`)
- `addMessage`: Add complete messages
- `updateMessage`: Accumulate streaming tokens
- `setCurrentSender`: Track active agent

### System Store (`useSystemStore`)
- `updateTokenUsage`: Accumulate token usage statistics

## WebSocket Connection

The hook uses the `useWebSocket` hook internally to manage the WebSocket connection. The connection is automatically established when the hook is mounted and cleaned up when unmounted or when the project changes.

### Connection States
- `connecting`: Initial connection attempt
- `connected`: Successfully connected
- `disconnected`: Disconnected (may retry)
- `failed`: Failed after max retries

### Auto-Reconnection
The WebSocket connection automatically attempts to reconnect up to 3 times if the connection is lost.

## Message Flow

1. **User sends message**:
   - User input → `sendMessage()` → REST API → Backend
   - User message added to chat store
   - `isLoading` set to `true`
   - `currentTaskId` set to task ID from response

2. **Backend processes and streams response**:
   - Backend → WebSocket → `handleWebSocketMessage()`
   - Token messages accumulated in chat store
   - Current sender tracked for highlighting
   - Tool invocations displayed as system messages
   - Token usage updated in system store

3. **Task completes**:
   - Status message with 'finished' → `isLoading` set to `false`
   - `currentTaskId` cleared
   - `onTaskComplete` callback invoked

4. **Error occurs**:
   - Error paused message → `canContinue` set to `true`
   - Error message added to chat
   - User can choose to continue or stop

## Best Practices

1. **Always check loading state**: Disable input and buttons when `isLoading` is true
2. **Handle errors gracefully**: Provide `onError` callback to display user-friendly error messages
3. **Validate input**: Check that message content is not empty before calling `sendMessage`
4. **Show task controls**: Display stop button when `isLoading`, continue button when `canContinue`
5. **Provide feedback**: Use `onTaskComplete` to notify users when tasks finish
6. **Clean up**: The hook automatically cleans up WebSocket connections, but ensure components unmount properly

## Examples

See `useChat.example.tsx` for comprehensive examples including:
- Basic chat component
- Task control (stop/continue)
- Message type filtering
- Loading states
- Error handling

## Troubleshooting

### Messages not appearing
- Check that `useChatStore` is properly imported and used
- Verify WebSocket connection is established (check browser console)
- Ensure backend is running and accessible

### WebSocket connection fails
- Check that backend WebSocket server is running on the correct port
- Verify `projectId` is valid
- Check browser console for connection errors
- Ensure no firewall or proxy is blocking WebSocket connections

### Loading state stuck
- Check for errors in browser console
- Verify backend is sending status messages
- Ensure task completes or errors properly on backend

### Token accumulation not working
- Verify `task_id` in token messages matches the current task
- Check that `updateMessage` is being called correctly
- Ensure messages have unique IDs

## Related Documentation

- [useWebSocket Hook](./useWebSocket.README.md)
- [Chat Store](../store/chatStore.ts)
- [System Store](../store/systemStore.ts)
- [API Service](../services/api.ts)
- [Message Types](../types/message.ts)
