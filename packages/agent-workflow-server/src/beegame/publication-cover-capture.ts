import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPreviewTestBrowser } from './preview-test-browser'
import { previewTestHostDocument } from '@bee-game-studio/agent-workflow/preview-environment'
import { sharedPlaywright } from './shared-playwright'
import { preparePublicationCover, distinctPublicationCovers } from './publication-cover'

/** Capture an owned Preview URL; callers must never accept a client-supplied URL. */
export async function capturePublicationCover(previewUrl: string): Promise<Buffer> {
  return (await captureCoverFrames(previewUrl, 1))[0]!
}

export function capturePublicationCovers(previewUrl: string): Promise<Buffer[]> {
  return captureCoverFrames(previewUrl, 3)
}

async function captureCoverFrames(previewUrl: string, count: 1 | 3): Promise<Buffer[]> {
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
      child.stdin!.end(JSON.stringify({ endpoint, previewUrl, count, host: previewTestHostDocument(new URL(previewUrl)) }))
    })
    if (count === 1) return [await preparePublicationCover({ mediaType: 'image/jpeg', filename: 'game-preview.jpg', data: image.toString('base64') })]
    const frames: unknown = JSON.parse(image.toString('utf8'))
    if (!Array.isArray(frames) || frames.length !== count || !frames.every((frame): frame is string => typeof frame === 'string'))
      throw Error('Preview screenshot response is invalid')
    return await distinctPublicationCovers(await Promise.all(frames.map(data => preparePublicationCover({ mediaType: 'image/jpeg', filename: 'game-preview.jpg', data }))))
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill('SIGKILL')
    await browser.close()
  }
}
