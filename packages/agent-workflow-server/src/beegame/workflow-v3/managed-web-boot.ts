import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { digest, WorkflowError, type Run } from './state'
import { versionsMatch } from './checks'

export const MANAGED_WEB_BOOT_VERSION = 'react-web-storage-v1' as const
export const MANAGED_WEB_BOOT_PATHS = ['src/bgs-entry.mjs', 'src/bgs-storage.mjs'] as const
export const MANAGED_WEB_BOOT_CONTRACT = {
  entry: 'index.html', gameModule: 'src/game.jsx',
  factory: 'export async function createGame({root, storage})',
  lifecycle: 'Mount the game into root; storage is already initialized. Await storage.getItem/setItem/removeItem. An optional returned function disposes the game.',
  ownership: 'BGS maintains only src/bgs-entry.mjs and src/bgs-storage.mjs. The implementation handoff installs them and supplies index.html when absent. index.html belongs to the project: maintain its title, metadata and markup normally, preserving the root mount and startup script connection. Author game logic/UI/styles/build configuration; no game/UI/Scene template is installed.',
} as const

// This source is the actual application entry, not an example the author must
// remember to import. A factory receives storage only after initialization.
const ENTRY = `import { createGameStorage } from './bgs-storage.mjs';
const root = document.getElementById('root');
const abort = new AbortController();
let stopped = false, dispose;
function stop() {
  if (stopped) return;
  stopped = true; abort.abort();
  window.removeEventListener('pagehide', onPageHide);
  dispose?.();
}
function onPageHide(event) { if (!event.persisted) stop(); }
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(stop);
(async () => {
  if (!root) throw Error('BGS game mount root is missing');
  const storage = await createGameStorage(location.href, (url, init) => fetch(url, { ...init, signal: abort.signal }));
  if (stopped) return;
  const { createGame } = await import('./game.jsx');
  if (stopped) return;
  if (typeof createGame !== 'function') throw Error('src/game.jsx must export createGame({root, storage})');
  const result = await createGame({ root, storage });
  if (typeof result === 'function') { if (stopped) result(); else dispose = result; }
})().catch(error => {
  if (stopped) return;
  stop(); console.error('Game startup failed', error);
  const output = document.createElement('pre'); output.setAttribute('role', 'alert');
  output.textContent = 'Game startup failed: ' + String(error?.message ?? error);
  (root ?? document.body).replaceChildren(output);
});
`

/** New intake opt-in only. Never infer eligibility from missing files later. */
export async function assertManagedWebBoot(run: Run, required = false) {
  if (!run.creation?.webBoot) return
  if (!run.webBoot) {
    if (required) throw new WorkflowError('web-boot-missing', 'Complete the existing implementation handoff to install the managed Web entry before building')
    return
  }
  const root = await realpath(run.workspacePath)
  // Older snapshots also pinned index.html. Leave their saved identity intact,
  // but apply the same narrowed protection without migrating project files.
  const protectedFiles = run.webBoot.files.filter(file => file.path !== 'index.html')
  const canonical = await Promise.all(protectedFiles.map(async ({path}) => {
    const file = join(root, path)
    try { return await realpath(file) === file && (await lstat(file)).isFile() } catch { return false }
  }))
  if (canonical.some(value => !value) || !await versionsMatch(run.workspacePath, protectedFiles))
    throw new WorkflowError('web-boot-changed', 'Managed Web entry changed or is missing. Existing sources were preserved; BGS will not silently overwrite the startup/storage wiring.')
}

/** Runs under the existing implementation writer and handoff, not a second
 * stage. Exclusive writes recover identical partial installs, never user code. */
export async function installManagedWebBoot(run: Run, signal: AbortSignal): Promise<Run['webBoot']> {
  if (!run.creation?.webBoot) return undefined
  if (run.webBoot) { await assertManagedWebBoot(run, true); return run.webBoot }
  const root = await realpath(run.workspacePath)
  const language = JSON.parse(run.requirementChanges?.[0]?.before.text ?? run.requirements.text).game_user_visible_language
  if (!/^[a-zA-Z-]+$/.test(language)) throw new WorkflowError('web-boot-invalid', 'Saved game language is required for the managed Web entry')
  const files = {
    'index.html': '<!doctype html><html lang="' + language + '"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game</title></head><body><div id="root"></div><script type="module" src="./src/bgs-entry.mjs"></script></body></html>\n',
    'src/bgs-entry.mjs': ENTRY,
    // Pure browser-safe module, no server credentials or filesystem imports.
    // The project's normal bundler removes the unused HTTP-handler exports.
    'src/bgs-storage.mjs': await readFile(new URL('../preview-storage.mjs', import.meta.url), 'utf8'),
  }
  const check = () => { if (signal.aborted) throw new WorkflowError('web-boot-cancelled', 'Web entry installation was cancelled; no automatic replay') }
  const conflict = (path: string) => new WorkflowError('web-boot-conflict', 'Reserved Web entry already contains different or aliased content; existing source preserved: ' + path)
  // Inspect all destinations before writing any of them. An existing game
  // module, package, style, content or design document is never a destination.
  for (const [path, body] of Object.entries(files)) {
    check()
    let parent = root
    for (const part of relative(root, dirname(join(root, path))).split('/').filter(Boolean)) {
      parent = join(parent, part)
      try { if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) throw conflict(path) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    try {
      const file = join(root, path)
      if (!(await lstat(file)).isFile() || await realpath(file) !== file || path !== 'index.html' && await readFile(file, 'utf8') !== body) throw conflict(path)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  for (const [path, body] of Object.entries(files)) {
    check()
    const parent = dirname(join(root, path))
    if (parent !== root) await mkdir(parent, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) throw conflict(path)
    const file = join(root, path)
    await writeFile(file, body, { flag: 'wx', mode: 0o600 }).catch(async error => {
      if (error.code !== 'EEXIST' || !(await lstat(file)).isFile() || await realpath(file) !== file || path !== 'index.html' && await readFile(file, 'utf8') !== body) throw conflict(path)
    })
  }
  check()
  const installed: NonNullable<Run['webBoot']> = { version: MANAGED_WEB_BOOT_VERSION,
    files: MANAGED_WEB_BOOT_PATHS.map(path => ({ path, sha256: digest(files[path]) })) }
  if (!await versionsMatch(root, installed.files)) throw new WorkflowError('web-boot-changed', 'Managed Web entry changed during installation')
  return installed
}
