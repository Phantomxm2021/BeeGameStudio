/**
 * MetricsTracker - Tracks rendering success and failure metrics
 * 
 * This utility provides a simple interface for tracking markdown rendering
 * success and failure rates to help diagnose rendering issues.
 * 
 * The metrics tracker maintains counters for successful and failed renders,
 * calculates success rates, and provides methods to retrieve and reset metrics.
 * This is essential for monitoring the health of the markdown rendering system
 * and identifying when rendering issues become widespread.
 * 
 * Usage:
 * ```typescript
 * // Track successful render
 * metricsTracker.incrementRenderSuccess();
 * 
 * // Track failed render
 * metricsTracker.incrementRenderFailures();
 * 
 * // Get current metrics
 * const metrics = metricsTracker.getMetrics();
 * console.log(`Success rate: ${metrics.successRate}%`);
 * 
 * // Reset metrics
 * metricsTracker.resetMetrics();
 * ```
 * 
 * Requirements: 7.4 - Track and report metrics on rendering success/failure rates
 */

/**
 * Rendering metrics data structure
 */
interface RenderingMetrics {
  /** Total number of successful renders */
  successCount: number;
  /** Total number of failed renders */
  failureCount: number;
  /** Total number of render attempts (success + failure) */
  totalCount: number;
  /** Success rate as a percentage (0-100) */
  successRate: number;
}

/**
 * MetricsTracker class
 * 
 * Singleton class that tracks markdown rendering metrics across the application.
 * Provides methods to increment counters, retrieve metrics, and reset counters.
 */
class MetricsTracker {
  /** Counter for successful renders */
  private renderSuccessCount: number = 0;
  /** Counter for failed renders */
  private renderFailureCount: number = 0;

  /**
   * Increment the successful render counter
   * Call this method whenever a markdown component renders successfully
   */
  incrementRenderSuccess(): void {
    this.renderSuccessCount++;
  }

  /**
   * Increment the failed render counter
   * Call this method whenever a markdown component fails to render
   */
  incrementRenderFailures(): void {
    this.renderFailureCount++;
  }

  /**
   * Get current rendering metrics
   * 
   * Calculates and returns comprehensive metrics including:
   * - Success count: Total successful renders
   * - Failure count: Total failed renders
   * - Total count: Sum of success and failure
   * - Success rate: Percentage of successful renders (rounded to 2 decimals)
   * 
   * @returns Object containing success/failure counts and success rate
   */
  getMetrics(): RenderingMetrics {
    const totalCount = this.renderSuccessCount + this.renderFailureCount;
    const successRate = totalCount > 0 
      ? (this.renderSuccessCount / totalCount) * 100 
      : 0;

    return {
      successCount: this.renderSuccessCount,
      failureCount: this.renderFailureCount,
      totalCount,
      successRate: parseFloat(successRate.toFixed(2))
    };
  }

  /**
   * Reset all metrics counters to zero
   * Useful for starting fresh after fixing issues or for periodic resets
   */
  resetMetrics(): void {
    this.renderSuccessCount = 0;
    this.renderFailureCount = 0;
  }
}

// Export singleton instance
export const metricsTracker = new MetricsTracker();

// Export class for testing
export { MetricsTracker };
export type { RenderingMetrics };
