import { readdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Run } from './state'

// Only exact host records are ignored. A README, imported source, unknown dot
// file or alias makes this an existing project, not permission to overwrite it.
async function sourcePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  async function visit(dir: string) {
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      const path = relative(root, join(dir, entry.name))
      if (path === '.beegame' || path === 'transcripts' ||
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
  const settings = brief.settings
  const editableContent = settings.platform === 'Web' && settings.engine === 'React' && settings.bgsVisualEditing !== false
  return {initialDelivery:'design-led-first-version',editableContent}
}

/** Old creation records enabled Web JSON for every Web export, including native
 * engines. Those engines retain their own editable source format. */
export function requiresBgsEditableContent(run: Pick<Run, 'creation'> & Partial<Pick<Run, 'requirements'>>): boolean {
  return Boolean(run.creation?.editableContent) && !['Unity', 'Godot', 'Unreal'].includes(String(run.requirements?.constraints.engine))
}
