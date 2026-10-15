import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import sharp from 'sharp'

// A file check, not an aesthetic or semantic review. Human inspection must
// establish whether the actual panels cover the documented screens/scenes.
const combinedBoard = 'assets/visual/design-board.png'
const separateBoards = ['assets/visual/ui-board.png', 'assets/visual/scene-board.png'] as const

export async function inspectVisualHandoff(workspacePath: string) {
  const issues: string[] = []
  const found: Array<{ path: string; width: number; height: number }> = []
  const hashes: string[] = []
  let root: string
  try { root = await realpath(workspacePath) }
  catch { return { ready: false, boards: found, issues: ['Project workspace is unavailable'],
    note: 'Image bytes and dimensions only; screen/scene coverage, visual quality and approval remain unverified.' } }
  let boards: readonly string[] = separateBoards
  try { await lstat(resolve(root, combinedBoard)); boards = [combinedBoard] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issues.push(combinedBoard + ' could not be inspected')
  }
  for (const path of boards) {
    try {
      const file = await realpath(resolve(root, path))
      const fromRoot = relative(root, file)
      if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
        issues.push(path + ' resolves outside the project')
        continue
      }
      if (!(await stat(file)).isFile()) {
        issues.push(path + ' is not a file')
        continue
      }
      const image = sharp(file, { limitInputPixels: 64 * 1024 * 1024 })
      const info = await image.metadata()
      if (info.format !== 'png' || !info.width || !info.height) {
        issues.push(path + ' is not a usable PNG')
        continue
      }
      await sharp(file, { limitInputPixels: 64 * 1024 * 1024 }).resize(1, 1).png().toBuffer()
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      hashes.push(hash.digest('hex'))
      found.push({ path, width: info.width, height: info.height })
    } catch {
      issues.push(path + ' is missing, unreadable or invalid')
    }
  }
  if (boards.length === 2 && hashes.length === 2 && hashes[0] === hashes[1]) issues.push('UI and scene boards are byte-identical')
  return { ready: issues.length === 0, boards: found, issues,
    note: 'Image bytes and dimensions only; screen/scene coverage, visual quality and approval remain unverified.' }
}
