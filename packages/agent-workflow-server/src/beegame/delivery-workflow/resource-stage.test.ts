import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { startResourcePreparation, completeResourceTask } from './resource-stage'
import { validateResourceDelivery } from '../resource-validation-cli'
import { buildWorkerPrompt } from './worker-prompts'

describe('resource delivery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('materializes the visible registry contract before dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-contract-issues-'))
    const requests: unknown[] = []
    await startResourcePreparation({
      workspacePath: workspace,
      run: {
        phase: 'RESOURCE_PREPARATION',
        activeDispatch: undefined,
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        revision: { document: 'revision' },
        confirmedBriefContext: JSON.stringify({ resource_library_usage: 'preferred' }),
        blockedReason: 'Example: entry file missing',
      } as never,
      dispatcher: {
        async dispatch(request) {
          requests.push(request)
        },
      },
    })

    const contract = await readFile(join(workspace, 'assets/manifest/CONTRACT.md'), 'utf8')
    expect(contract).toContain('Asset Manifest authoring contract (v9)')
    expect(contract).toContain('`assets/asset-manifest.json` is an **index**')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      contract: {
        contractPath: 'assets/manifest/CONTRACT.md',
        manifestPath: 'assets/asset-manifest.json',
        validationCommand: 'bun assets/manifest/check.mjs',
        validationIssues: ['assets/asset-manifest.json is missing.'],
      },
    })
    expect(JSON.stringify(requests)).not.toContain('Example: entry file missing')
  })

  test('terminal acceptance uses the same failures as the project checker', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-host-parity-'))
    const run = { phase: 'RESOURCE_PREPARATION', status: 'running', resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' } }
    const completed = await completeResourceTask({ workspacePath: workspace, run: run as never,
      terminal: { workerType: 'resource-planner' } as never })
    const validation = validateResourceDelivery(workspace)
    expect(completed.status).toBe('needs_action')
    expect(completed.blockedReason).toBe(validation.issues.join('; '))
    expect(completed.blockedReason).not.toContain('at least one canonical requirement')
  })

  test('keeps resource authoring inside the project workspace', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-planner',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      allowedPaths: ['assets/'],
      contract: {
        manifestPath: 'assets/asset-manifest.json',
        contractPath: 'assets/manifest/CONTRACT.md',
      },
    })

    expect(prompt).toContain('autonomously obtain or make the runtime assets')
    expect(prompt).toContain('Asset Manifest authoring contract at contract.contractPath')
    expect(prompt).toContain('contract.validationCommand runs the same read-only interface check as the host')
    expect(prompt).not.toContain('resource-validation-cli')
  })
})
