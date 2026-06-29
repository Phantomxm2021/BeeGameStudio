/**
 * useChat Hook Usage Examples
 * 
 * This file demonstrates various ways to use the useChat hook
 * for managing chat functionality in the BeeGame frontend.
 */

import React, { useState } from 'react';
import { useChat } from './useChat';
import { useChatStore } from '../store/chatStore';

/**
 * Example 1: Basic Chat Component
 * 
 * Demonstrates the simplest usage of useChat hook with
 * message sending and display.
 */
export const BasicChatExample: React.FC<{ projectId: string }> = ({ projectId }) => {
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
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.sender}`}>
            <strong>{msg.sender}:</strong> {msg.content}
          </div>
        ))}
      </div>
      
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="输入消息..."
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? '发送中...' : '发送'}
        </button>
      </form>
    </div>
  );
};

/**
 * Example 2: Chat with Task Control
 * 
 * Demonstrates using task control features (stop and continue)
 * along with basic messaging.
 */
export const TaskControlChatExample: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [input, setInput] = useState('');
  const {
    sendMessage,
    continueTask,
    stopTask,
    isLoading,
    canContinue
  } = useChat({
    projectId,
    onError: (error) => {
      console.error('Chat error:', error);
      alert(`错误: ${error.message}`);
    },
    onTaskComplete: () => {
      console.log('Task completed!');
    }
  });
  const { messages } = useChatStore();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      await sendMessage(input);
      setInput('');
    }
  };
  
  return (
    <div className="chat-container">
      {/* Control buttons */}
      <div className="controls">
        {isLoading && (
          <button onClick={stopTask} className="btn-stop">
            ⏹️ 停止任务
          </button>
        )}
        
        {canContinue && (
          <button onClick={continueTask} className="btn-continue">
            ▶️ 继续任务
          </button>
        )}
      </div>
      
      {/* Messages */}
      <div className="messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.sender} ${msg.type || 'normal'}`}
          >
            <div className="message-header">
              <strong>{msg.sender}</strong>
              <span className="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
            
            {msg.canContinue && (
              <button onClick={continueTask} className="btn-continue-inline">
                继续执行
              </button>
            )}
          </div>
        ))}
      </div>
      
      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="输入消息..."
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? '处理中...' : '发送'}
        </button>
      </form>
    </div>
  );
};

/**
 * Example 3: Chat with Message Type Filtering
 * 
 * Demonstrates filtering messages by type and displaying
 * different message types with custom styling.
 */
export const FilteredChatExample: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<'all' | 'normal' | 'tool' | 'error'>('all');
  const { sendMessage, isLoading } = useChat({ projectId });
  const { messages } = useChatStore();
  
  const filteredMessages = messages.filter((msg) => {
    if (filter === 'all') return true;
    return msg.type === filter;
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      await sendMessage(input);
      setInput('');
    }
  };
  
  return (
    <div className="chat-container">
      {/* Filter buttons */}
      <div className="filters">
        <button
          onClick={() => setFilter('all')}
          className={filter === 'all' ? 'active' : ''}
        >
          全部 ({messages.length})
        </button>
        <button
          onClick={() => setFilter('normal')}
          className={filter === 'normal' ? 'active' : ''}
        >
          对话 ({messages.filter((m) => !m.type || m.type === 'normal').length})
        </button>
        <button
          onClick={() => setFilter('tool')}
          className={filter === 'tool' ? 'active' : ''}
        >
          工具 ({messages.filter((m) => m.type === 'tool').length})
        </button>
        <button
          onClick={() => setFilter('error')}
          className={filter === 'error' ? 'active' : ''}
        >
          错误 ({messages.filter((m) => m.type === 'error').length})
        </button>
      </div>
      
      {/* Messages */}
      <div className="messages">
        {filteredMessages.map((msg) => (
          <div key={msg.id} className={`message ${msg.sender} type-${msg.type || 'normal'}`}>
            <div className="message-header">
              <strong>{msg.sender}</strong>
              <span className="type-badge">{msg.type || 'normal'}</span>
              <span className="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
      </div>
      
      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="输入消息..."
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
};

/**
 * Example 4: Chat with Loading States
 * 
 * Demonstrates handling different loading states and
 * providing visual feedback to users.
 */
export const LoadingStatesChatExample: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [input, setInput] = useState('');
  const {
    sendMessage,
    continueTask,
    stopTask,
    isLoading,
    currentTaskId,
    canContinue
  } = useChat({ projectId });
  const { messages, currentSender } = useChatStore();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      await sendMessage(input);
      setInput('');
    }
  };
  
  return (
    <div className="chat-container">
      {/* Status bar */}
      <div className="status-bar">
        {isLoading && (
          <div className="status-loading">
            <span className="spinner">⏳</span>
            <span>处理中...</span>
            {currentSender && <span>当前发言: {currentSender}</span>}
            {currentTaskId && <span className="task-id">任务 ID: {currentTaskId}</span>}
          </div>
        )}
        
        {canContinue && (
          <div className="status-paused">
            <span>⏸️ 任务已暂停</span>
            <button onClick={continueTask}>继续</button>
          </div>
        )}
        
        {!isLoading && !canContinue && (
          <div className="status-idle">
            <span>✅ 就绪</span>
          </div>
        )}
      </div>
      
      {/* Messages */}
      <div className="messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.sender} ${
              currentSender === msg.sender ? 'active' : ''
            }`}
          >
            <strong>{msg.sender}:</strong> {msg.content}
          </div>
        ))}
        
        {isLoading && (
          <div className="message system typing">
            <span className="typing-indicator">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}
      </div>
      
      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder={isLoading ? '等待响应...' : '输入消息...'}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          发送
        </button>
        {isLoading && (
          <button type="button" onClick={stopTask}>
            停止
          </button>
        )}
      </form>
    </div>
  );
};

/**
 * Example 5: Advanced Chat with Error Handling
 * 
 * Demonstrates comprehensive error handling and recovery options.
 */
export const ErrorHandlingChatExample: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const {
    sendMessage,
    continueTask,
    stopTask,
    isLoading,
    canContinue
  } = useChat({
    projectId,
    onError: (err) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000); // Clear error after 5 seconds
    },
    onTaskComplete: () => {
      console.log('Task completed successfully!');
    }
  });
  const { messages } = useChatStore();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      setError(null);
      await sendMessage(input);
      setInput('');
    }
  };
  
  const handleRetry = async () => {
    if (canContinue) {
      setError(null);
      await continueTask();
    }
  };
  
  return (
    <div className="chat-container">
      {/* Error banner */}
      {error && (
        <div className="error-banner">
          <span>❌ {error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      
      {/* Messages */}
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.sender} type-${msg.type || 'normal'}`}>
            <div className="message-header">
              <strong>{msg.sender}</strong>
              <span className="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
            
            {msg.type === 'error' && msg.errorDetails && (
              <details className="error-details">
                <summary>查看详情</summary>
                <pre>{msg.errorDetails}</pre>
              </details>
            )}
            
            {msg.canContinue && (
              <div className="error-actions">
                <button onClick={handleRetry} className="btn-retry">
                  重试
                </button>
                <button onClick={stopTask} className="btn-cancel">
                  取消
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="输入消息..."
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? '发送中...' : '发送'}
        </button>
      </form>
    </div>
  );
};
