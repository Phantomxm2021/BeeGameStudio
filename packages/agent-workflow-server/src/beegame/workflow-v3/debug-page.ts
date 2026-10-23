import type { Hono } from 'hono'
import { readFile } from 'node:fs/promises'

/** Opt-in development shell only. Data and mutations use the existing
 * authenticated project APIs; this route grants no project authority. */
export function registerV3DebugPage(app: Hono, enabled = false) {
  if (!enabled) return
  for (const [path, file, type] of [
    ['/debug/workflow-v3', 'debug.html', 'text/html; charset=utf-8'],
    ['/debug/workflow-v3/client.js', 'debug-client.js', 'text/javascript; charset=utf-8'],
  ]) app.get(path!, async c => {
    // Never expose the development shell via a production/reverse-proxy host.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) return c.notFound()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src http: https:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
    return c.body(await readFile(new URL(file!, import.meta.url), 'utf8'), 200, { 'Content-Type': type! })
  })
}
