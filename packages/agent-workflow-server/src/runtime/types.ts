import type {
  ArtifactKind,
  GameProject,
  GameRun,
  RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'

export type RuntimeEvent =
  | {
      type: 'phase_started'
      phase: string
    }
  | {
      type: 'phase_done'
      phase: string
    }
  | {
      type: 'agent_log'
      message: string
      phase?: string
      agentName?: string
    }
  | {
      type: 'agent_progress'
      phase?: string
      agentName?: string
      tokenCount: number
      toolCount: number
    }
  | {
      type: 'artifact_created'
      projectId: string
      kind: ArtifactKind
      title: string
      path?: string
      url?: string
      mimeType?: string
    }
  | {
      type: 'permission_requested'
      message: string
      phase?: string
      agentName?: string
    }
  | {
      type: 'run_done'
      status: 'completed' | 'failed' | 'canceled'
      message?: string
    }

export type RuntimeStartInput = {
  project: GameProject
  run: GameRun
  runtime: RuntimeModelConfig
  emit(event: RuntimeEvent): void
}

export type RuntimeRunControlInput = {
  run: GameRun
  emit(event: RuntimeEvent): void
}

export type RuntimeAdapter = {
  startRun(input: RuntimeStartInput): Promise<void>
  cancelRun(input: RuntimeRunControlInput): Promise<void>
  retryRun(input: RuntimeRunControlInput): Promise<void>
  resumeRun(input: RuntimeRunControlInput): Promise<void>
}
