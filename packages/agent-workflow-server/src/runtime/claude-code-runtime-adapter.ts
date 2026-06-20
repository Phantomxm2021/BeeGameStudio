import type {
  GameProject,
  GameRun,
  RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeRunControlInput,
  RuntimeStartInput,
} from './types'

export type ClaudeCodeRuntimeLaunchInput = {
  project: GameProject
  run: GameRun
  runtime: RuntimeModelConfig
  emit(event: RuntimeEvent): void
}

export type ClaudeCodeRuntimeControlInput = {
  run: GameRun
  emit(event: RuntimeEvent): void
}

export type ClaudeCodeRuntimeLauncher = {
  launch(input: ClaudeCodeRuntimeLaunchInput): Promise<void>
  cancel?(input: ClaudeCodeRuntimeControlInput): Promise<void>
  retry?(input: ClaudeCodeRuntimeControlInput): Promise<void>
  resume?(input: ClaudeCodeRuntimeControlInput): Promise<void>
}

export function createClaudeCodeRuntimeAdapter(
  launcher: ClaudeCodeRuntimeLauncher,
): RuntimeAdapter {
  return {
    async startRun(input: RuntimeStartInput) {
      await launcher.launch({
        project: input.project,
        run: input.run,
        runtime: input.runtime,
        emit: input.emit,
      })
    },
    async cancelRun(input: RuntimeRunControlInput) {
      if (!launcher.cancel) {
        throw new Error('Claude Code runtime does not support cancel')
      }
      await launcher.cancel({ run: input.run, emit: input.emit })
    },
    async retryRun(input: RuntimeRunControlInput) {
      if (!launcher.retry) {
        throw new Error('Claude Code runtime does not support retry')
      }
      await launcher.retry({ run: input.run, emit: input.emit })
    },
    async resumeRun(input: RuntimeRunControlInput) {
      if (!launcher.resume) {
        throw new Error('Claude Code runtime does not support resume')
      }
      await launcher.resume({ run: input.run, emit: input.emit })
    },
  }
}
