import { open } from 'node:fs/promises'
import { basename } from 'node:path'

/** Read append-only Chat sources once. An incomplete final line is retried,
 * including incomplete UTF-8; a failed read never advances the committed offset. */
export class ChatJsonlReader<T> {
  private offset = 0
  private identity?: string
  private size = 0
  private modified = 0

  async read(path: string): Promise<{ rows: T[]; reset: boolean; bytesRead: number }> {
    const file = await open(path, 'r')
    try {
      const info = await file.stat()
      const identity = `${info.dev}:${info.ino}`
      const reset = this.identity !== identity || info.size < this.size ||
        (info.size === this.size && info.mtimeMs !== this.modified)
      let position = reset ? 0 : this.offset
      let committed = position
      let fragments: Buffer[] = []
      const rows: T[] = []
      let bytesRead = 0
      while (position < info.size) {
        const buffer = Buffer.alloc(Math.min(256 * 1024, info.size - position))
        const read = await file.read(buffer, 0, buffer.length, position)
        if (!read.bytesRead) break
        bytesRead += read.bytesRead
        position += read.bytesRead
        const bytes = buffer.subarray(0, read.bytesRead)
        let start = 0
        for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
          const part = bytes.subarray(start, end)
          const line = (fragments.length ? Buffer.concat([...fragments, part]) : part).toString('utf8').trim()
          if (line) {
            try { rows.push(JSON.parse(line) as T) }
            catch { throw new Error(`Invalid Chat JSONL record in ${basename(path)} at byte ${committed}`) }
          }
          start = end + 1
          committed = position - read.bytesRead + start
          fragments = []
        }
        if (start < bytes.length) fragments.push(bytes.subarray(start))
      }
      this.offset = committed
      this.identity = identity
      this.size = info.size
      this.modified = info.mtimeMs
      return { rows, reset, bytesRead }
    } finally { await file.close() }
  }
}
