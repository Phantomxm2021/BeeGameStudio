import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import type { DashboardPermissionRequest, DashboardPermissionDecision } from '../beegame/session-manager'
import type { RpcObject } from './client'

export function elicitationAnswer(input: RpcObject, answers: unknown): RpcObject {
  if (input.mode === 'url') return { ...input, content: null }
  if (input.mode !== 'form' || !input.requestedSchema || input.requestedSchema.type !== 'object')
    throw Error('Unsupported MCP form')
  const encoded = (answers as RpcObject | undefined)?.content
  if (typeof encoded !== 'string') throw Error('Complete the MCP form before submitting')
  let content: unknown
  try { content = JSON.parse(encoded) } catch { throw Error('Invalid MCP form response') }
  // Validate against the server's original schema, never a schema from the browser.
  const validator = new AjvJsonSchemaValidator().getValidator(input.requestedSchema)
  if (!validator(content).valid) throw Error('MCP response does not match the requested form')
  return { ...input, content }
}

type ApprovalContext = {
  root: string
  filesystem: Record<string, string>
  networkEnabled: boolean
  items: Map<string, RpcObject>
  current(): boolean
  onDenied?(reason: string): void
  permission(request: DashboardPermissionRequest): Promise<DashboardPermissionDecision>
}

const contains = (parent: string, path: string) => {
  const part = relative(parent, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)
}

function canonical(path: string): string {
  try { return realpathSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(canonical(parent), relative(parent, path))
  }
}

/** A user approval cannot enlarge the host's filesystem boundary. Broad grants
 * containing a more restrictive child (AGENTS.md, .git, design records) fail. */
export function canGrantPath(context: Pick<ApprovalContext, 'root' | 'filesystem'>, path: unknown, write: boolean): boolean {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  const target = resolve(path)
  if (canonical(target) !== target) return false
  const entries = Object.entries(context.filesystem).filter(([key]) => isAbsolute(key))
  const permission = entries.filter(([key]) => contains(key, target)).sort((a, b) => b[0].length - a[0].length)[0]?.[1]
  const sufficient = (access: string | undefined) => write ? access === 'write' : access === 'read' || access === 'write'
  return sufficient(permission) && !entries.some(([key, access]) => contains(target, key) && !sufficient(access))
}

function boundedPermissions(context: ApprovalContext, profile: RpcObject): boolean {
  if (!profile || Object.keys(profile).some(key => !['fileSystem', 'network'].includes(key))) return false
  if (profile.network?.enabled === true && !context.networkEnabled) return false
  if (profile.network && Object.keys(profile.network).some(key => key !== 'enabled')) return false
  const fs = profile.fileSystem
  if (!fs) return true
  if (Object.keys(fs).some(key => !['read', 'write', 'entries', 'globScanMaxDepth'].includes(key))) return false
  for (const access of ['read', 'write']) {
    if (fs[access] != null && (!Array.isArray(fs[access]) || fs[access].some((path: unknown) => !canGrantPath(context, path, access === 'write')))) return false
  }
  if (fs.entries != null && (!Array.isArray(fs.entries) || fs.entries.some((entry: RpcObject) =>
    !['read', 'write'].includes(entry.access) || entry.path?.type !== 'path' || !canGrantPath(context, entry.path.path, entry.access === 'write')))) return false
  return true
}

export async function bgsApproval(method: string, p: RpcObject, context: ApprovalContext): Promise<RpcObject> {
  const permissions = method === 'item/permissions/requestApproval'
  const rejected = (reason = 'BGS denied the request because it cannot preserve the project permission boundary.') => {
    context.onDenied?.(reason)
    return permissions ? { permissions: {}, scope: 'turn' } : { decision: 'decline' }
  }
  let eligible = false
  if (permissions) eligible = boundedPermissions(context, p.permissions)
  else if (method === 'item/commandExecution/requestApproval') {
    // Legacy approvals without an overlay can rerun outside the sandbox. Only
    // scoped overlays and managed-network approvals preserve the host boundary.
    eligible = Boolean((p.networkApprovalContext && context.networkEnabled) || (p.additionalPermissions && (p.additionalPermissions.network?.enabled === true ||
      Object.values(p.additionalPermissions.fileSystem || {}).some(value => Array.isArray(value) && value.length > 0)) && boundedPermissions(context, p.additionalPermissions)))
    if (p.cwd && !canGrantPath(context, p.cwd, false)) eligible = false
    if (p.additionalPermissions && !boundedPermissions(context, p.additionalPermissions)) eligible = false
    if (p.availableDecisions && !p.availableDecisions.includes('accept')) eligible = false
  } else {
    const changes = context.items.get(p.itemId)?.changes
    eligible = !p.grantRoot && Array.isArray(changes) && changes.length > 0 && changes.every((change: RpcObject) =>
      canGrantPath(context, resolve(context.root, change.path), true) &&
      (!change.kind?.move_path || canGrantPath(context, resolve(context.root, change.kind.move_path), true)))
  }
  if (!context.current()) return rejected('BGS approval cancelled because the turn ended.')
  if (!eligible) return rejected()
  const item = context.items.get(p.itemId)
  const decision = await context.permission({
    toolUseID: p.approvalId || p.itemId,
    toolName: permissions ? 'BgsPermissions' : method.includes('commandExecution') ? 'BgsCommand' : 'BgsFileChange',
    message: p.reason || 'BGS requests approval',
    input: { command: p.command, cwd: p.cwd, permissions: p.permissions || p.additionalPermissions,
      network: p.networkApprovalContext, changes: item?.changes },
  })
  if (!context.current()) {
    rejected('BGS approval cancelled because the turn ended.')
    return permissions ? { permissions: {}, scope: 'turn' } : { decision: 'cancel' }
  }
  if (decision.behavior !== 'allow') return rejected(decision.message || 'BGS permission authority denied the request; no detailed reason was supplied.')
  // Recheck paths after a human wait, including symlinks changed in the meantime.
  if (permissions) return boundedPermissions(context, p.permissions) ? { permissions: p.permissions, scope: 'turn' } : rejected()
  if (p.additionalPermissions && !boundedPermissions(context, p.additionalPermissions)) return rejected()
  if (method === 'item/fileChange/requestApproval' && !item?.changes.every((change: RpcObject) =>
    canGrantPath(context, resolve(context.root, change.path), true) &&
    (!change.kind?.move_path || canGrantPath(context, resolve(context.root, change.kind.move_path), true)))) return rejected()
  return { decision: 'accept' }
}

export function webSearchTool(item: RpcObject, complete: boolean): RpcObject {
  const results = Array.isArray(item.results) ? item.results : []
  const output = results.map((result: RpcObject) => {
    const title = String(result.title || result.url || '').replace(/[\[\]\\]/g, '\\$&')
    let url: URL
    try { url = new URL(result.url) } catch { return String(result.snippet || result.text || '') }
    if (!['http:', 'https:'].includes(url.protocol)) return String(result.snippet || '')
    return `- [${title}](<${url.href}>)${result.snippet ? '\n  ' + result.snippet : ''}`
  }).join('\n')
  return { toolUseID: item.id, toolName: 'webSearch',
    input: { query: item.query, action: item.action },
    ...(complete ? { output, results } : {}) }
}
