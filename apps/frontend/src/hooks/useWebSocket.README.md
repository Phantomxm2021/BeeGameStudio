# useWebSocket Hook

A React hook for managing WebSocket connections with automatic reconnection and state management.

## Features

- ✅ Automatic connection establishment
- ✅ Message receiving and parsing
- ✅ Auto-reconnect logic (max 3 attempts with exponential backoff)
- ✅ Connection state management
- ✅ Proper cleanup on unmount
- ✅ Manual reconnect and disconnect controls
- ✅ TypeScript support with full type safety

## Requirements

Validates requirements: **1.2, 9.1, 9.2, 9.3, 9.5**

## Installation

The hook is already included in the project. No additional installation needed.

## Basic Usage

```typescript
import { useWebSocket } from './hooks/useWebSocket';

function ChatComponent({ projectId }: { projectId: string }) {
  const { ws, state, reconnect } = useWebSocket({
    projectId,
    onMessage: (message) => {
      console.log('Received:', message);
    }
  });

  return (
    <div>
      <p>Status: {state}</p>
      {state === 'failed' && (
        <button onClick={reconnect}>Retry Connection</button>
      )}
    </div>
  );
}
```

## API Reference

### Parameters

The hook accepts a single options object with the following properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `projectId` | `string` | ✅ Yes | - | Project ID for the WebSocket connection |
| `onMessage` | `(message: WebSocketMessage) => void` | ✅ Yes | - | Callback when a message is received |
| `onError` | `(error: Event) => void` | ❌ No | - | Callback when an error occurs |
| `onClose` | `() => void` | ❌ No | - | Callback when connection closes |
| `onOpen` | `() => void` | ❌ No | - | Callback when connection opens |
| `baseUrl` | `string` | ❌ No | `'ws://localhost:8000'` | Base WebSocket URL |
| `maxReconnectAttempts` | `number` | ❌ No | `3` | Maximum reconnection attempts |
| `reconnectDelay` | `number` | ❌ No | `2000` | Base reconnection delay in ms |

### Return Value

The hook returns an object with the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `ws` | `WebSocket \| null` | Current WebSocket instance (may be null) |
| `state` | `WebSocketState` | Current connection state |
| `reconnectAttempts` | `number` | Number of reconnection attempts made |
| `reconnect` | `() => void` | Manually trigger reconnection |
| `disconnect` | `() => void` | Manually close the connection |

### Connection States

The `state` property can have one of the following values:

- `'connecting'` - Initial connection attempt
- `'connected'` - Successfully connected
- `'disconnected'` - Disconnected (may retry)
- `'failed'` - Failed after max retries

## Advanced Usage

### With Chat Store Integration

```typescript
import { useWebSocket } from './hooks/useWebSocket';
import { useChatStore } from './store/chatStore';

function ChatWindow({ projectId }: { projectId: string }) {
  const { addMessage, updateMessage, setCurrentSender } = useChatStore();

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'token':
        updateMessage(message.task_id, message.content!, message.sender!);
        setCurrentSender(message.sender!);
        break;
      
      case 'status':
        if (message.content === 'finished') {
          setCurrentSender(null);
        }
        break;
      
      case 'tool_start':
        addMessage({
          id: `tool-${Date.now()}`,
          sender: 'system',
          content: `🔧 Tool: ${message.tool}`,
          timestamp: Date.now(),
          type: 'tool'
        });
        break;
      
      // ... handle other message types
    }
  };

  const { state, reconnect } = useWebSocket({
    projectId,
    onMessage: handleMessage,
    onError: (error) => {
      console.error('WebSocket error:', error);
    }
  });

  return (
    <div>
      {/* Your chat UI */}
    </div>
  );
}
```

### Custom Reconnection Settings

```typescript
const { ws, state } = useWebSocket({
  projectId: 'my-project',
  onMessage: handleMessage,
  maxReconnectAttempts: 5,      // Try 5 times instead of 3
  reconnectDelay: 1000,          // Start with 1 second delay
  baseUrl: 'wss://api.example.com' // Use secure WebSocket
});
```

### Manual Connection Control

```typescript
function ConnectionManager({ projectId }: { projectId: string }) {
  const { state, reconnect, disconnect } = useWebSocket({
    projectId,
    onMessage: handleMessage
  });

  return (
    <div>
      <p>Status: {state}</p>
      <button onClick={reconnect}>Reconnect</button>
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}
```

## Reconnection Behavior

The hook implements automatic reconnection with exponential backoff:

1. **First attempt**: Reconnects after 2 seconds (1 × reconnectDelay)
2. **Second attempt**: Reconnects after 4 seconds (2 × reconnectDelay)
3. **Third attempt**: Reconnects after 6 seconds (3 × reconnectDelay)
4. **After 3 failures**: Sets state to `'failed'` and stops trying

You can manually trigger reconnection at any time using the `reconnect()` function, which resets the attempt counter.

## Cleanup

The hook automatically handles cleanup:

- Closes WebSocket connection when component unmounts
- Closes connection when `projectId` changes
- Clears reconnection timers
- Prevents reconnection after manual disconnect

## Message Types

The hook expects messages in the following format:

```typescript
interface WebSocketMessage {
  type: 'token' | 'status' | 'tool_start' | 'tool_end' | 'usage' | 'error_paused';
  content?: string;
  task_id: string;
  sender?: string;
  tool?: string;
  output?: string;
  usage?: TokenUsage;
  error?: string;
}
```

## Error Handling

The hook handles errors gracefully:

- **Parse errors**: Logged to console, message is skipped
- **Connection errors**: Triggers `onError` callback and attempts reconnection
- **Max retries exceeded**: Sets state to `'failed'` and stops reconnecting

## Best Practices

1. **Always provide error handling**:
   ```typescript
   useWebSocket({
     projectId,
     onMessage: handleMessage,
     onError: (error) => {
       // Show user-friendly error message
       showToast({ type: 'error', message: 'Connection lost' });
     }
   });
   ```

2. **Handle all message types**:
   ```typescript
   const handleMessage = (message: WebSocketMessage) => {
     switch (message.type) {
       case 'token':
       case 'status':
       case 'tool_start':
       case 'tool_end':
       case 'usage':
       case 'error_paused':
         // Handle each type appropriately
         break;
       default:
         console.warn('Unknown message type:', message);
     }
   };
   ```

3. **Show connection status to users**:
   ```typescript
   {state === 'connecting' && <Spinner />}
   {state === 'failed' && <ErrorMessage onRetry={reconnect} />}
   ```

4. **Clean up on project switch**:
   The hook automatically handles this when `projectId` changes, but ensure you clear related state:
   ```typescript
   useEffect(() => {
     // Clear messages when project changes
     clearMessages();
   }, [projectId]);
   ```

## Testing

See `useWebSocket.example.tsx` for a complete example component that demonstrates all features of the hook.

## Related Files

- `types/message.ts` - WebSocket message type definitions
- `store/chatStore.ts` - Chat state management
- `hooks/useWebSocket.example.tsx` - Example usage component

## License

Part of the XRMOD Demiurge multi-agent system frontend.
