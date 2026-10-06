import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { BeeGameSessionManager } from '../src/beegame/session-manager'

/** Standalone test harnesses have no Dashboard UI. Forward explicit console
 * decisions through its existing authority; never auto-approve or edit inputs. */
export function openProjectPermissionConsole(input: {
  sessions: Pick<BeeGameSessionManager, 'pendingPermissionsForProject' | 'resolvePermission'>
  userId: string
  projectId: string
  workspacePath: string
  stdin?: Readable
  report(event: { event: string; sessionId?: string; toolUseID?: string; toolName?: string; behavior?: string; reason?: string }): void
}) {
  const consoleInput = createInterface({ input: input.stdin ?? process.stdin, terminal: false })
  consoleInput.on('line', line => {
    if (!line.trim()) return
    let command: unknown
    try { command = JSON.parse(line) }
    catch { input.report({ event: 'permission_input_error', reason: 'invalid_json' }); return }
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      input.report({ event: 'permission_input_error', reason: 'invalid_decision' }); return
    }
    const value = command as Record<string, unknown>
    if (typeof value.sessionId !== 'string' || typeof value.toolUseID !== 'string' ||
        (value.behavior !== 'allow' && value.behavior !== 'deny') ||
        (value.message !== undefined && typeof value.message !== 'string')) {
      input.report({ event: 'permission_input_error', reason: 'invalid_decision' }); return
    }
    const permission = input.sessions.pendingPermissionsForProject(input.userId, input.projectId, input.workspacePath)
      .find(p => p.sessionId === value.sessionId && p.toolUseID === value.toolUseID)
    if (!permission) {
      input.report({ event: 'permission_input_error', reason: 'not_pending_in_this_project' }); return
    }
    try {
      input.sessions.resolvePermission(permission.sessionId, permission.toolUseID, {
        behavior: value.behavior, source: 'user', scope: 'once',
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
        ...(value.answers !== undefined ? { answers: value.answers } : {}),
      })
      input.report({ event: 'permission_resolved', sessionId: permission.sessionId,
        toolUseID: permission.toolUseID, toolName: permission.toolName, behavior: value.behavior })
    } catch {
      // Invalid question answers leave the request pending in the manager.
      // Never echo commands/answers or arbitrary exception details to stdout.
      input.report({ event: 'permission_input_error', reason: 'decision_not_resolved' })
    }
  })
  consoleInput.on('close', () => input.report({ event: 'permission_console_closed' }))
  return () => consoleInput.close()
}
