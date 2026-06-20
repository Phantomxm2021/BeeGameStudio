import {
  appendWorkflowEvent,
  cancelRun,
  completeRun,
  createArtifact,
  failRun,
  requestRunPermission,
  updateRunPhase,
} from '@claude-code-best/agent-workflow'
import type { RuntimeEvent } from './types'

export function applyRuntimeEvent(runId: string, event: RuntimeEvent): void {
  switch (event.type) {
    case 'phase_started':
      updateRunPhase(runId, event.phase, 'running')
      return
    case 'phase_done':
      updateRunPhase(runId, event.phase, 'completed')
      return
    case 'agent_log':
      appendWorkflowEvent(runId, {
        type: 'agent.log',
        message: event.message,
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.agentName ? { agentName: event.agentName } : {}),
      })
      return
    case 'agent_progress':
      appendWorkflowEvent(runId, {
        type: 'agent.log',
        message: `Agent progress: ${event.tokenCount} tokens, ${event.toolCount} tools`,
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.agentName ? { agentName: event.agentName } : {}),
      })
      return
    case 'artifact_created':
      createArtifact({
        projectId: event.projectId,
        runId,
        kind: event.kind,
        title: event.title,
        ...(event.path ? { path: event.path } : {}),
        ...(event.url ? { url: event.url } : {}),
        ...(event.mimeType ? { mimeType: event.mimeType } : {}),
      })
      return
    case 'permission_requested':
      requestRunPermission(runId, {
        message: event.message,
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.agentName ? { agentName: event.agentName } : {}),
      })
      return
    case 'run_done':
      if (event.status === 'completed') {
        completeRun(runId, event.message ?? 'Workflow completed')
        return
      }
      if (event.status === 'canceled') {
        cancelRun(runId, event.message ?? 'Workflow canceled')
        return
      }
      failRun(runId, event.message ?? 'Workflow failed')
      return
  }
}
