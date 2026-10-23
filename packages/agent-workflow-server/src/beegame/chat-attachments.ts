import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

// Only files created by the attachment writer, never arbitrary workspace paths.
export async function readChatAttachment(workspace: string, storageId: string): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]+$/.test(storageId)) {
    throw new Error('Attachment not found')
  }
  const root = await realpath(workspace)
  const directory = await realpath(join(root, '.beegame-attachments'))
  const target = await realpath(join(directory, storageId))
  const inside = (base: string, path: string) => {
    const rel = relative(base, path)
    return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')
  }
  if (!inside(root, directory) || !inside(directory, target)) throw new Error('Attachment not found')
  const info = await stat(target)
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Attachment not found')
  const mediaType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(storageId)]
  const bytes = await readFile(target)
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': mediaType || 'application/octet-stream',
    'Content-Disposition': `${mediaType ? 'inline' : 'attachment'}; filename="${storageId}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } })
}
