/**
 * Loading component usage examples
 * 
 * This file demonstrates various use cases of the Loading component
 */

import React, { useState } from 'react';
import { Loading, LoadingOverlay } from './Loading';

/**
 * Example 1: Basic loading spinner
 */
export const BasicLoadingExample: React.FC = () => {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">基础加载器</h3>
        <Loading />
      </div>
    </div>
  );
};

/**
 * Example 2: Different sizes
 */
export const SizeVariantsExample: React.FC = () => {
  return (
    <div className="p-8 space-y-8">
      <h3 className="text-lg font-semibold mb-4">不同尺寸</h3>
      
      <div className="flex items-center gap-8">
        <div className="text-center">
          <Loading size="small" />
          <p className="mt-2 text-sm text-gray-600">Small</p>
        </div>
        
        <div className="text-center">
          <Loading size="medium" />
          <p className="mt-2 text-sm text-gray-600">Medium</p>
        </div>
        
        <div className="text-center">
          <Loading size="large" />
          <p className="mt-2 text-sm text-gray-600">Large</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Example 3: With text label
 */
export const WithTextExample: React.FC = () => {
  return (
    <div className="p-8 space-y-8">
      <h3 className="text-lg font-semibold mb-4">带文字标签</h3>
      
      <div className="flex items-center gap-8">
        <Loading size="small" text="加载中..." />
        <Loading size="medium" text="处理中..." />
        <Loading size="large" text="请稍候..." />
      </div>
    </div>
  );
};

/**
 * Example 4: Custom colors
 */
export const CustomColorsExample: React.FC = () => {
  return (
    <div className="p-8 space-y-8">
      <h3 className="text-lg font-semibold mb-4">自定义颜色</h3>
      
      <div className="flex items-center gap-8">
        <Loading color="text-blue-500" text="蓝色" />
        <Loading color="text-green-500" text="绿色" />
        <Loading color="text-red-500" text="红色" />
        <Loading color="text-purple-500" text="紫色" />
      </div>
    </div>
  );
};

/**
 * Example 5: Fullscreen loading
 */
export const FullscreenExample: React.FC = () => {
  const [showFullscreen, setShowFullscreen] = useState(false);
  
  return (
    <div className="p-8">
      <h3 className="text-lg font-semibold mb-4">全屏加载</h3>
      
      <button
        onClick={() => setShowFullscreen(true)}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
      >
        显示全屏加载
      </button>
      
      {showFullscreen && (
        <>
          <Loading fullscreen text="加载中..." />
          <button
            onClick={() => setShowFullscreen(false)}
            className="fixed top-4 left-4 z-[60] px-4 py-2 bg-white text-gray-800 rounded-lg shadow-lg"
          >
            关闭
          </button>
        </>
      )}
    </div>
  );
};

/**
 * Example 6: Loading overlay
 */
export const LoadingOverlayExample: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  
  const handleLoad = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 2000);
  };
  
  return (
    <div className="p-8">
      <h3 className="text-lg font-semibold mb-4">加载遮罩层</h3>
      
      <button
        onClick={handleLoad}
        disabled={isLoading}
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        开始加载
      </button>
      
      <LoadingOverlay isLoading={isLoading} text="加载数据中...">
        <div className="p-8 bg-gray-100 rounded-lg">
          <h4 className="text-lg font-semibold mb-2">内容区域</h4>
          <p className="text-gray-600">
            这是一些内容。点击上面的按钮会显示加载遮罩层。
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-4 bg-gray-300 rounded w-3/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
            <div className="h-4 bg-gray-300 rounded w-5/6"></div>
          </div>
        </div>
      </LoadingOverlay>
    </div>
  );
};

/**
 * Example 7: In chat window
 */
export const ChatLoadingExample: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  
  return (
    <div className="p-8">
      <h3 className="text-lg font-semibold mb-4">聊天窗口中的加载</h3>
      
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Chat header */}
        <div className="bg-blue-500 text-white px-4 py-3">
          <h4 className="font-semibold">AI 助手</h4>
        </div>
        
        {/* Chat messages */}
        <div className="h-64 p-4 overflow-y-auto bg-gray-50">
          <div className="mb-4">
            <div className="bg-white rounded-lg p-3 shadow-sm max-w-xs">
              <p className="text-sm">你好！有什么可以帮助你的吗？</p>
            </div>
          </div>
          
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loading size="small" />
              <span className="text-sm">AI 正在思考...</span>
            </div>
          )}
        </div>
        
        {/* Chat input */}
        <div className="border-t p-4">
          <button
            onClick={() => {
              setIsLoading(true);
              setTimeout(() => setIsLoading(false), 3000);
            }}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? '发送中...' : '发送消息'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * All examples combined
 */
export const AllLoadingExamples: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center mb-8">Loading 组件示例</h1>
        
        <div className="bg-white rounded-lg shadow-lg">
          <BasicLoadingExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <SizeVariantsExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <WithTextExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <CustomColorsExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <FullscreenExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <LoadingOverlayExample />
        </div>
        
        <div className="bg-white rounded-lg shadow-lg">
          <ChatLoadingExample />
        </div>
      </div>
    </div>
  );
};

export default AllLoadingExamples;
