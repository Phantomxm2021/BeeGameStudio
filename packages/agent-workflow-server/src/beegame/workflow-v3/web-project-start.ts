import { readdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Run } from './state'

// Only host records and Git configuration are ignored. A README, imported source, unknown dot
// file or alias makes this an existing project, not permission to overwrite it.
async function sourcePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  async function visit(dir: string) {
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      const path = relative(root, join(dir, entry.name))
      // Bootstrap initializes Git and reference uploads before observing creation.
      if (path === '.git' || (path === '.gitignore' && entry.isFile()) ||
          path === '.beegame' || path === 'transcripts' ||
          (path === '.beegame-attachments' && entry.isDirectory()) ||
          /^logs\/(index\.json|runtime-diagnostics\.jsonl(?:\.\d+)?)$/.test(path)) continue
      if (entry.isDirectory()) await visit(join(root,path))
      else paths.push(path)
    }
  }
  await visit(root)
  return paths
}

export async function observeProjectCreation(root: string, brief: {
  settings: Record<string, unknown>; build_source?: unknown; creation_mode?: unknown
}): Promise<Run['creation']> {
  if (brief.build_source != null || !['creative', 'blueprint'].includes(String(brief.creation_mode)) ||
      (await sourcePaths(await realpath(root))).length) return undefined
  return {initialDelivery:'design-led-first-version',editableContent:false}
}

/** Web/React uses project-native UI and scene code, not the BGS editor contract. */
export function isWebReactTarget(settings: { platform?: unknown; engine?: unknown } | undefined): boolean {
  return settings?.platform === 'Web' && settings.engine === 'React'
}

/** Visual evidence belongs to delivery quality, independently of editor support. */
export function requiresWebVisualComparison(run: Pick<Run, 'creation'> & Partial<Pick<Run, 'requirements'>>): boolean {
  return isWebReactTarget(run.requirements?.constraints) &&
    (run.creation?.initialDelivery === 'design-led-first-version' || run.creation?.editableContent === true)
}
