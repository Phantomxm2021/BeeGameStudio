import { fileURLToPath } from 'url'
import * as path from 'path'

/**
 * Resolve the dist root directory from the current module's location.
 *
 * Works across all build layouts:
 * - Single-file: dist/cli.js → dist/
 * - Code-split:  dist/chunks/chunk-xxx.js → dist/
 * - Dev mode:    src/utils/distRoot.ts → <project_root>/
 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function resolveDistRoot(directory: string): string {
  let root = path.resolve(directory)
  // A chunk directory belongs to its immediate build, whatever it is named.
  // Never interpret an ancestor called src/dist as the current build layout.
  while (path.basename(root) === 'chunks') root = path.dirname(root)
  if (path.basename(root) === 'utils' && path.basename(path.dirname(root)) === 'src') {
    return path.dirname(path.dirname(root))
  }
  return root
}

const distRoot = resolveDistRoot(__dirname)

export { distRoot }
