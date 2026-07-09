/**
 * Skeleton Component
 * 
 * Provides loading skeleton screens for various UI elements.
 * Used to show placeholder content while data is loading.
 * 
 * Features:
 * - Multiple shape variants (rectangle, circle, text)
 * - Customizable size and dimensions
 * - Smooth shimmer animation
 * - Composable for complex layouts
 * 
 * Requirements: 2.1, 3.1, 11.1
 */

import React from 'react';
import { Skeleton as BaseSkeleton } from '../ui/skeleton';

/**
 * Skeleton variant types
 */
export type SkeletonVariant = 'text' | 'circular' | 'rectangular';

/**
 * Skeleton props interface
 */
export interface SkeletonProps {
  /** Variant of the skeleton */
  variant?: SkeletonVariant;
  
  /** Width of the skeleton (CSS value) */
  width?: string | number;
  
  /** Height of the skeleton (CSS value) */
  height?: string | number;
  
  /** Additional CSS classes */
  className?: string;
  
  /** Whether to animate the skeleton */
  animate?: boolean;
}

/**
 * Base Skeleton component
 * 
 * Displays an animated placeholder for loading content.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'rectangular',
  width,
  height,
  className = '',
  animate = true
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'text':
        return 'h-4 rounded';
      case 'circular':
        return 'rounded-full';
      case 'rectangular':
        return 'rounded-lg';
    }
  };

  const style: React.CSSProperties = {
    width: width || (variant === 'circular' ? height : '100%'),
    height: height || (variant === 'text' ? '1rem' : '100%'),
  };

  return (
    <BaseSkeleton
      className={`${getVariantClasses()} ${animate ? '' : 'animate-none'} ${className}`}
      style={style}
    />
  );
};

/**
 * Message List Skeleton
 * Skeleton for the message list component
 */
export const MessageListSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          {/* Avatar */}
          <Skeleton variant="circular" width={40} height={40} />
          
          {/* Message content */}
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="rectangular" height={60} />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Project List Skeleton
 * Skeleton for the project list component
 */
export const ProjectListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton variant="rectangular" height={48} />
        </div>
      ))}
    </div>
  );
};

/**
 * Agent List Skeleton
 * Skeleton for the agent status list component
 */
export const AgentListSkeleton: React.FC = () => {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3">
          {/* Agent avatar */}
          <Skeleton variant="circular" width={48} height={48} />
          
          {/* Agent info */}
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </div>
          
          {/* Status badge */}
          <Skeleton variant="rectangular" width={60} height={24} />
        </div>
      ))}
    </div>
  );
};

/**
 * System Status Skeleton
 * Skeleton for the system status component
 */
export const SystemStatusSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 p-4">
      <Skeleton variant="text" width="50%" height={20} />
      
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex justify-between items-center">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="30%" />
        </div>
      ))}
    </div>
  );
};

/**
 * Activity List Skeleton
 * Skeleton for the activity list component
 */
export const ActivityListSkeleton: React.FC = () => {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="space-y-2 p-3 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Skeleton variant="circular" width={24} height={24} />
            <Skeleton variant="text" width="60%" />
          </div>
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="30%" />
        </div>
      ))}
    </div>
  );
};

/**
 * Card Skeleton
 * Generic skeleton for card-based layouts
 */
export interface CardSkeletonProps {
  /** Number of cards to show */
  count?: number;
  
  /** Whether to show avatar */
  showAvatar?: boolean;
  
  /** Number of text lines */
  lines?: number;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({
  count = 3,
  showAvatar = false,
  lines = 3
}) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 border border-gray-200 rounded-lg space-y-3">
          {showAvatar && (
            <div className="flex items-center gap-3">
              <Skeleton variant="circular" width={40} height={40} />
              <Skeleton variant="text" width="40%" />
            </div>
          )}
          
          {Array.from({ length: lines }).map((_, j) => (
            <Skeleton 
              key={j} 
              variant="text" 
              width={j === lines - 1 ? '60%' : '100%'} 
            />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Table Skeleton
 * Skeleton for table layouts
 */
export interface TableSkeletonProps {
  /** Number of rows */
  rows?: number;
  
  /** Number of columns */
  columns?: number;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 5,
  columns = 4
}) => {
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex gap-4 p-3 bg-gray-50 rounded-lg">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} variant="text" width="100%" />
        ))}
      </div>
      
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-3">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} variant="text" width="100%" />
          ))}
        </div>
      ))}
    </div>
  );
};

export default Skeleton;
