import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type ViteServer = {
  close: () => Promise<void>
  listen: () => Promise<void>
  printUrls: () => void
}

type ViteModule = {
  createServer: (config: {
    root: string
    base: string
    plugins: Array<{
      name: string
      transformIndexHtml?: {
        order: 'post'
        handler: (html: string) => string
      }
      configureServer?: (server: {
        middlewares: {
          use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void
        }
      }) => void
    }>
    server: {
      host: string
      port: number
      strictPort: true
      hmr: false
    }
  }) => Promise<ViteServer>
}

type HostOptions = {
  host: string
  port: number
  base: string
}

type VitePreviewHostPlugin = {
  name: string
  transformIndexHtml: {
    order: 'post'
    handler: (html: string) => string
  }
  configureServer(server: {
    middlewares: {
      use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void
    }
  }): void
}

export function stripViteClientScript(html: string, base: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const marker = `<script type="module" src="${normalizedBase}@vite/client"></script>`
  return html.split(marker).join('')
}

/**
 * Generated projects sometimes use root-relative paths for public files. A
 * managed preview runs below a session base, so normalise only file-like URLs
 * before Vite's base middleware handles the request. API and client routes do
 * not have a final extension and deliberately remain untouched.
 */
export function rewriteRootStaticAssetRequest(requestUrl: string, base: string): string {
  if (!requestUrl.startsWith('/')) return requestUrl
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  if (normalizedBase === '/' || requestUrl.startsWith(normalizedBase)) return requestUrl
  const pathname = requestUrl.split(/[?#]/, 1)[0] || ''
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (!lastSegment.includes('.')) return requestUrl
  return `${normalizedBase.slice(0, -1)}${requestUrl}`
}

export function createManagedVitePreviewPlugin(base: string): VitePreviewHostPlugin {
  return {
    name: 'beegame-managed-preview-compatibility',
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) => stripViteClientScript(html, base),
    },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewriteRootStaticAssetRequest(request.url || '/', base)
        next()
      })
    },
  }
}

export function parseVitePreviewHostOptions(argv: string[]): HostOptions {
  let host = '127.0.0.1'
  let port = 5173
  let base = '/'
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = argv[index + 1]
    if (value === '--host' && next) {
      host = next
      index += 1
    } else if (value === '--port' && next) {
      port = Number.parseInt(next, 10)
      index += 1
    } else if (value === '--base' && next) {
      base = next
      index += 1
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid preview port: ${port}`)
  }
  return { host, port, base }
}

export async function startVitePreviewHost(
  workspacePath: string,
  options: HostOptions,
): Promise<ViteServer> {
  const projectRequire = createRequire(join(workspacePath, 'package.json'))
  const viteEntry = projectRequire.resolve('vite')
  const vite = await import(pathToFileURL(viteEntry).href) as ViteModule
  const server = await vite.createServer({
    root: workspacePath,
    base: options.base,
    plugins: [createManagedVitePreviewPlugin(options.base)],
    server: {
      host: options.host,
      port: options.port,
      strictPort: true,
      hmr: false,
    },
  })
  await server.listen()
  server.printUrls()
  return server
}

if (import.meta.main) {
  const server = await startVitePreviewHost(process.cwd(), parseVitePreviewHostOptions(process.argv.slice(2)))
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void close())
  process.on('SIGTERM', () => void close())
  await new Promise(() => {})
}
