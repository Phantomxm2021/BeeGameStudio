import { startNativeMcpHttp, type McpHttpNetworkOptions } from './native-mcp-http'
import { realpath } from 'node:fs/promises'
import type { McpServerConfig } from '../mcp-servers-store'
import { sharedContentChecker } from './content-checker-runtime'
import type { LayoutConstraints } from './ui-layout-audit'
import { projectPreviewCapabilityPath } from './project-preview-capability'

export const NATIVE_READ_TOOLS = ['CheckUiLayouts', 'CheckSceneLayouts', 'ReadDesignHandoff',
  'ReadImplementationTask', 'CheckResourcesAndBindings', 'ReadVerificationResults'] as const

export const NATIVE_MCP_CONFIG_ENV = 'BEEGAME_NATIVE_MCP_SERVERS_JSON'

/** Adapt owner-scoped BGS settings to Bgs MCP configuration. Secrets
 * cross only the private app-server pipe, outside project reads and process arguments. */
export async function prepareNativeMcpConfig(environment: Record<string,string>, workspace: string, uiLayoutConstraints?: LayoutConstraints, sessionId?: string, networkOptions: McpHttpNetworkOptions = {}) {
  const raw = environment[NATIVE_MCP_CONFIG_ENV]
  if (!raw && !uiLayoutConstraints) return { config: {} as Record<string, unknown>, context: '', close: async () => {} }
  const servers: McpServerConfig[] = raw ? JSON.parse(raw) : []
  if (!Array.isArray(servers)) throw Error('Invalid BGS runtime MCP configuration')
  const root = await realpath(workspace), mcpServers: Record<string,unknown> = {}, unavailable: string[] = [], httpServers: Record<string,string> = {}
  for (const server of servers) {
    if (!server.enabled || server.autoStart !== true) continue
    if (!/^[A-Za-z0-9_-]+$/.test(server.id)) throw Error('Invalid BGS runtime MCP server identity')
    const skip = (reason:string) => unavailable.push(server.id + ': ' + reason)
    if (!['beegame','global','project'].includes(server.scope)) { skip('unknown scope'); continue }
    const cwd = server.cwd ? await realpath(server.cwd).catch(() => undefined) : undefined
    // Existing project-scoped records have no project ID. An exact configured
    // cwd is the only existing binding; never reinterpret unbound as global.
    if (server.scope === 'project' && cwd !== root) { skip('not bound to this workspace'); continue }
    if (server.cwd && cwd !== root) { skip('configured working directory differs; native MCP inherits project cwd'); continue }
    const key = 'bgs-' + server.id
    if (server.transport === 'stdio') {
      if (!server.command?.trim()) { skip('missing command'); continue }
      mcpServers[key] = { command:server.command, args:server.args ?? [],
        env:Object.fromEntries((server.env ?? []).filter(item => item.value !== undefined).map(item => [item.key,item.value])) }
    } else if (server.transport === 'http') {
      if (!server.url) { skip('missing URL'); continue }
      const url = new URL(server.url)
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) { skip('unsupported URL'); continue }
      if (server.env?.some(item => item.value !== undefined)) { skip('remote environment variables are not HTTP headers'); continue }
      httpServers[key] = server.url
    } else { skip(server.transport === 'sse' ? 'legacy SSE is unsupported; use a Streamable HTTP endpoint' : 'unsupported transport') }
  }
  if (uiLayoutConstraints) {
    if (mcpServers['bgs-ui-layout'] || httpServers['bgs-ui-layout']) throw Error('bgs-ui-layout is reserved for the host UI layout tool')
    const checker = await sharedContentChecker()
    mcpServers['bgs-ui-layout'] = { command: process.execPath,
      args: [checker.uiLayoutToolPath, checker.moduleUrl, root, JSON.stringify(uiLayoutConstraints),
        ...(sessionId ? [projectPreviewCapabilityPath(root, sessionId, 'measurement'), sessionId] : [])] }
  }
  const http = Object.keys(httpServers).length ? await startNativeMcpHttp(httpServers, networkOptions) : undefined
  Object.assign(mcpServers, http?.config)
  const context = 'BGS MCP: enabled auto-start servers use the native MCP client and normal tool permissions. ' +
    'Configured is not connected or verified. ' + (unavailable.length ? 'Not injected: ' + unavailable.join('; ') : '')
  return { config: { mcp_servers: mcpServers }, context, close: async () => { await http?.close() } }
}
