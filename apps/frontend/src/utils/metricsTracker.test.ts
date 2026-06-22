import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsTracker } from './metricsTracker';

describe('MetricsTracker', () => {
  let tracker: MetricsTracker;

  beforeEach(() => {
    tracker = new MetricsTracker();
  });

  describe('incrementRenderSuccess', () => {
    it('should increment success count', () => {
      tracker.incrementRenderSuccess();
      const metrics = tracker.getMetrics();
      expect(metrics.successCount).toBe(1);
    });

    it('should increment success count multiple times', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      const metrics = tracker.getMetrics();
      expect(metrics.successCount).toBe(3);
    });
  });

  describe('incrementRenderFailures', () => {
    it('should increment failure count', () => {
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.failureCount).toBe(1);
    });

    it('should increment failure count multiple times', () => {
      tracker.incrementRenderFailures();
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.failureCount).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('should return zero metrics initially', () => {
      const metrics = tracker.getMetrics();
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.totalCount).toBe(0);
      expect(metrics.successRate).toBe(0);
    });

    it('should calculate total count correctly', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.totalCount).toBe(3);
    });

    it('should calculate success rate correctly with all successes', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      const metrics = tracker.getMetrics();
      expect(metrics.successRate).toBe(100);
    });

    it('should calculate success rate correctly with all failures', () => {
      tracker.incrementRenderFailures();
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.successRate).toBe(0);
    });

    it('should calculate success rate correctly with mixed results', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.successRate).toBe(75);
    });

    it('should round success rate to 2 decimal places', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderFailures();
      tracker.incrementRenderFailures();
      const metrics = tracker.getMetrics();
      expect(metrics.successRate).toBe(33.33);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all counters to zero', () => {
      tracker.incrementRenderSuccess();
      tracker.incrementRenderSuccess();
      tracker.incrementRenderFailures();
      
      tracker.resetMetrics();
      
      const metrics = tracker.getMetrics();
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.totalCount).toBe(0);
      expect(metrics.successRate).toBe(0);
    });

    it('should allow tracking after reset', () => {
      tracker.incrementRenderSuccess();
      tracker.resetMetrics();
      tracker.incrementRenderSuccess();
      
      const metrics = tracker.getMetrics();
      expect(metrics.successCount).toBe(1);
    });
  });
});
