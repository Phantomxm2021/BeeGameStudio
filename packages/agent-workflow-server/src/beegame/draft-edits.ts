import { readFileSync, realpathSync, lstatSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { array, boolean, object, string } from 'zod'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'

const requestSchema = array(object({ file: string().min(1), replacements: array(object({
  old: string().min(1), new: string(), all: boolean().optional(),
}).strict()).min(1) }).strict()).min(1)
const documents = new Set<string>(PROJECT_DOCUMENTS.flatMap(name => [
  'docs/' + name, '.beegame/design-handoffs/' + name.replace(/\.md$/, '.json'),
]))

function draftPath(root: string, file: string) {
  if (file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..') ||
      !documents.has(file) && !/^content\/(?:ui|scenes)\/.+\.json$/.test(file))
    throw Error('Only assigned existing design documents, their indexes and Scene/UI JSON drafts are supported')
  const path = resolve(root, file)
  // No alias to a different owner or an external target, including parent links.
  if (realpathSync(path) !== path) throw Error('Draft path must not contain symlinks')
  const info = lstatSync(path)
  if (!info.isFile() || info.nlink !== 1) throw Error('Draft must be a regular file without hard links')
  return { path, mode: info.mode & 0o777 }
}

/** Mechanical exact edits only. Preflight all requested replacements, then
 * commit each file by rename. This is not a cross-file transaction or a lock;
 * failures report committed and pending files, never silently roll back work. */
export function applyDraftEdits(workspace: string, input: unknown) {
  const written: string[] = [], issues: string[] = []
  let requests: ReturnType<typeof requestSchema.parse> = []
  try {
    requests = requestSchema.parse(input)
    if (new Set(requests.map(item => item.file)).size !== requests.length) throw Error('Use one entry per file; combine its replacements in order')
    const root = realpathSync(workspace)
    const prepared: Array<{ file: string; path: string; before: Buffer; after: Buffer; mode: number }> = []
    for (const item of requests) try {
      const { path, mode } = draftPath(root, item.file), before = readFileSync(path)
      let text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before)
      for (const [index, edit] of item.replacements.entries()) {
        const matches = text.split(edit.old).length - 1
        if (!matches || matches > 1 && !edit.all)
          throw Error(`replacement ${index + 1}: expected ${edit.all ? 'at least one' : 'one'} exact match, found ${matches}; reread the affected source, do not guess`)
        text = edit.all ? text.split(edit.old).join(edit.new) : text.replace(edit.old, () => edit.new)
      }
      if (item.file.endsWith('.json')) JSON.parse(text.replace(/^\uFEFF/, ''))
      prepared.push({ file: item.file, path, mode, before, after: Buffer.from(text) })
    } catch (error) { issues.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`) }
    if (!issues.length) for (const item of prepared) {
      const temporary = item.path + '.' + randomUUID() + '.tmp'
      try {
        if (draftPath(root, item.file).path !== item.path || !readFileSync(item.path).equals(item.before))
          throw Error('Source changed after preflight; reread before retrying')
        if (!item.after.equals(item.before)) {
          writeFileSync(temporary, item.after, { flag: 'wx', mode: item.mode })
          if (draftPath(root, item.file).path !== item.path || !readFileSync(item.path).equals(item.before))
            throw Error('Source changed during commit preparation')
          renameSync(temporary, item.path)
        }
        written.push(item.file)
      } catch (error) {
        issues.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`)
        break
      } finally {
        try { unlinkSync(temporary) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issues.push(`Temporary cleanup failed: ${temporary}`)
        }
      }
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  return { valid: !issues.length, written, pending: requests.map(item => item.file).filter(file => !written.includes(file)), issues,
    note: 'Exact source edits, not design acceptance. Use only assigned writable drafts. No concurrent writers; commits are per file. Run the existing affected checks after edits.' }
}

export const DRAFT_EDITS_HELP = `Usage: bun .beegame/delivery/edit-drafts.mjs --json '[{"file":"docs/TECHNICAL_DESIGN.md","replacements":[{"old":"exact saved text","new":"replacement text"}]}]'
Or: bun .beegame/delivery/edit-drafts.mjs REQUEST.json (existing saved request)
Authoring helper for known edits to existing assigned drafts; it grants no additional file permissions.
REQUEST is [{"file":"docs/TECHNICAL_DESIGN.md","replacements":[{"old":"exact saved text","new":"replacement text"}]}].
Group all known replacements for a file in order; multiple files share one request. Use all:true only when every exact occurrence must change.
For added sections, replace a unique saved end paragraph with itself plus the new sections. Preserve unchanged prose and index fields.
All files are preflighted before writing. Missing/ambiguous matches or malformed resulting JSON leave the entire batch untouched.
I/O failures during commits may leave earlier files saved: written/pending are explicit; retry only pending work after inspecting the failure.
This is not a whole-file rewrite, a quality check or an atomic multi-file transaction. Native Read/Edit/Write remain available.
Only existing docs/<eight design names>, .beegame/design-handoffs/<their stems>.json and content/scenes|ui/**/*.json are accepted.
Do not use this command to change a reviewed production baseline; use its authorized revision. Read-only Review does not authorize this command.`

export async function runDraftEditsCli() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') { console.log(DRAFT_EDITS_HELP); return }
  const source = args.length === 2 && args[0] === '--json' ? args[1] :
    args.length === 1 && !args[0]!.startsWith('--') ? readFileSync(resolve(args[0]!), 'utf8') : undefined
  if (source === undefined) throw Error(DRAFT_EDITS_HELP)
  const result = applyDraftEdits(process.cwd(), JSON.parse(source))
  console.log(JSON.stringify(result))
  if (!result.valid) process.exitCode = 1
}
