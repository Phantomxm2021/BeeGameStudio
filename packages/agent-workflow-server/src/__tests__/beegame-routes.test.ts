import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  createModelConfig,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import type {
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from '../beegame/session-manager'

type FakeRuntimeMode =
  | 'messages'
  | 'permission'
  | 'permission_twice'
  | 'permission_different_tool'
  | 'dangerous_bash_permission'
  | 'dangerous_bash_twice'
  | 'outside_permission'
  | 'workspace_root_permission'
  | 'outside_bash_permission'
  | 'ask_user_question_permission'
  | 'build_with_doc_reads_complete'
  | 'write_before_playable_spec'
  | 'write_after_playable_spec'
  | 'write_playable_spec_doc_absolute_path'
  | 'write_after_playable_spec_file'
  | 'bash_before_playable_spec'
  | 'bash_after_playable_spec'
  | 'planning_then_build'
  | 'planning_then_build_complete'
  | 'planning_then_build_with_quality_gates'
  | 'planning_then_build_with_markdown_quality_review'
  | 'build_with_invalid_quality_review'
  | 'planning_then_build_with_root_quality_gates'
  | 'build_with_quality_gates'
  | 'build_with_markdown_quality_review'
  | 'build_with_root_quality_gates'
  | 'planning_then_build_without_doc_reads'
  | 'planning_then_permission'
  | 'planning_then_permission_twice'
  | 'planning_then_permission_different_tool'
  | 'planning_then_dangerous_bash_permission'
  | 'planning_then_dangerous_bash_twice'
  | 'planning_docs_then_code_same_turn'
  | 'planning_docs_with_extra_markdown'
  | 'planning_messages_then_build_complete'
  | 'planning_unstructured_design_pack'
  | 'synthetic_user_message'
  | 'planning_wrong_project_design_doc'
  | 'planning_then_write_after_playable_spec'
  | 'planning_then_write_after_playable_spec_file'
  | 'planning_then_bash_after_playable_spec'
  | 'planning_then_workspace_root_permission'
  | 'build_without_doc_reads'
  | 'planning_marker_without_design_pack'
  | 'build_with_doc_reads'
  | 'build_only'

class FakeBeeGameRuntime {
  readonly submits: BeeGameSessionSubmitInput[] = []
  readonly stops: string[] = []
  readonly permissionResults: string[] = []

  constructor(
    private readonly cwd: string,
    private readonly messages: DashboardSDKMessage[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Acknowledged.' }] },
      },
      { type: 'result', result: 'Done' },
    ],
    private readonly mode: FakeRuntimeMode = 'messages',
  ) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    this.submits.push(input)
    if (this.mode === 'planning_messages_then_build_complete' && this.submits.length === 1) {
      await writeRequiredDesignPack(this.cwd, input)
      for (const message of this.messages) {
        if (input.signal.aborted) return
        input.onMessage(message)
      }
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Planning complete.\nPLAYABLE_SPEC_READY: yes' }],
        },
      })
      input.onMessage({ type: 'result', result: 'planning complete' })
      return
    }
    if (
      isTwoPhasePlanningMode(this.mode) &&
      this.mode !== 'planning_docs_then_code_same_turn' &&
      this.mode !== 'planning_docs_with_extra_markdown' &&
      this.mode !== 'planning_unstructured_design_pack' &&
      this.mode !== 'planning_marker_without_design_pack'
    ) {
      if (this.submits.length === 1) {
        await writeRequiredDesignPack(this.cwd, input)
        input.onMessage({
          type: 'assistant',
          message: {
            content: [{
              type: 'text',
              text: [
                '# Playable Spec',
                'Core Loop, Fun Hook, Skill Test, Risk/Reward, Failure Pressure, First 3 Minutes, MVP Acceptance.',
                'PLAYABLE_SPEC_READY: yes',
              ].join('\n'),
            }],
          },
        })
        input.onMessage({ type: 'result', result: 'planning complete' })
        return
      }
    }
    if (this.mode === 'build_with_doc_reads') {
      emitMandatoryDocReads(input)
      const decision = await input.requestPermission({
        toolUseID: 'tool_build_write',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `build ${decision.behavior}` })
      return
    }
    if (this.mode === 'build_with_doc_reads_complete') {
      emitMandatoryDocReads(input)
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Build complete.' }] },
      })
      input.onMessage({ type: 'result', result: 'build complete' })
      return
    }
    if (this.mode === 'build_with_quality_gates') {
      emitMandatoryDocReads(input)
      await writeBuildQualityGateArtifacts(this.cwd, input)
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Build complete with traceability evidence.' }] },
      })
      input.onMessage({ type: 'result', result: 'build complete with quality gates' })
      return
    }
    if (this.mode === 'build_with_root_quality_gates') {
      emitMandatoryDocReads(input)
      await writeBuildQualityGateArtifacts(this.cwd, input, '')
      input.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Build complete with root quality gates.' }] },
      })
      input.onMessage({ type: 'result', result: 'build complete with root quality gates' })
      return
    }
    if (this.mode === 'planning_docs_then_code_same_turn') {
      await writeRequiredDesignPack(this.cwd, input)
      const decision = await input.requestPermission({
        toolUseID: 'tool_same_turn_code_write',
        toolName: 'Write',
        message: 'Write code in the same planning turn?',
        input: {
          file_path: 'src/main.ts',
          content: 'console.log("too early")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `same turn code ${decision.behavior}` })
      return
    }
    if (this.mode === 'planning_docs_with_extra_markdown') {
      await writeRequiredDesignPack(this.cwd, input)
      const decision = await input.requestPermission({
        toolUseID: 'tool_extra_markdown_doc',
        toolName: 'Write',
        message: 'Write an extra planning markdown doc?',
        input: {
          file_path: 'docs/PLAYABILITY_CHECKLIST.md',
          content: '# Playability Checklist\n\nUse this during design review.',
        },
      })
      this.permissionResults.push(decision.behavior)
      if (decision.behavior === 'allow') {
        const fullPath = join(this.cwd, 'docs', 'PLAYABILITY_CHECKLIST.md')
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, '# Playability Checklist\n\nUse this during design review.', 'utf8')
      }
      input.onMessage({ type: 'result', result: `extra markdown ${decision.behavior}` })
      return
    }
    if (this.mode === 'planning_unstructured_design_pack') {
      await writeUnstructuredDesignPack(this.cwd, input)
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Unstructured design pack complete.\nPLAYABLE_SPEC_READY: yes',
          }],
        },
      })
      input.onMessage({ type: 'result', result: 'unstructured planning complete' })
      return
    }
    if (this.mode === 'synthetic_user_message') {
      await writeRequiredDesignPack(this.cwd, input)
      input.onMessage({
        type: 'user',
        isSynthetic: true,
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: 'This session is being continued from a previous conversation that ran out of context.',
          }],
        },
      })
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Planning complete.\nPLAYABLE_SPEC_READY: yes' }],
        },
      })
      input.onMessage({ type: 'result', result: 'planning done' })
      return
    }
    if (this.mode === 'planning_wrong_project_design_doc') {
      const wrongPath = join(dirname(this.cwd), 'other-game', 'docs', 'PLAYABLE_SPEC.md')
      const decision = await input.requestPermission({
        toolUseID: 'tool_wrong_project_design_doc',
        toolName: 'Write',
        message: 'Write design doc to another project?',
        input: {
          file_path: wrongPath,
          content: 'PLAYABLE_SPEC_READY: yes',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `wrong project ${decision.behavior}` })
      return
    }
    if (this.mode === 'build_without_doc_reads') {
      input.onMessage({ type: 'result', result: 'build ended without reading docs' })
      return
    }
    if (this.mode === 'build_with_markdown_quality_review') {
      emitMandatoryDocReads(input)
      await writeMarkdownBuildQualityGateArtifacts(this.cwd, input)
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Playable build verified with Markdown review.' }],
        },
      })
      input.onMessage({ type: 'result', result: 'build with markdown quality review complete' })
      return
    }
    if (this.mode === 'build_with_invalid_quality_review') {
      emitMandatoryDocReads(input)
      await writeTraceabilityArtifact(this.cwd, input)
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Build produced traceability but no playable loop review.' }],
        },
      })
      input.onMessage({ type: 'result', result: 'build with invalid quality review' })
      return
    }
    if (this.mode === 'planning_marker_without_design_pack') {
      if (input.prompt.includes('Repair the BeeGame design pack')) {
        await writeRequiredDesignPack(this.cwd, input)
        input.onMessage({
          type: 'assistant',
          message: {
            content: [{
              type: 'text',
              text: 'Design pack repaired.\nDESIGN_PACK_REPAIRED: yes',
            }],
          },
        })
        input.onMessage({ type: 'result', result: 'design pack repaired' })
        return
      }
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: [
              '# Playable Spec',
              'This is a short spec that declares readiness without writing required design artifacts.',
              'PLAYABLE_SPEC_READY: yes',
            ].join('\n'),
          }],
        },
      })
      input.onMessage({ type: 'result', result: 'planning marker only' })
      return
    }
    if (this.mode === 'build_only') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_build_write',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `build ${decision.behavior}` })
      return
    }
    if (
      this.mode === 'permission' ||
      this.mode === 'permission_twice' ||
      this.mode === 'permission_different_tool' ||
      this.mode === 'dangerous_bash_permission' ||
      this.mode === 'dangerous_bash_twice'
    ) {
      emitMandatoryDocReads(input)
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Playable Spec complete.\nPLAYABLE_SPEC_READY: yes',
          }],
        },
      })
      const decision = await input.requestPermission({
        toolUseID: 'tool_1',
        toolName: 'Bash',
        message: this.mode.startsWith('dangerous_bash')
          ? 'Allow Bash to remove dist?'
          : 'Allow Bash to run npm test?',
        input: {
          command: this.mode.startsWith('dangerous_bash')
            ? 'rm -rf dist'
            : 'npm test',
        },
      })
      this.permissionResults.push(decision.behavior)
      if (
        this.mode === 'permission_twice' ||
        this.mode === 'permission_different_tool' ||
        this.mode === 'dangerous_bash_twice'
      ) {
        const secondDecision = await input.requestPermission({
          toolUseID: 'tool_2',
          toolName: this.mode === 'permission_different_tool' ? 'Read' : 'Bash',
          message: this.mode === 'permission_different_tool'
            ? 'Allow Read?'
            : this.mode === 'dangerous_bash_twice'
              ? 'Allow Bash to chmod dist?'
              : 'Allow Bash to run npm run build?',
          input: this.mode === 'permission_different_tool'
            ? { file_path: 'src/index.ts' }
            : {
              command: this.mode === 'dangerous_bash_twice'
                ? 'chmod -R 755 dist'
                : 'npm run build',
            },
        })
        this.permissionResults.push(secondDecision.behavior)
      }
      await writeBuildQualityGateArtifacts(this.cwd, input)
      input.onMessage({ type: 'result', result: `permission ${decision.behavior}` })
      return
    }
    if (this.mode === 'outside_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_outside',
        toolName: 'Write',
        message: 'Write outside workspace?',
        input: { file_path: '/tmp/outside-workspace.txt' },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `outside ${decision.behavior}` })
      return
    }
    if (this.mode === 'workspace_root_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_workspace_root_write',
        toolName: 'Write',
        message: 'Write inside configured workspace root?',
        input: { file_path: join(dirname(this.cwd), 'existing-project', 'README.md') },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `workspace root ${decision.behavior}` })
      return
    }
    if (this.mode === 'outside_bash_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_outside_bash',
        toolName: 'Bash',
        message: 'List outside workspace?',
        input: {
          command: 'ls -la ../apps/frontend && find /tmp -maxdepth 1',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `outside bash ${decision.behavior}` })
      return
    }
    if (this.mode === 'ask_user_question_permission') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_question',
        toolName: 'AskUserQuestion',
        message: 'Ask the user which game mode to build.',
        input: {
          question: '你想做单人还是双人模式？',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `question ${decision.behavior}` })
      return
    }
    if (this.mode === 'write_before_playable_spec') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_before_spec',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write before spec ${decision.behavior}` })
      return
    }
    if (this.mode === 'write_after_playable_spec') {
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Playable Spec complete.\nPLAYABLE_SPEC_READY: yes',
          }],
        },
      })
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_after_spec',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: 'snake-game/src/main.ts',
          content: 'console.log("snake")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write after spec ${decision.behavior}` })
      return
    }
    if (this.mode === 'write_playable_spec_doc_absolute_path') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_playable_spec_doc',
        toolName: 'Write',
        message: 'Write Playable Spec doc?',
        input: {
          file_path: join(this.cwd, 'docs', 'PLAYABLE_SPEC.md'),
          content: [
            '# Playable Spec',
            'Core Loop',
            'Fun Hook',
            'Skill Test',
            'Risk/Reward',
            'Failure Pressure',
            'First 3 Minutes',
            'MVP Acceptance',
            'Playability Acceptance Checklist',
            'PLAYABLE_SPEC_READY: yes',
          ].join('\n'),
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write playable spec ${decision.behavior}` })
      return
    }
    if (this.mode === 'write_after_playable_spec_file') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_write_after_spec_file',
        toolName: 'Write',
        message: 'Write game files?',
        input: {
          file_path: join(this.cwd, 'game', 'src', 'main.ts'),
          content: 'console.log("game")',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `write after spec file ${decision.behavior}` })
      return
    }
    if (this.mode === 'bash_before_playable_spec') {
      const decision = await input.requestPermission({
        toolUseID: 'tool_bash_before_spec',
        toolName: 'Bash',
        message: 'Run setup command?',
        input: {
          command: 'npm create vite@latest snake-game -- --template react-ts',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `bash before spec ${decision.behavior}` })
      return
    }
    if (this.mode === 'bash_after_playable_spec') {
      input.onMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Playable Spec complete.\nPLAYABLE_SPEC_READY: yes',
          }],
        },
      })
      const decision = await input.requestPermission({
        toolUseID: 'tool_bash_after_spec',
        toolName: 'Bash',
        message: 'Run setup command?',
        input: {
          command: 'npm create vite@latest snake-game -- --template react-ts',
        },
      })
      this.permissionResults.push(decision.behavior)
      input.onMessage({ type: 'result', result: `bash after spec ${decision.behavior}` })
      return
    }

    for (const message of this.messages) {
      if (input.signal.aborted) return
      input.onMessage(message)
    }
  }

  stop(): void {
    this.stops.push('stop')
  }
}

async function writeRequiredDesignPack(
  cwd: string,
  input: BeeGameSessionSubmitInput,
): Promise<void> {
  const requiredDocs = [
    {
      path: 'docs/PLAYABLE_SPEC.md',
      content: [
        '# Playable Spec',
        '## Core Loop',
        'Observe, decide, act, receive feedback, and retry.',
        '## Fun Hook',
        'A single clear mechanic creates replay tension.',
        '## Skill Test',
        'The player must make a readable decision under pressure.',
        '## Risk/Reward',
        'The player can choose safe progress or risky high-value play.',
        '## Failure Pressure',
        'A clear timer, threat, or resource limit creates urgency.',
        '## First 3 Minutes',
        'The player learns, makes a decision, and sees a result quickly.',
        '## MVP Acceptance',
        'The first playable is small but complete.',
        'PLAYABLE_SPEC_READY: yes',
      ].join('\n'),
    },
    {
      path: 'docs/GDD.md',
      content: [
        '# GDD',
        '## Player Promise',
        'A focused playable promise.',
        '## Core Loop',
        'Observe, decide, act, receive feedback, and retry.',
        '## First Minute',
        'The player understands the goal and makes one meaningful choice.',
        '## Win Lose Rules',
        'The game has explicit success and failure conditions.',
      ].join('\n'),
    },
    {
      path: 'docs/TECH_DESIGN.md',
      content: [
        '# Tech Design',
        '## Runtime Architecture',
        'Scene, input, simulation, feedback, and UI modules are separated.',
        '## State Model',
        'Game state tracks player, objective, score, fail state, and restart.',
        '## Build Validation',
        'The build command must run before completion.',
      ].join('\n'),
    },
    {
      path: 'docs/ART_AUDIO_DIRECTION.md',
      content: [
        '# Art Audio Direction',
        '## Visual Language',
        'Readable shapes, strong contrast, and clear target markers.',
        '## Feedback VFX',
        'Hits, misses, progress, and danger have visible effects.',
        '## Audio Cues',
        'Actions, success, failure, and pressure have placeholder cues.',
      ].join('\n'),
    },
    {
      path: 'docs/RESOURCE_PLACEHOLDERS.md',
      content: [
        '# Resource Placeholders',
        '## Placeholder Assets',
        'List every temporary asset used by the playable build.',
        '## VFX Slots',
        'Hit, goal, danger, and completion effects are reserved.',
        '## SFX Slots',
        'Input, hit, score, fail, and restart sounds are reserved.',
      ].join('\n'),
    },
    {
      path: 'docs/LEVEL_TUNING.md',
      content: [
        '# Level Tuning',
        '## Level Layout',
        'The first level creates a clear path, obstacle, and decision point.',
        '## Difficulty Curve',
        'Pressure rises after the player learns the first action.',
        '## Replay Target',
        'A score, timer, or mastery target encourages retry.',
      ].join('\n'),
    },
    {
      path: 'docs/PLAYABILITY_ACCEPTANCE.md',
      content: [
        '# Playability Acceptance',
        '## Clarity 30s',
        'Goal, controls, and feedback are understandable within 30 seconds.',
        '## Interesting Decision 60s',
        'The player makes a meaningful decision within 60 seconds.',
        '## Responsive Input',
        'Core input responds immediately.',
        '## Readable Feedback',
        'The player sees progress, result, and failure feedback.',
        '## Failure Pressure',
        'There is a fail state or escalating pressure.',
        '## Replayable Challenge',
        'The player has a reason to retry and improve.',
      ].join('\n'),
    },
  ]

  for (const doc of requiredDocs) {
    const fullPath = join(cwd, doc.path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, doc.content, 'utf8')
    await input.requestPermission({
      toolUseID: `tool_design_${doc.path.replaceAll('/', '_')}`,
      toolName: 'Write',
      message: `Write ${doc.path}`,
      input: {
        file_path: doc.path,
        content: doc.content,
      },
    })
  }
}

async function writeBuildQualityGateArtifacts(
  cwd: string,
  input: BeeGameSessionSubmitInput,
  artifactDir = 'docs',
): Promise<void> {
  const artifactPath = (filename: string) => artifactDir ? join(artifactDir, filename) : filename
  const artifacts = [
    {
      path: artifactPath('traceability_matrix.json'),
      content: JSON.stringify({
        version: 1,
        mappings: [
          {
            requirementId: 'core_loop',
            implementation: ['src/store/gameStore.ts', 'src/components/MainScreen.tsx'],
            verification: ['bun test', 'manual playable-loop review'],
            status: 'implemented',
          },
          {
            requirementId: 'readable_feedback',
            implementation: ['src/components/GameBoard.tsx'],
            verification: ['manual playable-loop review'],
            status: 'implemented',
          },
        ],
      }, null, 2),
    },
    {
      path: artifactPath('playable_loop_review.md'),
      content: [
        '# Playable Loop Review',
        '',
        'verdict: pass',
        'start: pass',
        'player_action: pass',
        'feedback: pass',
        'pressure: pass',
        'terminal_state: pass',
        '',
        'Command results: bun test and bun run build passed.',
      ].join('\n'),
    },
  ]
  for (const artifact of artifacts) {
    await input.requestPermission({
      toolUseID: `quality_${artifact.path}`,
      toolName: 'Write',
      message: `Write ${artifact.path}?`,
      input: { file_path: artifact.path, content: artifact.content },
    })
    await mkdir(join(cwd, dirname(artifact.path)), { recursive: true })
    await writeFile(join(cwd, artifact.path), artifact.content, 'utf8')
  }
}

async function writeMarkdownBuildQualityGateArtifacts(
  cwd: string,
  input: BeeGameSessionSubmitInput,
): Promise<void> {
  const artifacts = [
    {
      path: 'docs/traceability_matrix.json',
      content: JSON.stringify({
        version: 1,
        mappings: [
          {
            requirementId: 'core_loop',
            implementation: ['src/store/gameStore.ts'],
            verification: ['bun run build'],
            status: 'implemented',
          },
        ],
      }, null, 2),
    },
    {
      path: 'docs/playable_loop_review.md',
      content: [
        '# Playable Loop Review',
        '',
        'verdict: pass',
        '',
        '## Evidence',
        '- start: pass - The game reaches a playable start state.',
        '- player_action: pass - Core input changes game state.',
        '- feedback: pass - The player sees clear result feedback.',
        '- pressure: pass - Challenge pressure advances during play.',
        '- terminal_state: pass - Win/loss and restart are available.',
      ].join('\n'),
    },
  ]
  for (const artifact of artifacts) {
    await input.requestPermission({
      toolUseID: `quality_markdown_${artifact.path}`,
      toolName: 'Write',
      message: `Write ${artifact.path}?`,
      input: { file_path: artifact.path, content: artifact.content },
    })
    await mkdir(join(cwd, dirname(artifact.path)), { recursive: true })
    await writeFile(join(cwd, artifact.path), artifact.content, 'utf8')
  }
}

async function writeTraceabilityArtifact(
  cwd: string,
  input: BeeGameSessionSubmitInput,
): Promise<void> {
  const artifactPath = 'traceability_matrix.json'
  const content = JSON.stringify({
    version: 1,
    mappings: [
      {
        requirementId: 'core_loop',
        implementation: ['src/store/gameStore.ts'],
        verification: ['bun run build'],
        status: 'implemented',
      },
    ],
  }, null, 2)
  await input.requestPermission({
    toolUseID: 'quality_traceability_only',
    toolName: 'Write',
    message: `Write ${artifactPath}?`,
    input: { file_path: artifactPath, content },
  })
  await writeFile(join(cwd, artifactPath), content, 'utf8')
}

async function writeUnstructuredDesignPack(
  cwd: string,
  input: BeeGameSessionSubmitInput,
): Promise<void> {
  const docs = [
    {
      path: 'docs/PLAYABLE_SPEC.md',
      content: [
        '# Playable planning notes',
        'The playable build describes repeated player activity, why the interaction is interesting, how skill is tested, how pressure appears, and what the first playable must prove.',
        'PLAYABLE_SPEC_READY: yes',
      ].join('\n'),
    },
    {
      path: 'docs/GDD.md',
      content: [
        '# Design notes',
        'This file describes the player promise, repeated play pattern, opening moment, and how success or failure is decided without using fixed section labels.',
      ].join('\n'),
    },
    {
      path: 'docs/TECH_DESIGN.md',
      content: [
        '# Technical notes',
        'Runtime structure, state ownership, and build validation are described in prose.',
      ].join('\n'),
    },
    {
      path: 'docs/ART_AUDIO_DIRECTION.md',
      content: [
        '# Presentation notes',
        'Visual language, feedback effects, and audio cues are described in prose.',
      ].join('\n'),
    },
    {
      path: 'docs/RESOURCE_PLACEHOLDERS.md',
      content: [
        '# Resource notes',
        'Temporary assets, visual effect slots, and sound slots are described in prose.',
      ].join('\n'),
    },
    {
      path: 'docs/LEVEL_TUNING.md',
      content: [
        '# Tuning notes',
        'Layout, rising difficulty, and a replay target are described in prose.',
      ].join('\n'),
    },
    {
      path: 'docs/PLAYABILITY_ACCEPTANCE.md',
      content: [
        '# Acceptance notes',
        'The playable acceptance criteria describe early clarity, an early meaningful decision, responsive input, readable feedback, pressure, and replay value in prose.',
      ].join('\n'),
    },
  ]
  for (const doc of docs) {
    await input.requestPermission({
      toolUseID: `unstructured_${doc.path}`,
      toolName: 'Write',
      message: `Write ${doc.path}?`,
      input: { file_path: doc.path, content: doc.content },
    })
    await mkdir(join(cwd, dirname(doc.path)), { recursive: true })
    await writeFile(join(cwd, doc.path), doc.content)
  }
}

function emitMandatoryDocReads(input: BeeGameSessionSubmitInput): void {
  const paths = [
    'BEEGAME_PLAYABLE_SPEC.md',
    'docs/PLAYABLE_SPEC.md',
    'docs/GDD.md',
    'docs/TECH_DESIGN.md',
    'docs/ART_AUDIO_DIRECTION.md',
    'docs/RESOURCE_PLACEHOLDERS.md',
    'docs/LEVEL_TUNING.md',
    'docs/PLAYABILITY_ACCEPTANCE.md',
  ]
  for (const [index, path] of paths.entries()) {
    const toolUseID = `tool_read_doc_${index}`
    input.onMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: toolUseID,
          name: 'Read',
          input: { file_path: path },
        }],
      },
    })
    input.onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: 'doc',
        }],
      },
    })
  }
}

function createFakeRunner(
  messages?: DashboardSDKMessage[],
  mode?: FakeRuntimeMode,
): {
  starts: BeeGameSessionRunnerStartInput[]
  runtimes: FakeBeeGameRuntime[]
  runner: BeeGameSessionRunner
} {
  const defaultMode = mode ?? (messages ? 'messages' : 'planning_then_build_with_quality_gates')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runtimes: FakeBeeGameRuntime[] = []
  return {
    starts,
    runtimes,
    runner: {
      async start(input) {
        starts.push(input)
        const runtimeMode = runtimes.length > 0
          ? getSecondRuntimeMode(defaultMode)
          : defaultMode
        const runtime = new FakeBeeGameRuntime(input.cwd, messages, runtimeMode)
        runtimes.push(runtime)
        return runtime
      },
    },
  }
}

function createSequencedFakeRunner(
  modes: FakeRuntimeMode[],
): {
  starts: BeeGameSessionRunnerStartInput[]
  runtimes: FakeBeeGameRuntime[]
  runner: BeeGameSessionRunner
} {
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runtimes: FakeBeeGameRuntime[] = []
  return {
    starts,
    runtimes,
    runner: {
      async start(input) {
        starts.push(input)
        const mode = modes[runtimes.length] ?? modes[modes.length - 1] ?? 'messages'
        const runtime = new FakeBeeGameRuntime(input.cwd, undefined, mode)
        runtimes.push(runtime)
        return runtime
      },
    },
  }
}

function getTestTranscriptPath(root: string, workspace: string, sessionId: string): string {
  const projectName = basename(workspace)
  const sessionHash = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return join(
    root,
    '.beegame-dashboard',
    'transcripts',
    projectName,
    `${projectName}__${sessionHash}.jsonl`,
  )
}

function isTwoPhasePlanningMode(mode: FakeRuntimeMode): boolean {
  return getSecondRuntimeMode(mode) !== mode
}

function getSecondRuntimeMode(mode: FakeRuntimeMode): FakeRuntimeMode {
  switch (mode) {
    case 'planning_then_build':
      return 'build_with_doc_reads'
    case 'planning_then_build_complete':
      return 'build_with_doc_reads_complete'
    case 'planning_messages_then_build_complete':
    case 'synthetic_user_message':
      return 'build_with_quality_gates'
    case 'planning_then_build_with_quality_gates':
      return 'build_with_quality_gates'
    case 'planning_then_build_with_markdown_quality_review':
      return 'build_with_markdown_quality_review'
    case 'planning_then_build_with_root_quality_gates':
      return 'build_with_root_quality_gates'
    case 'planning_docs_then_code_same_turn':
    case 'planning_unstructured_design_pack':
    case 'planning_marker_without_design_pack':
      return 'build_with_doc_reads'
    case 'planning_then_build_without_doc_reads':
      return 'build_without_doc_reads'
    case 'planning_then_permission':
      return 'permission'
    case 'planning_then_permission_twice':
      return 'permission_twice'
    case 'planning_then_permission_different_tool':
      return 'permission_different_tool'
    case 'planning_then_dangerous_bash_permission':
      return 'dangerous_bash_permission'
    case 'planning_then_dangerous_bash_twice':
      return 'dangerous_bash_twice'
    case 'planning_then_write_after_playable_spec':
      return 'write_after_playable_spec'
    case 'planning_then_write_after_playable_spec_file':
      return 'write_after_playable_spec_file'
    case 'planning_then_bash_after_playable_spec':
      return 'bash_after_playable_spec'
    case 'planning_then_workspace_root_permission':
      return 'workspace_root_permission'
    default:
      return mode
  }
}

async function createConfiguredProjectWorkspace(): Promise<{
  projectsRoot: string
  workspace: string
}> {
  const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
  const workspace = join(projectsRoot, 'current-project')
  await mkdir(workspace, { recursive: true })
  return { projectsRoot, workspace }
}

describe('beegame session routes', () => {
  const legacyRuntimeEnvPrefix = ['CLAU', 'DE_CODE_USE_'].join('')

  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('creates a dashboard session without starting a BeeGame turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    const model = createModelConfig('dashboard-local', {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })

    try {
      const res = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })

      expect(res.status).toBe(200)
      const session = await res.json()
      expect(session.status).toBe('running')
      expect(session.turnStatus).toBe('idle')
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects relative workspace paths before creating a runner', async () => {
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })

    const res = await app.request('/api/console/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: './WO' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Workspace path must be absolute',
    })
    expect(fake.starts).toHaveLength(0)
  })

  test('rejects workspace paths outside the configured Projects directory', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'beegame-outside-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const resolvedProjectsRoot = await realpath(projectsRoot)
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: outsideRoot }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: `Workspace path must stay inside the default Projects directory: ${resolvedProjectsRoot}`,
      })
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  test('creates a missing project workspace directory inside the configured Projects directory', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'snake-web')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })

    try {
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })

      expect(res.status).toBe(200)
      expect((await stat(workspace)).isDirectory()).toBe(true)
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('rejects starting a BeeGame session directly in the default Projects root', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })

    try {
      const resolvedProjectsRoot = await realpath(projectsRoot)
      const res = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: projectsRoot }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: `Workspace path must target a project directory under the default Projects directory, not the Projects root: ${resolvedProjectsRoot}`,
      })
      expect(fake.starts).toHaveLength(0)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('sends input through a structured BeeGame session runner', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'game-one')
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    const model = createModelConfig('dashboard-local', {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/console/sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Build a tiny puzzle game.' }),
        },
      )

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/console/sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })
      const resolvedWorkspace = await realpath(workspace)

      expect(inputRes.status).toBe(200)
      expect(fake.starts).toEqual([
        expect.objectContaining({
          sessionId: session.id,
          cwd: resolvedWorkspace,
          env: expect.objectContaining({
            BEEGAME_CONFIG_DIR: expect.stringContaining('.beegame'),
            BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
            CLAUDE_CONFIG_DIR: expect.stringContaining('.beegame'),
            [`${legacyRuntimeEnvPrefix}OPENAI`]: '1',
            OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-dashboard-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          }),
        }),
        expect.objectContaining({
          sessionId: session.id,
          cwd: resolvedWorkspace,
          env: expect.objectContaining({
            BEEGAME_CONFIG_DIR: expect.stringContaining('.beegame'),
            BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
            CLAUDE_CONFIG_DIR: expect.stringContaining('.beegame'),
            [`${legacyRuntimeEnvPrefix}OPENAI`]: '1',
            OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-dashboard-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          }),
        }),
      ])
      expect(fake.runtimes[0].submits[0].prompt).toBe(
        'Build a tiny puzzle game.',
      )

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining([
          'session.started',
          'runtime.observation',
          'turn.started',
          'workflow.pipeline',
          'workflow.phase',
          'user.message',
          'system.status',
          'assistant.message',
          'result',
          'verification.required',
          'turn.completed',
        ]),
      )
      expect(events.find((event: { type: string }) => event.type === 'runtime.observation')).toEqual(
        expect.objectContaining({
          type: 'runtime.observation',
          text: 'BeeGame runtime observability updated',
          payload: expect.objectContaining({
            type: 'runtime.observation',
            features: expect.arrayContaining([
              expect.objectContaining({ id: 'CONTEXT_COLLAPSE' }),
              expect.objectContaining({ id: 'HISTORY_SNIP' }),
              expect.objectContaining({ id: 'TOKEN_BUDGET' }),
              expect.objectContaining({ id: 'MONITOR_TOOL' }),
            ]),
          }),
        }),
      )
      expect(events.find((event: { type: string }) => event.type === 'assistant.message')).toEqual(
        expect.objectContaining({
          type: 'assistant.message',
          text: expect.stringContaining('PLAYABLE_SPEC_READY: yes'),
        }),
      )
      const transcriptDir = join(projectsRoot, '.beegame-dashboard', 'transcripts')
      const transcriptProjects = await readdir(transcriptDir)
      expect(transcriptProjects).toEqual(['game-one'])
      const transcriptFiles = await readdir(join(transcriptDir, 'game-one'))
      expect(transcriptFiles).toHaveLength(1)
      expect(transcriptFiles[0]).toMatch(/^game-one__[a-f0-9]{8}\.jsonl$/)
      expect(transcriptFiles[0]).not.toBe(`${session.id}.jsonl`)
      const transcript = await readFile(
        join(transcriptDir, 'game-one', transcriptFiles[0]),
        'utf8',
      )
      await expect(stat(join(workspace, '.beegame-dashboard'))).rejects.toThrow()
      const transcriptEvents = transcript
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { type: string; text: string })
      expect(transcriptEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user.message',
            text: 'Build a tiny puzzle game.',
          }),
          expect.objectContaining({
            type: 'assistant.message',
            text: expect.stringContaining('PLAYABLE_SPEC_READY: yes'),
          }),
        ]),
      )
      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const transcriptRes = await restartedApp.request(
        `/api/beegame-sessions/${session.id}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )
      expect(transcriptRes.status).toBe(200)
      expect(await transcriptRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.message',
            text: expect.stringContaining('PLAYABLE_SPEC_READY: yes'),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('supports beegame-sessions routes while keeping console routes compatible', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/beegame-sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Say hello.' }),
        },
      )
      expect(inputRes.status).toBe(200)
      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'assistant.message',
      )

      const compatibilityRes = await app.request(
        `/api/console/sessions/${session.id}`,
      )
      expect(compatibilityRes.status).toBe(200)
      expect(await compatibilityRes.json()).toEqual(
        expect.objectContaining({ id: session.id }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('maps SDK tool use and result messages to dashboard tool events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_bash_1',
              name: 'Bash',
              input: { command: 'npm test' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_bash_1',
              content: 'tests passed',
            },
          ],
        },
      },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'tool.started',
      )
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'tool.completed',
      )
      expect(
        events.find((event: { type: string }) => event.type === 'tool.started'),
      ).toEqual(
        expect.objectContaining({
          text: 'Bash',
          payload: expect.objectContaining({
            toolUseID: 'tool_bash_1',
            toolName: 'Bash',
            input: { command: 'npm test' },
          }),
        }),
      )
      expect(
        events.find(
          (event: { type: string }) => event.type === 'tool.completed',
        ),
      ).toEqual(
        expect.objectContaining({
          text: 'Bash completed',
          payload: expect.objectContaining({
            toolUseID: 'tool_bash_1',
            toolName: 'Bash',
            output: 'tests passed',
          }),
        }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('filters raw SDK stream protocol events from visible message events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'private reasoning' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"command"' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: null },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Visible answer.' },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'hidden final thinking' },
            { type: 'text', text: 'Final text.' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_write_1',
              name: 'Write',
              input: { file_path: 'game.ts', content: 'export {}' },
            },
          ],
        },
      },
    ])
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Respond cleanly.' }),
      })

      await waitFor(() => fake.runtimes[0]?.submits.length === 1)

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'content_block_start',
      )
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'thinking_delta',
      )
      expect(events.map((event: { text: string }) => event.text)).not.toContain(
        'input_json_delta',
      )
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.partial',
            text: 'Visible answer.',
          }),
          expect.objectContaining({
            type: 'assistant.message',
            text: 'Final text.',
          }),
          expect.objectContaining({
            type: 'tool.started',
            text: 'Write',
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('sanitizes legacy branding from dashboard events and payloads', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const legacyTitle = ['Clau', 'de'].join('')
    const legacyLower = ['clau', 'de'].join('')
    const legacyPath = join(
      workspace,
      `${legacyLower}-code-main`,
      'Projects',
      'game.ts',
    )
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: `${legacyTitle} Code created this in ${legacyPath}. Run ${legacyLower} snake.`,
          }],
          [`${legacyLower}_code_version`]: '2.8.0',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_path',
            name: 'Write',
            input: {
              file_path: legacyPath,
              command: `cd ${legacyPath} && ${legacyLower} status`,
            },
          }],
        },
      },
      { type: 'result', result: `${legacyTitle} finished` },
    ], 'planning_messages_then_build_complete')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'make a game' }),
      })
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const serialized = JSON.stringify(await eventsRes.json())
      expect(serialized).not.toContain(legacyTitle)
      expect(serialized).toContain(
        `BeeGame created this in ${legacyPath}. Run BeeGame snake.`,
      )
      expect(serialized).toContain('beegame_version')
      expect(serialized).toContain(`"file_path":"${legacyPath}"`)
      expect(serialized).toContain(`cd ${legacyPath} && ${legacyLower} status`)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('stops a running dashboard session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a tiny puzzle game.' }),
      })
      await waitFor(() => fake.runtimes.length === 1)

      const stopRes = await app.request(
        `/api/console/sessions/${session.id}/stop`,
        { method: 'POST' },
      )

      expect(stopRes.status).toBe(200)
      expect(fake.runtimes[0].stops).toEqual(['stop'])
      expect(await stopRes.json()).toEqual(
        expect.objectContaining({ status: 'stopped', turnStatus: 'idle' }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('keeps a turn running until a dashboard permission is approved', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'planning_then_dangerous_bash_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/console/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/console/sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string }) => event.type === 'permission.requested',
        )
      })

      let sessionStateRes = await app.request(
        `/api/console/sessions/${session.id}`,
      )
      expect(await sessionStateRes.json()).toEqual(
        expect.objectContaining({ turnStatus: 'running' }),
      )

      const resolveRes = await app.request(
        `/api/console/sessions/${session.id}/permissions/tool_1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        },
      )

      expect(resolveRes.status).toBe(200)
      await waitFor(() => fake.runtimes[1]?.permissionResults[0] === 'allow')
      await waitFor(async () => {
        sessionStateRes = await app.request(
          `/api/console/sessions/${session.id}`,
        )
        const sessionState = await sessionStateRes.json()
        return sessionState.turnStatus === 'idle'
      })

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toContain(
        'permission.resolved',
      )
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'result', text: 'permission allow' }),
      ]))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not reuse remembered approval for a different Bash command', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'planning_then_dangerous_bash_twice')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run tests.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_1',
        )
      })

      const resolveRes = await app.request(
        `/api/beegame-sessions/${session.id}/permissions/tool_1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow', remember: true }),
        },
      )
      expect(resolveRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(
          `/api/beegame-sessions/${session.id}/events`,
        )
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_2',
        )
      })
      expect(fake.runtimes[1].permissionResults).toEqual(['allow'])

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      const permissionRequests = events.filter(
        (event: { type: string }) => event.type === 'permission.requested',
      )
      expect(permissionRequests).toHaveLength(2)
      expect(
        events.some(
          (event: { type: string; payload?: { toolUseID?: string; autoApproved?: boolean } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_2' &&
            event.payload?.autoApproved === true,
        ),
      ).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-approves low-risk build and test Bash commands inside the BeeGame workspace', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_permission_twice')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run project validation.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return fake.runtimes[1]?.permissionResults.length === 2 ||
          events.some((event: { type: string }) => event.type === 'permission.requested')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual(['allow', 'allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
            toolUseID: 'tool_1',
            toolName: 'Bash',
            autoApproved: true,
          }),
        }),
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
            toolUseID: 'tool_2',
            toolName: 'Bash',
            autoApproved: true,
          }),
        }),
      ]))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves project-local implementation writes during build', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_write_after_playable_spec')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Implement game files.' }),
      })

      await waitFor(() => fake.runtimes[1]?.permissionResults.length === 1)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual(['allow'])
      expect(events.filter((event: { type: string }) => event.type === 'permission.requested')).toHaveLength(0)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'permission.resolved',
          payload: expect.objectContaining({
            toolUseID: 'tool_write_after_spec',
            toolName: 'Write',
            autoApproved: true,
          }),
        }),
      ]))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-approves low-risk Bash and read-only tools without remember prompts', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_permission_different_tool')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run and inspect.' }),
      })

      await waitFor(() => fake.runtimes[1]?.permissionResults.length === 2)
      expect(fake.runtimes[1].permissionResults).toEqual(['allow', 'allow'])

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.filter((event: { type: string }) => event.type === 'permission.requested'),
      ).toHaveLength(0)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_2',
              toolName: 'Read',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('emits workflow block instead of permission resolution before a Playable Spec exists', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'write_before_playable_spec')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game immediately.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'workflow.blocked')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('Playable Spec'),
            payload: expect.objectContaining({
              phase: 'planning',
              blockedToolName: 'Write',
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.resolved')).toBe(false)
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('starts build phase after planning marker and then uses normal permissions', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'First produce a Playable Spec for snake.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_build_write',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].submits[0].prompt).toBe('First produce a Playable Spec for snake.')
      expect(fake.runtimes[1].submits[0].prompt).toContain('Now implement the approved playable spec')
      expect(fake.starts.length).toBeGreaterThanOrEqual(2)
      expect(fake.runtimes[1].submits[0].prompt).toContain('BEEGAME_PLAYABLE_SPEC.md')
      expect(fake.runtimes[1].submits[0].prompt).toContain('traceability_matrix.json')
      expect(fake.runtimes[1].submits[0].prompt).toContain('playable_loop_review.md')
      expect(fake.runtimes[1].submits[0].prompt).toContain(
        'Do not write ./BEEGAME_PLAYABILITY_REVIEW.md yourself',
      )
      expect(fake.runtimes[1].submits[0].prompt).not.toContain('Core Loop, Fun Hook, Skill Test')
      await expect(readFile(join(workspace, 'BEEGAME_PLAYABLE_SPEC.md'), 'utf8')).resolves.toContain(
        'PLAYABLE_SPEC_READY: yes',
      )
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.pipeline',
            payload: expect.objectContaining({
              currentPhase: 'implementation',
              stages: expect.arrayContaining([
                expect.objectContaining({ id: 'idea_intake', status: 'completed' }),
                expect.objectContaining({ id: 'gdd', label: 'Playable Spec', status: 'completed' }),
                expect.objectContaining({ id: 'implementation', status: 'active' }),
                expect.objectContaining({ id: 'qa', label: 'Playability Review', status: 'pending' }),
              ]),
            }),
          }),
          expect.objectContaining({
            type: 'workflow.phase',
            text: 'planning',
          }),
          expect.objectContaining({
            type: 'assistant.message',
            text: expect.stringContaining('PLAYABLE_SPEC_READY: yes'),
          }),
          expect.objectContaining({
            type: 'workflow.phase',
            text: 'building',
          }),
          expect.objectContaining({
            type: 'verification.required',
            text: 'BeeGame playability verification is required',
            payload: expect.objectContaining({
              artifactPath: 'BEEGAME_PLAYABILITY_REVIEW.md',
              checks: expect.arrayContaining([
                expect.objectContaining({ id: 'clarity_30s' }),
                expect.objectContaining({ id: 'interesting_decision_60s' }),
                expect.objectContaining({ id: 'failure_pressure' }),
              ]),
            }),
          }),
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_build_write',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not mark BeeGame complete when build lacks traceability and playable loop review artifacts', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build_complete')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a playable game from the spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; text?: string }) =>
            event.type === 'workflow.blocked' &&
            String(event.text || '').includes('traceability_matrix.json'),
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(events.some((event: { type: string }) => event.type === 'turn.completed')).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('traceability_matrix.json'),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('generates verifier-owned playability review only after traceability and loop review pass', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build_with_quality_gates')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a playable game from the spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const review = await readFile(join(workspace, 'BEEGAME_PLAYABILITY_REVIEW.md'), 'utf8')
      expect(review).toContain('Generated by BeeGame playable loop verifier')
      expect(review).toContain('PLAYABILITY_CHECKS_PASSED: yes')
      expect(review).toContain('traceability_matrix.json')
      expect(review).toContain('playable_loop_review.md')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('accepts markdown playable loop review when it carries required structured evidence', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build_with_markdown_quality_review')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a playable game from the spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const review = await readFile(join(workspace, 'BEEGAME_PLAYABILITY_REVIEW.md'), 'utf8')
      expect(review).toContain('PLAYABILITY_CHECKS_PASSED: yes')
      expect(review).toContain('playable_loop_review')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('continues a paused build quality gate in build phase instead of restarting planning', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createSequencedFakeRunner([
      'planning_then_build',
      'build_with_invalid_quality_review',
      'build_with_invalid_quality_review',
      'build_with_markdown_quality_review',
    ])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a playable game from the spec.' }),
      })

      await waitFor(() => fake.runtimes.length >= 2)
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'workflow.blocked')
      })
      await waitFor(async () => {
        const statusRes = await app.request(`/api/beegame-sessions/${session.id}`)
        const status = await statusRes.json()
        return status.turnStatus === 'idle'
      })
      const pausedEventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const pausedEvents = await pausedEventsRes.json()
      const latestBlock = [...pausedEvents]
        .reverse()
        .find((event: { type: string }) => event.type === 'workflow.blocked')
      expect(latestBlock).toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            phase: 'building',
          }),
        }),
      )

      const continueRes = await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '继续任务' }),
      })
      expect(continueRes.status).toBe(200)

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              type: 'workflow.recovery.started',
            }),
          }),
        ]),
      )
      expect(fake.runtimes[3].submits[0].prompt).toContain('Recover the paused BeeGame build')
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('Planning phase is docs-only'),
          }),
        ]),
      )
      const review = await readFile(join(workspace, 'BEEGAME_PLAYABILITY_REVIEW.md'), 'utf8')
      expect(review).toContain('PLAYABILITY_CHECKS_PASSED: yes')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('accepts root quality gate artifacts for verifier review', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build_with_root_quality_gates')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build a playable game from the spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      await expect(readFile(join(workspace, 'traceability_matrix.json'), 'utf8')).resolves.toContain('core_loop')
      await expect(readFile(join(workspace, 'playable_loop_review.md'), 'utf8')).resolves.toContain('verdict: pass')
      const review = await readFile(join(workspace, 'BEEGAME_PLAYABILITY_REVIEW.md'), 'utf8')
      expect(review).toContain('PLAYABILITY_CHECKS_PASSED: yes')
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not require fixed section keywords in design pack docs', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_unstructured_design_pack')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Plan the game.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_build_write',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.starts.length).toBeGreaterThanOrEqual(2)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.phase',
            text: 'building',
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('allows planning to write additional markdown documents under project docs', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_docs_with_extra_markdown')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Plan the game with an extra checklist.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length > 0)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toContain('allow')
      expect(
        events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'workflow.blocked' &&
            event.payload?.toolUseID === 'tool_extra_markdown_doc',
        ),
      ).toBe(false)
      await expect(readFile(join(workspace, 'docs', 'PLAYABILITY_CHECKLIST.md'), 'utf8')).resolves.toContain(
        'Playability Checklist',
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('marks planning writes to another project as recoverable path mistakes', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_wrong_project_design_doc')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Plan the game.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length > 0)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('another project folder'),
            payload: expect.objectContaining({
              recoverable: true,
              recoveryKind: 'planning_path_rewrite',
              currentWorkspace: expect.stringContaining('current-project'),
              targetPath: expect.stringContaining('other-game/docs/PLAYABLE_SPEC.md'),
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('blocks implementation writes in the same planning turn even after design docs are complete', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_docs_then_code_same_turn')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Plan then write code too early.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'workflow.blocked' &&
            event.payload?.toolUseID === 'tool_same_turn_code_write',
        )
      })
      await waitFor(() => fake.starts.length >= 2)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults.at(-1)).toBe('deny')
      expect(fake.starts.length).toBeGreaterThanOrEqual(2)
      expect(fake.runtimes[1].submits[0].prompt).toContain('Now implement the approved playable spec')
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('Planning phase is docs-only'),
            payload: expect.objectContaining({
              phase: 'planning',
              blockedToolName: 'Write',
              toolUseID: 'tool_same_turn_code_write',
            }),
          }),
        ]),
      )
      await expect(stat(join(workspace, 'src', 'main.ts'))).rejects.toThrow()
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not complete the build turn until mandatory docs have been read', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_build_without_doc_reads')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Build without reading docs.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; text: string }) =>
            event.type === 'workflow.blocked' &&
            event.text.includes('must read mandatory docs'),
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(events.some((event: { type: string }) => event.type === 'turn.completed')).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('must read mandatory docs'),
            payload: expect.objectContaining({
              phase: 'building',
              missingDocs: expect.arrayContaining([
                'docs/GDD.md',
                'docs/TECH_DESIGN.md',
                'docs/PLAYABILITY_ACCEPTANCE.md',
              ]),
            }),
          }),
        ]),
      )
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not start implementation when planning marker is present but required design pack is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'planning_marker_without_design_pack')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Produce the design gate.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { recoveryKind?: string } }) =>
            event.type === 'workflow.blocked' &&
            event.payload?.recoveryKind === 'design_pack_repair',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.starts).toHaveLength(2)
      expect(fake.runtimes).toHaveLength(2)
      expect(fake.runtimes.flatMap(runtime => runtime.submits.map(submit => submit.prompt))).toEqual([
        'Produce the design gate.',
        'Produce the design gate.',
      ])
      await expect(readFile(join(workspace, 'docs', 'PLAYABLE_SPEC.md'), 'utf8')).rejects.toThrow()
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            payload: expect.objectContaining({
              recoverable: true,
              recoveryKind: 'design_pack_repair',
            }),
          }),
        ]),
      )
      expect(
        events.some((event: { type: string }) => event.type === 'turn.completed'),
      ).toBe(false)
      expect(
        events.some((event: { type: string }) => event.type === 'turn.failed'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'system.status',
            payload: expect.objectContaining({
              type: 'workflow.paused',
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-approves project-local file writes after the Playable Spec gate is complete', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'planning_then_write_after_playable_spec')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game after spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_write_after_spec',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'assistant.message',
            text: expect.stringContaining('PLAYABLE_SPEC_READY: yes'),
          }),
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_write_after_spec',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
      expect(
        events.some(
          (event: { type: string; payload?: { toolUseID?: string; autoDenied?: boolean } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_write_after_spec' &&
            event.payload?.autoDenied === true,
        ),
      ).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('allows planning to write PLAYABLE_SPEC.md using an absolute workspace path', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    const fake = createFakeRunner(undefined, 'write_playable_spec_doc_absolute_path')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write playable spec doc.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults.length > 0)

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_write_playable_spec_doc',
              toolName: 'Write',
              decision: 'allow',
              autoApproved: true,
            }),
          }),
        ]),
      )
      expect(
        events.some((event: { type: string; payload?: { toolUseID?: string } }) =>
          event.type === 'workflow.blocked' &&
          event.payload?.toolUseID === 'tool_write_after_spec_file',
        ),
      ).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('recognizes an existing playable spec file before gating implementation writes', async () => {
    const { projectsRoot, workspace } = await createConfiguredProjectWorkspace()
    await writeFile(
      join(workspace, 'BEEGAME_PLAYABLE_SPEC.md'),
      [
        '# Playable Spec',
        'Core Loop',
        'Playability Acceptance Checklist',
        'PLAYABLE_SPEC_READY: yes',
      ].join('\n'),
      'utf8',
    )
    const fake = createFakeRunner(undefined, 'planning_then_write_after_playable_spec_file')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Continue implementation from existing spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_write_after_spec_file',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual(['allow'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_write_after_spec_file',
              toolName: 'Write',
              autoApproved: true,
            }),
          }),
        ]),
      )
      expect(
        events.some((event: { type: string; payload?: { toolUseID?: string } }) =>
          event.type === 'workflow.blocked' &&
          event.payload?.toolUseID === 'tool_write_after_spec_file',
        ),
      ).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('emits workflow block for Bash before a Playable Spec exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'bash_before_playable_spec')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game immediately.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'workflow.blocked')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[0].permissionResults).toEqual(['deny'])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'workflow.blocked',
            text: expect.stringContaining('Playable Spec'),
            payload: expect.objectContaining({
              phase: 'planning',
              blockedToolName: 'Bash',
            }),
          }),
        ]),
      )
      expect(events.some((event: { type: string }) => event.type === 'permission.resolved')).toBe(false)
      expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('allows normal Bash approval after the Playable Spec gate is complete', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'planning_then_bash_after_playable_spec')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game after spec.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_bash_after_spec',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual([])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.requested',
            payload: expect.objectContaining({
              toolUseID: 'tool_bash_after_spec',
              toolName: 'Bash',
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('allows permissions inside the configured workspace root even outside the current project', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'current-project')
    const existingProject = join(projectsRoot, 'existing-project')
    const fake = createFakeRunner(undefined, 'planning_then_workspace_root_permission')
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(existingProject, { recursive: true })
      await writeRequiredDesignPack(workspace, {
        requestPermission: async () => ({ behavior: 'allow' }),
      } as unknown as BeeGameSessionSubmitInput)
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Modify existing project.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some(
          (event: { type: string; payload?: { toolUseID?: string } }) =>
            event.type === 'permission.requested' &&
            event.payload?.toolUseID === 'tool_workspace_root_write',
        )
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      expect(fake.runtimes[1].permissionResults).toEqual([])
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.requested',
            payload: expect.objectContaining({
              toolUseID: 'tool_workspace_root_write',
              toolName: 'Write',
            }),
          }),
        ]),
      )
      expect(
        events.some(
          (event: { type: string; payload?: { toolUseID?: string; autoDenied?: boolean } }) =>
            event.type === 'permission.resolved' &&
            event.payload?.toolUseID === 'tool_workspace_root_write' &&
            event.payload?.autoDenied === true,
        ),
      ).toBe(false)
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('auto-denies permissions that target paths outside the configured workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'outside_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Write outside.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_outside',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-denies Bash permissions that reference paths outside the configured workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'outside_bash_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Inspect outside.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'deny')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_outside_bash',
              toolName: 'Bash',
              decision: 'deny',
              autoDenied: true,
            }),
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('auto-allows AskUserQuestion without creating a dashboard permission gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'ask_user_question_permission')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Need more details.' }),
      })

      await waitFor(() => fake.runtimes[0]?.permissionResults[0] === 'allow')

      const eventsRes = await app.request(
        `/api/beegame-sessions/${session.id}/events`,
      )
      const events = await eventsRes.json()
      expect(
        events.some((event: { type: string }) => event.type === 'permission.requested'),
      ).toBe(false)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'permission.resolved',
            payload: expect.objectContaining({
              toolUseID: 'tool_question',
              toolName: 'AskUserQuestion',
              decision: 'allow',
              autoApproved: true,
            }),
          }),
          expect.objectContaining({
            type: 'result',
            text: 'question allow',
          }),
        ]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reads artifact files from inside the session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await writeFile(join(workspace, 'artifact.txt'), 'artifact content')
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const artifactRes = await app.request(
        `/api/beegame-sessions/${session.id}/artifacts?path=artifact.txt`,
      )

      expect(artifactRes.status).toBe(200)
      expect(await artifactRes.json()).toEqual({
        path: 'artifact.txt',
        content: 'artifact content',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects artifact reads outside the session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner()
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const artifactRes = await app.request(
        `/api/beegame-sessions/${session.id}/artifacts?path=../outside.txt`,
      )

      expect(artifactRes.status).toBe(400)
      expect(await artifactRes.json()).toEqual({
        error: 'Artifact path must stay inside the session workspace',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes session-created project directories without deleting the workspace root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const gameDir = join(workspace, 'snake-game')
    const keepDir = join(workspace, 'keep-me')
    const fake = createFakeRunner([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_write_package',
              name: 'Write',
              input: {
                file_path: join(gameDir, 'package.json'),
                content: '{}',
              },
            },
          ],
        },
      },
      { type: 'result', result: 'Done' },
    ], 'planning_messages_then_build_complete')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      await mkdir(gameDir, { recursive: true })
      await mkdir(keepDir, { recursive: true })
      await writeFile(join(gameDir, 'package.json'), '{}')
      await writeFile(join(keepDir, 'note.txt'), 'keep')

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()
      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create snake game.' }),
      })
      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const deleteRes = await app.request(
        `/api/beegame-sessions/${session.id}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({
        deleted: true,
        deletedArtifactPaths: [gameDir],
      })
      await expect(stat(gameDir)).rejects.toThrow()
      await expect(stat(keepDir)).resolves.toEqual(expect.anything())
      await expect(stat(workspace)).resolves.toEqual(expect.anything())
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes the active session workspace directory when it is a project under Projects', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'project-one')
    const fake = createFakeRunner([{ type: 'result', result: 'Done' }])
    const app = createAgentWorkflowApp({
      sessionRunner: fake.runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'project')
      const resolvedWorkspace = await realpath(workspace)

      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const deleteRes = await app.request(
        `/api/beegame-sessions/${session.id}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([resolvedWorkspace])
      await expect(stat(workspace)).rejects.toThrow()
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('deletes project directories from transcript after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const resolvedWorkspace = await realpath(workspace)
    const sessionId = 'beegame_transcript_only'
    const gameDir = join(resolvedWorkspace, 'snake-game')
    const transcriptPath = getTestTranscriptPath(resolvedWorkspace, resolvedWorkspace, sessionId)
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: resolvedWorkspace,
    })
    try {
      await mkdir(gameDir, { recursive: true })
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(join(gameDir, 'package.json'), '{}')
      await writeFile(
        transcriptPath,
        `${JSON.stringify({
          id: 1,
          sessionId,
          type: 'tool.started',
          text: 'Write',
          payload: {
            type: 'tool.started',
            toolUseID: 'tool_write_package',
            toolName: 'Write',
            input: {
              file_path: join(gameDir, 'package.json'),
              content: '{}',
            },
          },
          createdAt: new Date().toISOString(),
        })}\n`,
      )

      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({
        deleted: true,
        deletedArtifactPaths: [gameDir],
      })
      await expect(stat(gameDir)).rejects.toThrow()
      await expect(stat(workspace)).resolves.toEqual(expect.anything())
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes a project workspace after backend restart loses the session', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'project-after-restart')
    const sessionId = 'beegame_restart_delete_workspace'
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'README.md'), 'project')
      const resolvedWorkspace = await realpath(workspace)

      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1&workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([resolvedWorkspace])
      await expect(stat(workspace)).rejects.toThrow()
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('treats missing project workspace as deleted after backend restart loses the session', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-projects-'))
    const workspace = join(projectsRoot, 'already-deleted-project')
    const sessionId = 'beegame_restart_delete_missing_workspace'
    const app = createAgentWorkflowApp({
      sessionRunner: createFakeRunner().runner,
      defaultWorkspacePath: projectsRoot,
    })
    try {
      const deleteRes = await app.request(
        `/api/beegame-sessions/${sessionId}?deleteArtifacts=1&workspacePath=${encodeURIComponent(workspace)}`,
        { method: 'DELETE' },
      )

      expect(deleteRes.status).toBe(200)
      const result = await deleteRes.json()
      expect(result.deleted).toBe(true)
      expect(result.deletedArtifactPaths).toEqual([])
      await expect(stat(projectsRoot)).resolves.toEqual(expect.anything())
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('reads transcript from disk after backend restart loses the session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-transcript-read-'))
    const sessionId = 'beegame_transcript_read'
    const transcriptPath = getTestTranscriptPath(workspace, workspace, sessionId)
    const app = createAgentWorkflowApp({ defaultWorkspacePath: workspace })

    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            id: 1,
            sessionId,
            type: 'user.message',
            text: '做一个贪吃蛇',
            createdAt: '2026-06-21T00:00:01.000Z',
          }),
          JSON.stringify({
            id: 2,
            sessionId,
            type: 'assistant.message',
            text: '已生成可玩的贪吃蛇原型。',
            createdAt: '2026-06-21T00:00:02.000Z',
          }),
        ].join('\n'),
        'utf8',
      )

      const res = await app.request(
        `/api/beegame-sessions/${sessionId}/transcript?workspacePath=${encodeURIComponent(workspace)}`,
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        expect.objectContaining({
          id: 1,
          type: 'user.message',
          text: '做一个贪吃蛇',
        }),
        expect.objectContaining({
          id: 2,
          type: 'assistant.message',
          text: '已生成可玩的贪吃蛇原型。',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('resumes backend restart sessions into the existing transcript file', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-transcript-resume-'))
    const workspace = join(projectsRoot, 'game-one')

    try {
      await mkdir(workspace, { recursive: true })
      const app = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const startRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: workspace }),
        headers: { 'content-type': 'application/json' },
      })
      const firstSession = await startRes.json() as { id: string }
      const transcriptDir = join(projectsRoot, '.beegame-dashboard', 'transcripts')
      const transcriptProjects = await readdir(transcriptDir)
      expect(transcriptProjects).toEqual(['game-one'])
      const projectTranscriptDir = join(transcriptDir, 'game-one')
      const initialFiles = await readdir(projectTranscriptDir)
      expect(initialFiles).toHaveLength(1)
      const transcriptPath = join(projectTranscriptDir, initialFiles[0]!)
      const initialTranscript = await readFile(transcriptPath, 'utf8')
      const initialEvents = initialTranscript.trim().split('\n')
      expect(initialEvents.length).toBeGreaterThan(0)

      const restartedApp = createAgentWorkflowApp({
        sessionRunner: createFakeRunner().runner,
        defaultWorkspacePath: projectsRoot,
      })
      const resumeRes = await restartedApp.request('/api/beegame-sessions', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: workspace,
          transcriptSessionId: firstSession.id,
        }),
        headers: { 'content-type': 'application/json' },
      })
      expect(resumeRes.status).toBe(200)
      const resumedSession = await resumeRes.json() as { id: string }
      expect(resumedSession.id).not.toBe(firstSession.id)

      const resumedFiles = await readdir(projectTranscriptDir)
      expect(resumedFiles).toEqual(initialFiles)
      const resumedTranscript = await readFile(transcriptPath, 'utf8')
      const resumedEvents = resumedTranscript
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { id: number; sessionId: string; type: string })
      expect(resumedEvents.length).toBeGreaterThan(initialEvents.length)
      expect(resumedEvents.at(-1)).toEqual(expect.objectContaining({
        id: initialEvents.length + 2,
        sessionId: resumedSession.id,
        type: 'runtime.observation',
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not expose synthetic runtime continuation messages as user chat', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-'))
    const fake = createFakeRunner(undefined, 'synthetic_user_message')
    const app = createAgentWorkflowApp({ sessionRunner: fake.runner })
    try {
      const sessionRes = await app.request('/api/beegame-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      await app.request(`/api/beegame-sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Create match game.' }),
      })

      await waitFor(async () => {
        const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
        const events = await eventsRes.json()
        return events.some((event: { type: string }) => event.type === 'turn.completed')
      })

      const eventsRes = await app.request(`/api/beegame-sessions/${session.id}/events`)
      const events = await eventsRes.json()
      const userMessages = events.filter((event: { type: string }) => event.type === 'user.message')
      expect(userMessages).toEqual([
        expect.objectContaining({
          text: 'Create match game.',
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('continued from a previous conversation')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for condition')
    }
    await Bun.sleep(5)
  }
}
