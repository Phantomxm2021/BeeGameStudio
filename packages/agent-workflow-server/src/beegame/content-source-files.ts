import { readdirSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/** Saved draft discovery shared by Scene and resource/binding reads. No index prerequisite. */
export function collectContentSourceFiles(workspace: string, directories: readonly ('content/ui' | 'content/scenes')[], issues: string[]) {
  const root = realpathSync(workspace), files: string[] = []
  const collect = (directory: string) => {
    const target = resolve(root, directory)
    if (realpathSync(target) !== target) throw Error(directory + ': content inputs must not be symlinks')
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const file = directory + '/' + entry.name
      if (entry.isSymbolicLink()) { issues.push(file + ': content inputs must not be symlinks'); continue }
      if (entry.isDirectory()) { try { collect(file) } catch (error) { issues.push(file + ': ' + String(error)) } }
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(file)
    }
  }
  for (const directory of directories) try { collect(directory) }
  catch (error) { issues.push(directory + ': ' + String(error)) }
  return files.sort()
}
