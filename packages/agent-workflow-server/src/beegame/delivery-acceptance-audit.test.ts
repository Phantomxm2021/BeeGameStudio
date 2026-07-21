import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePersistedDeliveryAcceptance } from './delivery-acceptance-audit'
import {
  getObservedNativeAcceptance,
  observeNativeAcceptanceTaskNotification,
  observeNativeAcceptanceToolEvent,
  recordNativeAcceptanceReportForTest,
} from './native-acceptance-evidence'
import { recordNativeDocumentReviewForTest } from './native-document-review-evidence'
import { recordNativeImplementationAuditReportForTest } from './native-implementation-audit-evidence'
import { REQUIRED_PROJECT_DOCUMENTS } from './document-readiness-audit'
import { getNativeDeliveryEvidenceSummary } from './native-delivery-state'
import {
  observeNativeToolProvenance,
  recordNativeValidatorToolCapabilitiesForTest,
} from './native-tool-provenance'
import { observeNativeResourceLibraryToolEvent } from './native-resource-library-evidence'
import { recordConfirmedBriefEvidence } from './confirmed-brief-evidence'

const TEST_SESSION_ID = 'native-acceptance-test-session'

describe('native delivery acceptance gate', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
    if (workspace) await rm(dataRootFor(workspace), { recursive: true, force: true })
  })

  test('accepts a native passing result for the exact workspace revision', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Observed the documented player paths.')

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('does not accept a preferred Resource Library policy without observed Pack exploration', async () => {
    workspace = await createWorkspace()
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'preferred',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    recordReadyDocumentReview(workspace, 'preferred')
    record(workspace, 'passed', 'The validator report cannot replace Pack exploration.')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The current resource policy requires an observed native Resource Library exploration, but none was recorded.'],
    })

    observeNativeResourceLibraryToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'ResourceLibrary',
        toolUseID: 'pack-exploration',
        input: { action: 'browse_packs' },
        output: JSON.stringify({ items: [] }),
      },
      createdAt: new Date(),
    })
    record(workspace, 'passed', 'The current revision was audited and validated after Pack exploration.')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['assets/asset-manifest.json: preferred Resource Library usage has no imported resource artifacts in the current manifest.'],
    })
  })

  test('does not treat an all-failed Resource Library import as a required project artifact', async () => {
    workspace = await createWorkspace()
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'required',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    recordReadyDocumentReview(workspace, 'required')
    for (const [toolUseID, action, output] of [
      ['browse', 'browse_packs', { data: { items: [], total: 0 } }],
      ['import', 'import_elements', { data: { result: 'failed', requested_count: 1, imported_count: 0, failed_count: 1, imported: [], failures: [{ error: 'download failed', import_ids: ['asset-a'] }] } }],
    ] as const) {
      observeNativeResourceLibraryToolEvent({
        dataRoot: dataRootFor(workspace),
        sessionId: TEST_SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: { toolName: 'ResourceLibrary', toolUseID, input: { action }, output: JSON.stringify(output) },
        createdAt: new Date(),
      })
    }
    record(workspace, 'passed', 'A Validator claim cannot replace a missing imported file.')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['assets/asset-manifest.json: required Resource Library usage has no imported resource artifacts in the current manifest. Resource Library: unresolved failed native actions for the current resource context: import_elements.'],
    })
  })

  test('does not allow the manifest to downgrade the confirmed Resource Library policy', async () => {
    workspace = await createWorkspace()
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'optional',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    recordReadyDocumentReview(workspace, 'preferred')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The asset manifest resource_library_usage (optional) does not preserve the confirmed brief policy (preferred).'],
    })
  })

  test('does not let a Reviewer and manifest jointly replace the user-confirmed resource policy', async () => {
    workspace = await createWorkspace()
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'optional',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    recordReadyDocumentReview(workspace, 'optional')
    recordConfirmedBriefEvidence({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      confirmedBriefContext: JSON.stringify({
        kind: 'confirmed_build_brief',
        resource_library_usage: 'preferred',
      }),
      createdAt: new Date(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The native Document Reviewer resource policy (optional) does not preserve the user-confirmed policy (preferred).'],
    })
  })

  test('does not continue after a failed import under a preferred Resource Library policy', async () => {
    workspace = await createWorkspace()
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'preferred',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))
    recordReadyDocumentReview(workspace, 'preferred')
    for (const [toolUseID, action, output] of [
      ['preferred-browse', 'browse_packs', { data: { items: [], total: 0 } }],
      ['preferred-import', 'import_elements', { data: { result: 'failed', requested_count: 1, imported_count: 0, failed_count: 1, imported: [], failures: [{ error: 'copy failed', import_ids: ['asset-a'] }] } }],
    ] as const) {
      observeNativeResourceLibraryToolEvent({
        dataRoot: dataRootFor(workspace),
        sessionId: TEST_SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: { toolName: 'ResourceLibrary', toolUseID, input: { action }, output: JSON.stringify(output) },
        createdAt: new Date(),
      })
    }

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['assets/asset-manifest.json: preferred Resource Library usage has no imported resource artifacts in the current manifest. Resource Library: unresolved failed native actions for the current resource context: import_elements.'],
    })
  })

  test('rejects a passed Validator that started before the current Auditor completed', async () => {
    workspace = await createWorkspace()
    const pending = startForegroundValidator(workspace)
    recordPassedImplementationAudit(workspace)
    completeForegroundValidator(workspace, pending, passingReport())

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The Acceptance Validator started before the current Implementation Auditor completed.'],
    })
  })

  test('rejects passing native reports that omit a current checklist id', async () => {
    workspace = await createWorkspace()
    recordNativeImplementationAuditReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        auditorId: 'beegame-implementation-auditor',
        status: 'passed',
        summary: 'The audit omitted the project checklist coverage.',
        auditedChecklistIds: [],
        evidence: [{ source: 'src/entry.ts', detail: 'A source file exists.' }],
        findings: [],
      },
    })
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: { ...passingReport(), validatedChecklistIds: [] },
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native Implementation Auditor result.'],
    })
  })

  test('reports document review, implementation audit, and runtime acceptance independently', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Observed the documented player paths.')

    expect(getNativeDeliveryEvidenceSummary({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({
      documentReview: expect.objectContaining({ status: 'ready' }),
      implementationAudit: expect.objectContaining({ status: 'passed' }),
      runtimeAcceptance: expect.objectContaining({ status: 'passed' }),
    })
  })

  test('requires a native implementation audit in addition to review and acceptance', async () => {
    workspace = await createWorkspace()
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: passingReport(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native Implementation Auditor result.'],
    })
  })

  test('preserves a native implementation audit failure as a deployment failure', async () => {
    workspace = await createWorkspace()
    recordNativeImplementationAuditReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        auditorId: 'beegame-implementation-auditor',
        status: 'failed',
        summary: 'A documented asset is copied but never referenced.',
        evidence: [],
        findings: [{
          source: 'assets/asset-manifest.json',
          detail: 'The imported asset has no target-runtime reference.',
        }],
      },
    })
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: passingReport(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['A documented asset is copied but never referenced.'],
    })
  })

  test('requires a new implementation audit after the audited workspace changes', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: passingReport(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: [
        'The project changed after implementation audit; audit the current revision before deployment.',
      ],
    })
  })

  test('does not accept READY when deterministic document contracts are invalid', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      JSON.stringify({ version: 1, project: {}, assets: [] }),
    )
    recordReadyDocumentReview(workspace)

    const result = evaluate(workspace)
    expect(result.allowed).toBe(false)
    expect(result.outcome).toBe('rejected')
    expect(result.issues.join(' ')).toContain('requirements must be an array')
  })

  test('binds acceptance to the revision observed when the validator starts', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const payload = {
      toolName: 'Agent',
      toolUseID: 'validator-on-old-revision',
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload,
      createdAt: new Date(),
    })
    recordNativeValidatorToolCapabilitiesForTest({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      validatorToolUseID: payload.toolUseID,
    })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: { ...payload, output: JSON.stringify(passingReport()) },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('captures an exact terminal result from the native foreground Agent lifecycle', async () => {
    workspace = await createWorkspace()
    recordForegroundResult(workspace, passingReport())

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('binds a foreground result to the revision at its original Agent dispatch', async () => {
    workspace = await createWorkspace()
    const pending = startForegroundValidator(workspace)
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    completeForegroundValidator(workspace, pending, passingReport())

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('captures the terminal result of a native Validator moved to the background', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-tool'
    const taskId = 'background-validator-task'
    const outputFile = join(dataRoot, 'validator-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    recordNativeValidatorToolCapabilitiesForTest({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      validatorToolUseID: toolUseID,
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_started',
        task_id: taskId,
        tool_use_id: toolUseID,
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    notifyAcceptance(workspace, toolUseID, taskId, passingReport())

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('uses the native terminal result when SDK metadata omits output_file', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-empty-notification-path'
    const taskId = 'background-validator-empty-notification-task'
    const outputFile = join(dataRoot, 'validator-native-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    await mkdir(dataRoot, { recursive: true })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    notifyAcceptance(workspace, toolUseID, taskId, passingReport())

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('does not inspect a background Validator output file during native resume', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-init-resume'
    const taskId = 'background-validator-init-task'
    const outputFile = join(dataRoot, 'validator-init-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    await mkdir(dataRoot, { recursive: true })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: { subtype: 'init' },
      createdAt: new Date(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The native acceptance Validator is still running.'],
    })
  })

  test('binds a background result to the revision at its original Agent dispatch', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-stale-tool'
    const taskId = 'background-validator-stale-task'
    const outputFile = join(dataRoot, 'stale-validator-output.jsonl')
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: {
        toolName: 'Agent',
        toolUseID,
        input: { subagent_type: 'beegame-acceptance-validator' },
      },
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_started',
        task_id: taskId,
        tool_use_id: toolUseID,
      },
      createdAt: new Date(),
    })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    notifyAcceptance(workspace, toolUseID, taskId, passingReport())

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('ignores a background completion without a linked native dispatch', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const outputFile = join(dataRoot, 'unlinked-validator-output.jsonl')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_notification',
        status: 'completed',
        task_id: 'unlinked-task',
        tool_use_id: 'unlinked-tool',
        output_file: outputFile,
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('ignores TaskOutput without an observed native background task link', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'TaskOutput',
        toolUseID: 'unlinked-task-output',
        input: { task_id: 'unknown-task' },
        output: nativeTaskOutput(passingReport()),
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('accepts a completed native TaskOutput linked to the observed background Validator', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'task-output-validator-tool'
    const taskId = 'task-output-validator-task'
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    recordNativeValidatorToolCapabilitiesForTest({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      validatorToolUseID: toolUseID,
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, join(dataRoot, 'validator-output.jsonl')),
      },
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'TaskOutput',
        toolUseID: 'task-output-tool-use',
        input: { task_id: taskId },
        nativeTaskResult: {
          taskId,
          status: 'completed',
          result: JSON.stringify(passingReport()),
        },
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('current')
  })

  test('does not recover an unfinished background Validator output', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'unfinished-background-validator'
    const taskId = 'unfinished-background-validator-task'
    const outputFile = join(dataRoot, 'unfinished-validator-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: null,
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)

    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: { subtype: 'init' },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('running')
  })

  test('does not use unrelated results or SendMessage as Validator evidence triggers', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'validator-with-unrelated-result'
    const taskId = 'validator-with-unrelated-result-task'
    const outputFile = join(dataRoot, 'unrelated-result-validator-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)

    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'result',
      payload: { result: 'unrelated native turn result' },
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'SendMessage',
        toolUseID: 'validator-send-message-follow-up',
        output: JSON.stringify(passingReport()),
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('running')
  })

  test('rejects prose-wrapped JSON from the foreground Validator result', async () => {
    workspace = await createWorkspace()
    recordForegroundResult(workspace, `Validation complete. ${JSON.stringify(passingReport())}`)

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('rejects a passing claim without complete native evidence', async () => {
    workspace = await createWorkspace()
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        validatorId: 'beegame-acceptance-validator',
        status: 'passed',
        summary: 'Source inspection looked plausible.',
        evidence: [],
        findings: [],
      },
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('does not accept a completion that has no matching native dispatch', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'Agent',
        toolUseID: 'unobserved-validator',
        input: { subagent_type: 'beegame-acceptance-validator' },
        output: JSON.stringify(passingReport()),
      },
      createdAt: new Date(),
    })
    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('rejects a workspace without an observed native validator result', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })

  test('passes through the native failed or blocked terminal outcome', async () => {
    workspace = await createWorkspace()
    record(workspace, 'failed', 'The documented restart path failed.')
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The documented restart path failed.'],
    })

    record(workspace, 'blocked', 'A required device is unavailable.')
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'blocked',
      issues: ['A required device is unavailable.'],
    })
  })

  test('never treats a blocked document review as deliverable', async () => {
    workspace = await createWorkspace()
    recordNativeDocumentReviewForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        reviewerId: 'beegame-document-reviewer',
        verdict: 'BLOCKED',
        summary: 'The confirmed brief is unavailable.',
        confirmedResourceLibraryUsage: 'preferred',
        findings: [{
          source: 'confirmed brief',
          detail: 'The reviewer cannot compare the documents without the approved brief.',
        }],
      },
    })
    record(workspace, 'passed', 'A validator result cannot override document review.')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'blocked',
      issues: ['The confirmed brief is unavailable.'],
    })
  })

  test('does not accept a passing validator result without runtime evidence', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    const report = passingReport() as {
      evidence: Array<{ kind: string }>
    }
    report.evidence = report.evidence.filter(item => item.kind !== 'runtime')
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report,
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })

  test('does not accept source inspection labelled as runtime evidence', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'source-only-validator'
    const payload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload,
      createdAt: new Date(),
    })
    for (const [childID, toolName] of [['read-source', 'Read'], ['run-tests', 'Bash'], ['read-skill', 'Skill']] as const) {
      observeNativeToolProvenance({
        dataRoot,
        sessionId: TEST_SESSION_ID,
        eventType: 'tool.completed',
        payload: {
          toolUseID: childID,
          parentToolUseID: toolUseID,
          toolName,
        },
        createdAt: new Date(),
      })
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: { ...payload, output: JSON.stringify(passingReport()) },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('invalidates acceptance when implementation or approved documents change', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Accepted current revision.')
    await writeFile(join(workspace, 'docs', 'GDD.md'), '# Changed requirement\n')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Project documents changed after review; review the current document revision before deployment.'],
    })
  })

  test('does not inspect or require BeeGame-specific checklist schemas', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance.md'),
      '# Project-native acceptance\n\nThe player can finish and restart a run.\n',
    )
    recordReadyDocumentReview(workspace)
    record(workspace, 'passed', 'The native validator observed the documented flow.')

    expect(evaluate(workspace).allowed).toBe(true)
  })

  test('keeps non-blocking validator observations on a passed result', async () => {
    workspace = await createWorkspace()
    const report = passingReport('Observed every required player path.') as {
      findings: Array<{ source: string; detail: string }>
    }
    report.findings = [{
      source: 'optional visual observation',
      detail: 'The optional capture was unavailable; required state behavior passed.',
    }]
    recordForegroundResult(workspace, report)

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('does not accept prose-wrapped or malformed Agent output as terminal evidence', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'Agent',
        toolUseID: 'validator-prose-output',
        input: { subagent_type: 'beegame-acceptance-validator' },
        output: 'Looks good. {"validatorId":"beegame-acceptance-validator","status":"passed","summary":"claimed"}',
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('does not accept an assistant completion claim as native validator evidence', async () => {
    workspace = await createWorkspace()
    recordPassedImplementationAudit(workspace)
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'assistant.message',
      payload: {
        type: 'assistant',
        text: JSON.stringify({
          validatorId: 'beegame-acceptance-validator',
          status: 'passed',
          summary: 'The implementation agent claimed delivery was complete.',
        }),
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-delivery-audit-'))
  await mkdir(join(root, 'src'), { recursive: true })
  for (const path of REQUIRED_PROJECT_DOCUMENTS) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(
      join(root, path),
      path.endsWith('gameplay-checklist.md')
        ? '# Acceptance\n- [ ] PATH-001 Launch and observe the playable state.\n'
        : `# Approved ${path}\n`,
    )
  }
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'asset-manifest.json'), JSON.stringify({
    version: 5,
    project_target: {
      platform: 'selected-target',
      runtime: 'project-native',
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'optional',
    },
    requirements: [],
    imports: [],
    compositions: [],
  }))
  await writeFile(join(root, 'src', 'entry.ts'), 'export const ready = true\n')
  recordReadyDocumentReview(root)
  return root
}

function recordReadyDocumentReview(
  workspace: string,
  confirmedResourceLibraryUsage: 'optional' | 'preferred' | 'required' = 'optional',
): void {
  recordNativeDocumentReviewForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report: {
      reviewerId: 'beegame-document-reviewer',
      verdict: 'READY',
      summary: 'The current project documents are implementation-ready.',
      confirmedResourceLibraryUsage,
      findings: [],
    },
  })
}

function record(
  workspace: string,
  status: 'passed' | 'failed' | 'blocked',
  summary: string,
): void {
  recordPassedImplementationAudit(workspace)
  recordNativeAcceptanceReportForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report: status === 'passed'
      ? passingReport(summary)
      : {
          validatorId: 'beegame-acceptance-validator',
          status,
          summary,
          evidence: [{
            kind: 'runtime',
            source: 'project-native acceptance path',
            result: status,
            detail: summary,
          }],
          findings: [{ source: 'project-native acceptance path', detail: summary }],
        },
  })
}

function startForegroundValidator(workspace: string): {
  toolUseID: string
} {
  const toolUseID = 'native-validator-agent-tool'
  observeNativeAcceptanceToolEvent({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    eventType: 'tool.started',
    payload: {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    },
    createdAt: new Date(),
  })
  recordNativeValidatorToolCapabilitiesForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    validatorToolUseID: toolUseID,
  })
  return { toolUseID }
}

function completeForegroundValidator(
  workspace: string,
  pending: { toolUseID: string },
  report: unknown,
): void {
  observeNativeAcceptanceToolEvent({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    eventType: 'tool.completed',
    payload: {
      toolName: 'Agent',
      toolUseID: pending.toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
      output: typeof report === 'string' ? report : JSON.stringify(report),
    },
    createdAt: new Date(),
  })
}

function recordForegroundResult(workspace: string, report: unknown): void {
  recordPassedImplementationAudit(workspace)
  completeForegroundValidator(workspace, startForegroundValidator(workspace), report)
}

function nativeTaskOutput(report: unknown): string {
  const output = typeof report === 'string' ? report : JSON.stringify(report)
  return [
    '<retrieval_status>success</retrieval_status>',
    '<task_id>native-validator-task</task_id>',
    '<task_type>local_agent</task_type>',
    '<status>completed</status>',
    '<output>',
    output,
    '</output>',
  ].join('\n')
}

function nativeAsyncAgentLaunch(taskId: string, outputFile: string): string {
  return [
    'Async agent launched successfully.',
    `agentId: ${taskId}`,
    'The agent is working in the background.',
    `output_file: ${outputFile}`,
  ].join('\n')
}

function notifyAcceptance(
  workspace: string,
  toolUseID: string,
  taskId: string,
  report: unknown,
): void {
  recordNativeValidatorToolCapabilitiesForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    validatorToolUseID: toolUseID,
  })
  observeNativeAcceptanceTaskNotification({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    notification: {
      value: [
        '<task-notification>',
        `<task-id>${taskId}</task-id>`,
        `<tool-use-id>${toolUseID}</tool-use-id>`,
        '<status>completed</status>',
        `<result>${typeof report === 'string' ? report : JSON.stringify(report)}</result>`,
        '</task-notification>',
      ].join(''),
    },
    createdAt: new Date(),
  })
}

function recordPassedImplementationAudit(workspace: string): void {
  recordNativeImplementationAuditReportForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report: {
      auditorId: 'beegame-implementation-auditor',
      status: 'passed',
      summary: 'The current implementation and asset contract are structurally consistent.',
      auditedChecklistIds: ['PATH-001'],
      evidence: [{
        source: 'current workspace',
        detail: 'Approved requirements map to current implementation, tests, and asset references.',
      }],
      findings: [],
    },
  })
}

function passingReport(summary = 'Observed every documented player path.'): object {
  return {
    validatorId: 'beegame-acceptance-validator',
    status: 'passed',
    summary,
    validatedChecklistIds: ['PATH-001'],
    evidence: [
      { kind: 'document', source: 'docs/', result: 'passed', detail: 'Approved documents were reviewed.' },
      { kind: 'build', source: 'project build', result: 'passed', detail: 'The native build completed successfully.' },
      { kind: 'test', source: 'project tests', result: 'passed', detail: 'Project-native assertions passed.' },
      { kind: 'runtime', source: 'player paths', result: 'passed', detail: 'Every required player path was observed.' },
      { kind: 'asset', source: 'packaged assets', result: 'passed', detail: 'Required assets loaded from the packaged result.' },
      { kind: 'skill', source: 'beegame-game-acceptance', result: 'passed', detail: 'The native acceptance Skill was invoked.' },
    ],
    findings: [],
  }
}

function evaluate(workspace: string) {
  return evaluatePersistedDeliveryAcceptance(workspace, {
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
  })
}

function dataRootFor(workspace: string): string {
  return `${workspace}-runtime-data`
}
