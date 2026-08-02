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
      enforce?: 'post'
      transformIndexHtml?: {
        order: 'post'
        handler: (html: string) => string
      }
      transform?: (
        this: ViteTransformContext,
        code: string,
        id: string,
      ) => { code: string; map: null } | null
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
  enforce: 'post'
  transformIndexHtml: {
    order: 'post'
    handler: (html: string) => string
  }
  configureServer(server: {
    middlewares: {
      use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void
    }
  }): void
  transform(
    this: ViteTransformContext,
    code: string,
    id: string,
  ): { code: string; map: null } | null
}

type ViteTransformContext = {
  parse(code: string): {
    body: Array<Record<string, unknown>>
  }
}

export function stripViteClientScript(html: string, base: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const expectedSrc = `${normalizedBase}@vite/client`
  const lowerHtml = html.toLowerCase()
  let cursor = 0
  let result = ''

  while (cursor < html.length) {
    const scriptStart = lowerHtml.indexOf('<script', cursor)
    if (scriptStart < 0) return result + html.slice(cursor)
    const openTagEnd = lowerHtml.indexOf('>', scriptStart + 7)
    if (openTagEnd < 0) return result + html.slice(cursor)
    const closeTagEnd = lowerHtml.indexOf('</script>', openTagEnd + 1)
    if (closeTagEnd < 0) return result + html.slice(cursor)

    const openTag = html.slice(scriptStart, openTagEnd + 1)
    if (readHtmlAttribute(openTag, 'src') === expectedSrc) {
      result += html.slice(cursor, scriptStart)
      cursor = closeTagEnd + '</script>'.length
      continue
    }
    result += html.slice(cursor, closeTagEnd + '</script>'.length)
    cursor = closeTagEnd + '</script>'.length
  }
  return result
}

function readHtmlAttribute(openTag: string, expectedName: string): string | undefined {
  let cursor = openTag.toLowerCase().indexOf('script') + 'script'.length
  while (cursor > 0 && cursor < openTag.length) {
    while (cursor < openTag.length && isHtmlWhitespace(openTag[cursor])) cursor += 1
    if (cursor >= openTag.length || openTag[cursor] === '>') return undefined

    const nameStart = cursor
    while (
      cursor < openTag.length &&
      !isHtmlWhitespace(openTag[cursor]) &&
      openTag[cursor] !== '=' &&
      openTag[cursor] !== '>'
    ) cursor += 1
    const name = openTag.slice(nameStart, cursor).toLowerCase()
    while (cursor < openTag.length && isHtmlWhitespace(openTag[cursor])) cursor += 1
    if (openTag[cursor] !== '=') continue
    cursor += 1
    while (cursor < openTag.length && isHtmlWhitespace(openTag[cursor])) cursor += 1

    const quote = openTag[cursor] === '"' || openTag[cursor] === "'"
      ? openTag[cursor]
      : undefined
    if (quote) cursor += 1
    const valueStart = cursor
    if (quote) {
      while (cursor < openTag.length && openTag[cursor] !== quote) cursor += 1
    } else {
      while (
        cursor < openTag.length &&
        !isHtmlWhitespace(openTag[cursor]) &&
        openTag[cursor] !== '>'
      ) cursor += 1
    }
    const value = openTag.slice(valueStart, cursor)
    if (quote && cursor < openTag.length) cursor += 1
    if (name === expectedName) return value
  }
  return undefined
}

function isHtmlWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f'
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
    name: 'beegame-managed-preview',
    enforce: 'post',
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
    transform(code, id) {
      if (!isStyleModuleRequest(id)) return null
      return disableViteStyleHmr(code, this.parse(code))
    },
  }
}

export function disableViteStyleHmr(
  code: string,
  ast: { body: Array<Record<string, unknown>> },
): { code: string; map: null } | null {
  const replacements: Array<{ start: number; end: number; value: string }> = []
  for (const node of ast.body) {
    if (isViteClientImport(node)) {
      const replacement = createLocalStyleRuntime(node)
      if (!replacement) return null
      replacements.push({
        start: Number(node.start),
        end: Number(node.end),
        value: replacement,
      })
      continue
    }
    if (isViteHotExpression(node)) {
      replacements.push({
        start: Number(node.start),
        end: Number(node.end),
        value: '',
      })
    }
  }
  if (!replacements.length) return null
  let transformed = code
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformed = transformed.slice(0, replacement.start) + replacement.value + transformed.slice(replacement.end)
  }
  return { code: transformed, map: null }
}

function isStyleModuleRequest(id: string): boolean {
  const cleanId = id.split('?', 1)[0]?.toLowerCase() || ''
  const extension = cleanId.slice(cleanId.lastIndexOf('.'))
  return STYLE_EXTENSIONS.has(extension)
}

const STYLE_EXTENSIONS = new Set([
  '.css',
  '.less',
  '.pcss',
  '.postcss',
  '.sass',
  '.scss',
  '.styl',
  '.stylus',
])

function isViteClientImport(node: Record<string, unknown>): boolean {
  if (node.type !== 'ImportDeclaration') return false
  const source = node.source
  if (!source || typeof source !== 'object') return false
  const value = String((source as Record<string, unknown>).value || '')
  return value.endsWith('/@vite/client')
}

function createLocalStyleRuntime(node: Record<string, unknown>): string | undefined {
  const specifiers = Array.isArray(node.specifiers) ? node.specifiers : []
  const declarations: string[] = []
  for (const rawSpecifier of specifiers) {
    if (!rawSpecifier || typeof rawSpecifier !== 'object') return undefined
    const specifier = rawSpecifier as Record<string, unknown>
    const imported = specifier.imported
    const local = specifier.local
    if (!imported || typeof imported !== 'object' || !local || typeof local !== 'object') {
      return undefined
    }
    const importedName = String((imported as Record<string, unknown>).name || '')
    const localName = String((local as Record<string, unknown>).name || '')
    if (!isJavaScriptIdentifier(localName)) return undefined
    if (importedName === 'updateStyle') {
      declarations.push(`const ${localName} = (id, css) => { const style = document.createElement('style'); style.setAttribute('data-beegame-preview-style', id); style.textContent = css; document.head.appendChild(style) }`)
    } else if (importedName === 'removeStyle') {
      declarations.push(`const ${localName} = () => {}`)
    } else if (importedName === 'createHotContext') {
      declarations.push(`const ${localName} = () => ({ accept() {}, prune() {}, dispose() {}, invalidate() {}, on() {}, send() {} })`)
    } else {
      return undefined
    }
  }
  return declarations.join(';')
}

function isViteHotExpression(node: Record<string, unknown>): boolean {
  if (node.type !== 'ExpressionStatement') return false
  const expression = node.expression
  if (!expression || typeof expression !== 'object') return false
  return containsImportMetaHot(expression as Record<string, unknown>)
}

function containsImportMetaHot(node: Record<string, unknown>): boolean {
  if (node.type === 'MetaProperty') {
    const meta = node.meta
    const property = node.property
    return Boolean(
      meta && typeof meta === 'object' && (meta as Record<string, unknown>).name === 'import' &&
      property && typeof property === 'object' && (property as Record<string, unknown>).name === 'meta',
    )
  }
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      if (value.some(item => item && typeof item === 'object' && containsImportMetaHot(item as Record<string, unknown>))) {
        return true
      }
    } else if (containsImportMetaHot(value as Record<string, unknown>)) {
      return true
    }
  }
  return false
}

function isJavaScriptIdentifier(value: string): boolean {
  if (!value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const isDigit = code >= 48 && code <= 57
    if (!isLetter && code !== 95 && code !== 36 && !(index > 0 && isDigit)) return false
  }
  return true
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
