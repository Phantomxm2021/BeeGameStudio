import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { getParserModule, type TsNode } from 'src/utils/bash/bashParser.js'

const below = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}

/** Resolve only quoted, literal descendants of the host-provided scratch path.
 * Pin the EXECUTED argument too: validating an expansion but executing the
 * original variable would trust mutable shell state. No shell is evaluated.
 * Unknown syntax stays on the existing permission path. */
export function pinSandboxScratchCleanup(command: string, projectRoot: string, temporary: string | undefined): string | undefined {
  if (!temporary || command.length > 10000 || !command.includes('$TMPDIR/')) return
  // Do not reinterpret a command that explicitly changes its own environment.
  if (/\bTMPDIR\s*=|\b(?:unset|source|eval|export|declare|readonly|typeset|read)\b/.test(command)) return
  let scratch: string
  try {
    scratch = realpathSync(temporary)
    const root = realpathSync(projectRoot)
    if (scratch !== resolve(temporary) || !below(resolve(root, '.beegame/tmp'), scratch)) return
  } catch { return }
  const tree = getParserModule()?.parse(command)
  if (!tree) return
  const edits: Array<{ start: number; end: number; text: string }> = []
  let unsupported = false
  function walk(node: TsNode) {
    if (['program', 'list', 'pipeline', 'redirected_statement'].includes(node.type)) {
      for (const child of node.children) walk(child)
      return
    }
    if (['&&', '||', '|', ';', '\n', 'comment', 'file_redirect', 'variable_assignment'].includes(node.type)) return
    if (node.type !== 'command') { unsupported = true; return }
    const name = node.children[0]
    if (name?.text === '.') { unsupported = true; return }
    if (name?.type !== 'command_name' || !['rm', '/bin/rm', '/usr/bin/rm', 'rmdir', '/bin/rmdir', '/usr/bin/rmdir'].includes(name.text)) return
    for (const arg of node.children.slice(1)) {
      const match = arg.type === 'string' && /^"\$TMPDIR\/([a-zA-Z0-9_.\/-]+)"$/.exec(arg.text)
      if (!match) continue
      const parts = match[1]!.split('/')
      if (parts.some(part => !part || part === '.' || part === '..')) continue
      const target = resolve(scratch, ...parts)
      if (!below(scratch, target)) continue
      // Reject symlinks, including dangling links and symlink ancestors.
      let current = target
      let safe = true
      while (current !== scratch) {
        try { if (lstatSync(current).isSymbolicLink()) { safe = false; break } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { safe = false; break } }
        current = dirname(current)
      }
      if (safe) edits.push({ start: arg.startIndex, end: arg.endIndex,
        text: `'${target.replaceAll("'", "'\\''")}'` })
    }
  }
  walk(tree)
  if (unsupported || !edits.length) return
  // Parser spans are UTF-8 byte offsets, not UTF-16 string indexes.
  let bytes = Buffer.from(command)
  for (const edit of edits.sort((a, b) => b.start - a.start))
    bytes = Buffer.concat([bytes.subarray(0, edit.start), Buffer.from(edit.text), bytes.subarray(edit.end)])
  return bytes.toString()
}
