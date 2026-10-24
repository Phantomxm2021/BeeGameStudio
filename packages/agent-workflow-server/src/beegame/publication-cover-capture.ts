import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPreviewTestBrowser } from './preview-test-browser'
import { previewTestHostDocument } from './preview-test-access'
import { sharedPlaywright } from './shared-playwright'
import { preparePublicationCover } from './publication-cover'

/** Capture an owned Preview URL; callers must never accept a client-supplied URL. */
export async function capturePublicationCover(previewUrl: string): Promise<Buffer> {
  const browser = createPreviewTestBrowser()
  let child: ReturnType<typeof spawn> | undefined
  const timer = setTimeout(() => { child?.kill('SIGKILL'); void browser.close() }, 30_000)
  try {
    const node = Bun.which('node')
    if (!node) throw Error('Node is required for preview capture')
    const { endpoint } = await browser.start()
    const image = await new Promise<Buffer>((resolve, reject) => {
      child = spawn(node, [fileURLToPath(new URL('./publication-cover-capture.mjs', import.meta.url))], {
        env: { PATH: process.env.PATH, BGS_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const chunks: Buffer[] = []
      let size = 0, diagnostic = ''
      child.stdout!.on('data', (bytes: Buffer) => {
        size += bytes.length
        if (size > 10 * 1024 * 1024) child?.kill('SIGKILL')
        else chunks.push(bytes)
      })
      child.stderr!.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-2000) })
      child.stdin!.on('error', () => { /* Process exit reports failure. */ })
      child.once('error', reject)
      child.once('close', code => code === 0 && size > 0 && size <= 10 * 1024 * 1024
        ? resolve(Buffer.concat(chunks)) : reject(Error('Preview screenshot did not complete: ' + diagnostic.replace(/https?:\/\/\S+/g, '[preview URL]'))))
      child.stdin!.end(JSON.stringify({ endpoint, previewUrl, host: previewTestHostDocument(new URL(previewUrl)) }))
    })
    return await preparePublicationCover({ mediaType: 'image/jpeg', filename: 'game-preview.jpg', data: image.toString('base64') })
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill('SIGKILL')
    await browser.close()
  }
}
