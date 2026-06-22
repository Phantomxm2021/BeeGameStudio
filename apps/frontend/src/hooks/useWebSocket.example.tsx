/**
 * Example usage of useWebSocket hook
 * 
 * This file demonstrates how to use the useWebSocket hook in a React component.
 * It can be used for manual testing and as a reference for integration.
 */

import React from 'react';
import { useWebSocket } from './useWebSocket';
import { useChatStore } from '../store/chatStore';
import type { WebSocketMessage } from '../types/message';

/**
 * Example component demonstrating useWebSocket hook usage
 */
export const WebSocketExample: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { addMessage, updateMessage, setCurrentSender } = useChatStore();
  
  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = (message: WebSocketMessage) => {
    console.log('[WebSocket] Received message:', message);
    
    switch (message.type) {
      case 'token':
        // Stream token: accumulate content
        if (message.sender && message.content) {
          updateMessage(message.task_id, message.content, message.sender);
          setCurrentSender(message.sender);
        }
        break;
        
      case 'status':
        // Status update
        if (message.content === 'finished') {
          setCurrentSender(null);
          console.log('[WebSocket] Task finished');
        }
        break;
        
      case 'tool_start':
        // Tool invocation started
        addMessage({
          id: `tool-start-${Date.now()}`,
          sender: 'system',
          content: `🔧 Tool started: ${message.tool}`,
          timestamp: Date.now(),
          type: 'tool'
        });
        break;
        
      case 'tool_end':
        // Tool invocation completed
        addMessage({
          id: `tool-end-${Date.now()}`,
          sender: 'system',
          content: `✅ Tool completed: ${message.tool}`,
          timestamp: Date.now(),
          type: 'tool'
        });
        break;
        
      case 'usage':
        // Token usage update
        console.log('[WebSocket] Token usage:', message.usage);
        break;
        
      case 'error_paused':
        // Error occurred, task paused
        addMessage({
          id: `error-${Date.now()}`,
          sender: 'system',
          content: message.content || 'An error occurred',
          timestamp: Date.now(),
          type: 'error',
          canContinue: true,
          errorDetails: message.error
        });
        break;
        
      default:
        console.warn('[WebSocket] Unknown message type:', message);
    }
  };
  
  /**
   * Initialize WebSocket connection
   */
  const { ws, state, reconnectAttempts, reconnect, disconnect } = useWebSocket({
    projectId,
    onMessage: handleMessage,
    onOpen: () => {
      console.log('[WebSocket] Connection opened');
    },
    onClose: () => {
      console.log('[WebSocket] Connection closed');
    },
    onError: (error) => {
      console.error('[WebSocket] Error:', error);
    }
  });
  
  /**
   * Get status color based on connection state
   */
  const getStatusColor = () => {
    switch (state) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'disconnected':
        return 'bg-orange-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };
  
  /**
   * Get status text based on connection state
   */
  const getStatusText = () => {
    switch (state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'failed':
        return 'Connection Failed';
      default:
        return 'Unknown';
    }
  };
  
  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm">
      <h3 className="text-lg font-semibold mb-4">WebSocket Connection Status</h3>
      
      {/* Connection Status */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
        <span className="font-medium">{getStatusText()}</span>
        {reconnectAttempts > 0 && (
          <span className="text-sm text-gray-500">
            (Reconnect attempts: {reconnectAttempts})
          </span>
        )}
      </div>
      
      {/* Connection Info */}
      <div className="space-y-2 mb-4 text-sm">
        <div>
          <span className="font-medium">Project ID:</span> {projectId}
        </div>
        <div>
          <span className="font-medium">WebSocket Ready:</span>{' '}
          {ws?.readyState === WebSocket.OPEN ? 'Yes' : 'No'}
        </div>
      </div>
      
      {/* Control Buttons */}
      <div className="flex gap-2">
        <button
          onClick={reconnect}
          disabled={state === 'connected'}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Reconnect
        </button>
        <button
          onClick={disconnect}
          disabled={state === 'disconnected' || state === 'failed'}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Disconnect
        </button>
      </div>
      
      {/* Error Message */}
      {state === 'failed' && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to connect after {reconnectAttempts} attempts. Please check your network connection
          and try again.
        </div>
      )}
    </div>
  );
};
