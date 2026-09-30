import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve the pinned, self-contained client package, not the host source tree.
 * Browser launch/ownership remains with the existing Preview capability. */
export function sharedPlaywright() {
  const root = dirname(realpathSync(createRequire(import.meta.url).resolve('playwright-core/package.json')))
  return { root, moduleUrl: pathToFileURL(join(root, 'index.mjs')).href }
}
