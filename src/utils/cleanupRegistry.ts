/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown.
 */
export async function runCleanupFunctions(): Promise<void> {
  const results = await Promise.allSettled(Array.from(cleanupFunctions).map(fn => Promise.resolve().then(fn)))
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
