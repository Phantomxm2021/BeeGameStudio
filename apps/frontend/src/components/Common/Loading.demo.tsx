/**
 * Loading Component Demo
 * 
 * Interactive demonstration of the Loading component
 * Run this file to see the component in action
 */

import React, { useState } from 'react';
import { Loading, LoadingOverlay } from './Loading';

const LoadingDemo: React.FC = () => {
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  const simulateLoading = (setter: (value: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Loading Component Demo
          </h1>
          <p className="text-gray-600">
            加载指示器组件演示 - 支持多种尺寸和样式
          </p>
        </div>

        {/* Size Variants */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">尺寸变体</h2>
          <div className="flex items-center justify-around">
            <div className="text-center space-y-4">
              <Loading size="small" />
              <p className="text-sm font-medium text-gray-600">Small</p>
              <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                size="small"
              </code>
            </div>
            <div className="text-center space-y-4">
              <Loading size="medium" />
              <p className="text-sm font-medium text-gray-600">Medium</p>
              <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                size="medium"
              </code>
            </div>
            <div className="text-center space-y-4">
              <Loading size="large" />
              <p className="text-sm font-medium text-gray-600">Large</p>
              <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                size="large"
              </code>
            </div>
          </div>
        </section>

        {/* With Text */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">带文字标签</h2>
          <div className="flex items-center justify-around">
            <Loading size="small" text="加载中..." />
            <Loading size="medium" text="处理中..." />
            <Loading size="large" text="请稍候..." />
          </div>
        </section>

        {/* Color Variants */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">颜色变体</h2>
          <div className="flex items-center justify-around flex-wrap gap-8">
            <Loading color="text-blue-500" text="蓝色" />
            <Loading color="text-green-500" text="绿色" />
            <Loading color="text-red-500" text="红色" />
            <Loading color="text-purple-500" text="紫色" />
            <Loading color="text-orange-500" text="橙色" />
            <Loading color="text-pink-500" text="粉色" />
          </div>
        </section>

        {/* Fullscreen Loading */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">全屏加载</h2>
          <p className="text-gray-600 mb-4">
            点击按钮显示全屏加载遮罩层
          </p>
          <button
            onClick={() => simulateLoading(setShowFullscreen)}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            显示全屏加载
          </button>
          
          {showFullscreen && (
            <Loading fullscreen size="large" text="加载中，请稍候..." />
          )}
        </section>

        {/* Loading Overlay */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">加载遮罩层</h2>
          <p className="text-gray-600 mb-4">
            在内容上方显示加载遮罩
          </p>
          <button
            onClick={() => simulateLoading(setOverlayLoading)}
            disabled={overlayLoading}
            className="mb-4 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium disabled:opacity-50"
          >
            开始加载
          </button>
          
          <LoadingOverlay isLoading={overlayLoading} text="加载数据中...">
            <div className="p-8 bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                内容区域
              </h3>
              <p className="text-gray-700 mb-4">
                这是一些示例内容。点击上面的按钮会在此区域显示加载遮罩层。
              </p>
              <div className="space-y-3">
                <div className="h-4 bg-white/60 rounded-full w-3/4"></div>
                <div className="h-4 bg-white/60 rounded-full w-1/2"></div>
                <div className="h-4 bg-white/60 rounded-full w-5/6"></div>
                <div className="h-4 bg-white/60 rounded-full w-2/3"></div>
              </div>
            </div>
          </LoadingOverlay>
        </section>

        {/* Chat Example */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">聊天窗口示例</h2>
          <p className="text-gray-600 mb-4">
            在聊天界面中使用加载指示器
          </p>
          
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-xl overflow-hidden border border-gray-200">
            {/* Chat Header */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <span className="text-lg font-bold">AI</span>
                </div>
                <div>
                  <h3 className="font-semibold">AI 助手</h3>
                  <p className="text-xs text-blue-100">在线</p>
                </div>
              </div>
            </div>
            
            {/* Chat Messages */}
            <div className="h-80 p-6 overflow-y-auto bg-gray-50">
              <div className="space-y-4">
                {/* AI Message */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    AI
                  </div>
                  <div className="bg-white rounded-lg rounded-tl-none p-4 shadow-sm max-w-xs">
                    <p className="text-sm text-gray-800">
                      你好！我是 AI 助手。有什么可以帮助你的吗？
                    </p>
                    <p className="text-xs text-gray-500 mt-2">刚刚</p>
                  </div>
                </div>
                
                {/* User Message */}
                <div className="flex items-start gap-3 justify-end">
                  <div className="bg-blue-500 text-white rounded-lg rounded-tr-none p-4 shadow-sm max-w-xs">
                    <p className="text-sm">
                      请帮我分析一下这个项目的架构
                    </p>
                    <p className="text-xs text-blue-100 mt-2">刚刚</p>
                  </div>
                  <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    U
                  </div>
                </div>
                
                {/* Loading Indicator */}
                {chatLoading && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      AI
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loading size="small" />
                      <span className="text-sm">AI 正在思考...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Chat Input */}
            <div className="border-t border-gray-200 p-4 bg-white">
              <button
                onClick={() => simulateLoading(setChatLoading)}
                disabled={chatLoading}
                className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {chatLoading && <Loading size="small" color="text-white" />}
                {chatLoading ? '发送中...' : '发送消息'}
              </button>
            </div>
          </div>
        </section>

        {/* Code Examples */}
        <section className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">代码示例</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">基础用法</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{`<Loading />`}</code>
              </pre>
            </div>
            
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">带文字和尺寸</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{`<Loading size="large" text="加载中..." />`}</code>
              </pre>
            </div>
            
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">全屏模式</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{`<Loading fullscreen size="large" text="加载中..." />`}</code>
              </pre>
            </div>
            
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">遮罩层模式</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{`<LoadingOverlay isLoading={isLoading} text="加载数据中...">
  <YourContent />
</LoadingOverlay>`}</code>
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoadingDemo;
