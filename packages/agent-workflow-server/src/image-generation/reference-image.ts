import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import sharp from 'sharp'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_REFERENCE_BYTES = 16 * 1024 * 1024

export class ImageReferenceError extends Error {
  constructor(readonly code: string) { super(`Invalid reference image: ${code}`) }
}

/** Read only a project asset; never let a capability request name host files. */
export async function readProjectReferenceImage(workspacePath: string, path: string) {
  if (!/^assets\/[A-Za-z0-9_./-]+\.png$/.test(path) || path.split('/').includes('..'))
    throw new ImageReferenceError('path')
  const workspace = await realpath(workspacePath)
  const assets = resolve(workspace, 'assets')
  const candidate = resolve(workspace, path)
  try {
    if (await realpath(assets) !== assets) throw new ImageReferenceError('path')
    const actual = await realpath(candidate)
    const inside = relative(assets, actual)
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) throw new ImageReferenceError('path')
    const file = await stat(actual)
    if (!file.isFile() || file.size === 0 || file.size > MAX_REFERENCE_BYTES)
      throw new ImageReferenceError('size')
    const bytes = await readFile(actual)
    if (bytes.length > MAX_REFERENCE_BYTES) throw new ImageReferenceError('size')
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
      throw new ImageReferenceError('format')
    const metadata = await sharp(bytes, { limitInputPixels: 16_000_000 }).metadata()
    if (metadata.format !== 'png' || !metadata.width || !metadata.height)
      throw new ImageReferenceError('format')
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png' as const }
  } catch (error) {
    if (error instanceof ImageReferenceError) throw error
    throw new ImageReferenceError('unreadable')
  }
}
