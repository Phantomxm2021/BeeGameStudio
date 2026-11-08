import { startNativeMcpHttp, type McpHttpNetworkOptions, type McpHttpServer } from './native-mcp-http'
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '../mcp-servers-store'
import { projectPreviewCapabilityPath } from './project-preview-capability'

export const NATIVE_MCP_CONFIG_ENV = 'BEEGAME_NATIVE_MCP_SERVERS_JSON'

/** Adapt owner-scoped BGS settings to Bgs MCP configuration. Secrets
 * cross only the private app-server pipe, outside project reads and process arguments. */
export async function prepareNativeMcpConfig(environment: Record<string,string>, workspace: string, sessionId?: string, networkOptions: McpHttpNetworkOptions = {}, imageGenerationEntry?: string) {
  const raw = environment[NATIVE_MCP_CONFIG_ENV]
  if (!raw && !imageGenerationEntry) return { config: {} as Record<string, unknown>, context: '', close: async () => {} }
  const servers: McpServerConfig[] = raw ? JSON.parse(raw) : []
  if (!Array.isArray(servers)) throw Error('Invalid BGS runtime MCP configuration')
  const root = await realpath(workspace), mcpServers: Record<string,unknown> = {}, unavailable: string[] = [], httpServers: Record<string,McpHttpServer> = {}
  const socketEnvironments: Record<string,string>[] = []
  // A bound project connection replaces the owner's same-named default for this project.
  const projectNames = new Set(await Promise.all(servers.filter(server =>
    server.enabled && server.autoStart === true && server.scope === 'project' && server.cwd && server.name
  ).map(async server => await realpath(server.cwd!).catch(() => undefined) === root ? server.name : undefined)))
  for (const server of servers) {
    if (!server.enabled || server.autoStart !== true) continue
    if (server.scope !== 'project' && server.name && projectNames.has(server.name)) continue
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
      const env = Object.fromEntries((server.env ?? []).flatMap(item => item.value === undefined ? [] : [[item.key,item.value]]))
      if (!Object.hasOwn(env, 'PWTEST_SOCKETS_DIR')) socketEnvironments.push(env)
      mcpServers[key] = { command:server.command, args:server.args ?? [],
        startup_timeout_sec: DEFAULT_REQUEST_TIMEOUT_MSEC / 1000, env }
    } else if (server.transport === 'http') {
      if (!server.url) { skip('missing URL'); continue }
      const url = new URL(server.url)
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) { skip('unsupported URL'); continue }
      if (server.env?.some(item => item.value !== undefined)) { skip('remote environment variables are not HTTP headers'); continue }
      httpServers[key] = { url: server.url, headers: server.headers }
    } else { skip(server.transport === 'sse' ? 'legacy SSE is unsupported; use a Streamable HTTP endpoint' : 'unsupported transport') }
  }
  if (imageGenerationEntry) {
    if (!sessionId) throw Error('Image MCP requires a current session identity')
    mcpServers['beegame-images'] = { command:process.execPath,args:[imageGenerationEntry,'--mcp'],tool_timeout_sec:180,
      env:{BEEGAME_ASSET_CAPABILITY_FILE:projectPreviewCapabilityPath(root,sessionId),
        ...(environment.BEEGAME_SHARP_MODULE ? {BEEGAME_SHARP_MODULE:environment.BEEGAME_SHARP_MODULE} : {})} }
  }
  let socketDirectory: string | undefined
  if (socketEnvironments.length) {
    // macOS's per-user TMPDIR and project scratch paths exceed Unix socket limits.
    // Keep this IPC root private to the native runtime; Shell keeps its own TMPDIR.
    const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'bgs-mcp-'))
    socketDirectory = directory
    for (const env of socketEnvironments) env.PWTEST_SOCKETS_DIR = directory
  }
  try {
    const http = Object.keys(httpServers).length ? await startNativeMcpHttp(httpServers, networkOptions) : undefined
    Object.assign(mcpServers, http?.config)
    if (http) unavailable.push(...http.unavailable)
    // The native client applies the same explicit selection to stdio and relayed HTTP tools.
    for (const server of servers) {
      const config = mcpServers['bgs-' + server.id] as Record<string, unknown> | undefined
      if (!config) continue
      if (server.enabledTools !== undefined) config.enabled_tools = server.enabledTools
      if (server.disabledTools !== undefined) config.disabled_tools = server.disabledTools
    }
    const context = 'BGS MCP: enabled auto-start servers use the native MCP client and normal tool permissions. ' +
      'Configured is not connected or verified. ' + (unavailable.length ? 'Not injected: ' + unavailable.join('; ') : '')
    return { config: { mcp_servers: mcpServers }, context, close: async () => {
      // The native client closes its MCP processes before invoking this cleanup.
      try { await http?.close() } finally { if (socketDirectory) await rm(socketDirectory, { recursive: true, force: true }) }
    } }
  } catch (error) {
    if (socketDirectory) await rm(socketDirectory, { recursive: true, force: true })
    throw error
  }
}
