/**
 * Loading spinner component for the BeeGame frontend.
 *
 * This component provides visual feedback during loading states:
 * - Spinning animation
 * - Multiple size variants (small, medium, large)
 * - Optional text label
 * 
 * Features:
 * - Smooth rotation animation
 * - Accessible with ARIA attributes
 * - Customizable size and color
 * 
 * Requirements: 7.3
 */

import React from 'react';

/**
 * Loading size variants
 */
export type LoadingSize = 'small' | 'medium' | 'large';

/**
 * Loading props interface
 */
export interface LoadingProps {
  /** Size of the loading spinner */
  size?: LoadingSize;
  
  /** Optional text to display below spinner */
  text?: string;
  
	  /** Custom color class (default: text-emerald-300) */
  color?: string;
  
  /** Whether to show as fullscreen overlay */
  fullscreen?: boolean;
}

/**
 * Get size classes for loading spinner
 */
const getSizeClasses = (size: LoadingSize): { spinner: string; text: string } => {
  switch (size) {
    case 'small':
      return {
        spinner: 'w-4 h-4 border-2',
        text: 'type-footnote'
      };
    case 'medium':
      return {
        spinner: 'w-8 h-8 border-2',
        text: 'type-callout'
      };
    case 'large':
      return {
        spinner: 'w-12 h-12 border-3',
        text: 'type-body'
      };
  }
};

/**
 * Loading spinner component
 * 
 * Displays an animated spinner to indicate loading state.
 * Supports multiple sizes and optional text label.
 */
export const Loading: React.FC<LoadingProps> = ({
  size = 'medium',
  text,
	  color = 'text-emerald-300',
  fullscreen = false
}) => {
  const { spinner, text: textSize } = getSizeClasses(size);
  
  const spinnerElement = (
    <div className="flex flex-col items-center justify-center gap-3">
      {/* Spinning circle */}
      <div
        className={`
          ${spinner}
          animate-spin
          rounded-full
          border-solid
          border-current
          border-t-transparent
          ${color}
        `}
        role="status"
        aria-label="加载中"
      />
      
      {/* Optional text with fade-in animation */}
      {text && (
	        <p className={`${textSize} ${color}`}>
          {text}
        </p>
      )}
    </div>
  );
  
  // Fullscreen overlay mode
  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50"
      >
        {spinnerElement}
      </div>
    );
  }
  
  // Inline mode
  return spinnerElement;
};

/**
 * Loading overlay component
 * Wraps content with a loading overlay when loading
 */
export interface LoadingOverlayProps {
  /** Whether loading is active */
  isLoading: boolean;
  
  /** Content to display */
  children: React.ReactNode;
  
  /** Loading spinner size */
  size?: LoadingSize;
  
  /** Optional loading text */
  text?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  children,
  size = 'medium',
  text
}) => {
  return (
    <div className="relative">
      {children}
      
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
          <Loading size={size} text={text} />
        </div>
      )}
    </div>
  );
};

export default Loading;
