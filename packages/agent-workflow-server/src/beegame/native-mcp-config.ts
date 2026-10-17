import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '../mcp-servers-store'
import { sharedContentChecker } from './content-checker-runtime'
import type { LayoutConstraints } from './ui-layout-audit'
import { projectPreviewCapabilityPath } from './project-preview-capability'

export const NATIVE_READ_TOOLS = ['CheckUiLayouts', 'CheckSceneLayouts', 'ReadDesignHandoff',
  'ReadImplementationTask', 'CheckResourcesAndBindings', 'ReadVerificationResults'] as const

export const NATIVE_MCP_CONFIG_ENV = 'BEEGAME_NATIVE_MCP_SERVERS_JSON'

/** Adapt owner-scoped BGS settings to the existing native MCP client. Secrets
 * stay in a host-private file, outside project reads and command-line JSON. */
export async function prepareNativeMcpConfig(environment: Record<string,string>, workspace: string, uiLayoutConstraints?: LayoutConstraints, sessionId?: string) {
  const raw = environment[NATIVE_MCP_CONFIG_ENV]
  if (!raw && !uiLayoutConstraints) return { flags: [] as string[], context: '', close: async () => {} }
  const servers: McpServerConfig[] = raw ? JSON.parse(raw) : []
  if (!Array.isArray(servers)) throw Error('Invalid BGS runtime MCP configuration')
  const root = await realpath(workspace), mcpServers: Record<string,unknown> = {}, unavailable: string[] = []
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
      mcpServers[key] = { type:'stdio', command:server.command, args:server.args ?? [],
        env:Object.fromEntries((server.env ?? []).filter(item => item.value !== undefined).map(item => [item.key,item.value])) }
    } else if (server.transport === 'http' || server.transport === 'sse') {
      if (!server.url) { skip('missing URL'); continue }
      const url = new URL(server.url)
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) { skip('unsupported URL'); continue }
      if (server.env?.some(item => item.value !== undefined)) { skip('remote environment variables are not HTTP headers'); continue }
      mcpServers[key] = { type:server.transport, url:server.url }
    } else { skip('unsupported transport') }
  }
  if (uiLayoutConstraints) {
    if (mcpServers['bgs-ui-layout']) throw Error('bgs-ui-layout is reserved for the host UI layout tool')
    const checker = await sharedContentChecker()
    mcpServers['bgs-ui-layout'] = { type: 'stdio', command: process.execPath,
      args: [checker.uiLayoutToolPath, checker.moduleUrl, root, JSON.stringify(uiLayoutConstraints),
        ...(sessionId ? [projectPreviewCapabilityPath(root, sessionId, 'measurement'), sessionId] : [])] }
  }
  const context = 'BGS MCP: enabled auto-start servers use the native MCP client and normal tool permissions. ' +
    'Configured is not connected or verified. ' + (unavailable.length ? 'Not injected: ' + unavailable.join('; ') : '')
  if (!Object.keys(mcpServers).length) return { flags:[] as string[], context, close:async()=>{} }
  const directory = await mkdtemp(join(tmpdir(),'bgs-native-mcp-'))
  try {
    const path = join(directory,'servers.json')
    await writeFile(path,JSON.stringify({mcpServers}),{flag:'wx',mode:0o600})
    return { flags:['--mcp-config',path,
      // Only these host-bound read-only tools; external MCP permissions stay normal.
      ...(uiLayoutConstraints ? ['--allowedTools=' + NATIVE_READ_TOOLS.map(name => 'mcp__bgs-ui-layout__' + name).join(',')] : [])],
      context, close:()=>rm(directory,{recursive:true,force:true}) }
  } catch (error) { await rm(directory,{recursive:true,force:true}); throw error }
}
