import { realpathSync } from 'node:fs'
import { copyFile, mkdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve the pinned, self-contained client package, not the host source tree.
 * Browser launch/ownership remains with the existing Preview capability. */
export function sharedPlaywright() {
  const root = dirname(realpathSync(createRequire(import.meta.url).resolve('playwright-core/package.json')))
  return { root, moduleUrl: pathToFileURL(join(root, 'index.mjs')).href }
}

/** Seed only the installed recorder into the existing private project cache.
 * The pinned Playwright registry chooses its required revision/platform. Never
 * install/download browsers or grant access to the host's whole cache. */
export async function preparePreviewRecorder(cache: string) {
  const { root } = sharedPlaywright()
  const { registry } = createRequire(import.meta.url)(join(root, 'lib/coreBundle.js')).registry
  const executable = registry.findExecutable('ffmpeg').executablePath() as string | undefined
  if (!executable) return { available: false }
  const source = await realpath(executable).catch(() => undefined)
  if (!source || !(await stat(source)).isFile()) return { available: false }
  const directory = join(cache, basename(dirname(executable)))
  for (const path of [cache, directory]) {
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (await realpath(path) !== path) throw Error('Recorder cache must not resolve through a link')
  }
  const target = join(directory, basename(executable))
  try { await copyFile(source, target, constants.COPYFILE_EXCL) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  if (await realpath(target) !== target || !(await stat(target)).isFile()) throw Error('Recorder must be a regular non-aliased file')
  return { available: true, path: target }
}
