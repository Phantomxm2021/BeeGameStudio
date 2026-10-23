import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, checkDesignHandoffDraft, finalizeDesignDocuments, snapshotDesignDocuments, readDesignImplementationChecklist, DESIGN_ACCEPTANCE_PATH } from './design-handoff'
import { readDesignHandoff, readImplementationTask } from './workflow-read-tools'
import { inspectDesignAcceptance } from './runtime-acceptance'
import { designInputRevision } from './design-handoff'
import { agentTurnHandoffReason } from './workflow-v3/agent-goal'
import type { Run, AgentTurn } from './workflow-v3/state'

test('plain eight-document work flows through reads, handoff and continued refinement without indexes or invented acceptance', async () => {
  const root = await mkdtemp('/private/tmp/bgs-plain-design-')
  try {
    await mkdir(join(root, 'docs'))
    const original = '# Design\n## Approach\nSynthetic design decision.\n'
    for (const name of PROJECT_DOCUMENTS) await writeFile(join(root, 'docs', name), original)
    expect(readDesignHandoff(root, {})).toMatchObject({ valid: true })
    expect(readImplementationTask(root, {})).toMatchObject({ valid: true, directory: [], documents: [{ document: 'TECHNICAL_DESIGN.md' }] })
    expect(checkDesignHandoffDraft(root, 'TECHNICAL_DESIGN.md', { finalTechnical: true }).valid).toBe(true)
    expect(finalizeDesignDocuments(root, PROJECT_DOCUMENTS, snapshotDesignDocuments(root, PROJECT_DOCUMENTS)).issues).toEqual([])
    expect(readDesignImplementationChecklist(root)).toMatchObject({ source: 'docs/TECHNICAL_DESIGN.md', items: [] })
    expect(await readdir(root)).toEqual(['docs'])
    for (const name of PROJECT_DOCUMENTS) expect(await readFile(join(root, 'docs', name), 'utf8')).toBe(original)
    const run = { workspacePath: root, writer: { attemptId: 'fixture' }, requirements: { revision: 'fixture' },
      creation: { initialDelivery: 'design-led-first-version' }, agentTurns: [] } as unknown as Run
    const before=designInputRevision(root)
    expect(await inspectDesignAcceptance(root, true)).toMatchObject({ valid: false, status: 'unverified', quality: 'unverified' })
    const ended = await agentTurnHandoffReason(run, {} as AgentTurn)
    expect(ended).toContain('execution completion is not acceptance')
    expect(ended).not.toContain('Itemized acceptance')
    await writeFile(join(root, 'docs/GDD.md'), original + 'Changed decision.\n')
    expect(designInputRevision(root)).not.toBe(before)
    expect(readDesignImplementationChecklist(root).source).toBe("docs/TECHNICAL_DESIGN.md")
    await writeFile(join(root, 'docs/GDD.md'), '')
    expect(checkDesignHandoff(root, PROJECT_DOCUMENTS).valid).toBe(false)
    await rm(join(root, 'docs/GDD.md'))
    expect(checkDesignHandoff(root, PROJECT_DOCUMENTS).valid).toBe(false)
    await symlink(join(root, 'docs/ART_DIRECTION.md'), join(root, 'docs/GDD.md'))
    expect(checkDesignHandoff(root, PROJECT_DOCUMENTS).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a report without indexes still needs real retained evidence and leaves quality unverified', async () => {
  const root = await mkdtemp('/private/tmp/bgs-plain-report-')
  try {
    await mkdir(join(root, 'docs'))
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    for (const name of PROJECT_DOCUMENTS) await writeFile(join(root, 'docs', name), '# Synthetic source\nDecision.\n')
    await writeFile(join(root, 'observed.txt'), 'Synthetic runtime result for local validation only.')
    await writeFile(join(root, 'bundle.js'), '/* synthetic artifact */')
    const report = { scope: 'delivery', status: 'passed', summary: 'Synthetic author claim', environment: 'local fixture',
      artifactPaths: ['bundle.js'], evidencePaths: ['observed.txt'], verification: { target: 'deployment', observation: 'target-runtime',
        knownIssues: [], unverified: [], designRevision: checkDesignHandoff(root, PROJECT_DOCUMENTS).revision } }
    const save = () => writeFile(join(root, DESIGN_ACCEPTANCE_PATH), JSON.stringify(report))
    await save()
    expect(await inspectDesignAcceptance(root, true)).toMatchObject({ valid: true, quality: 'unverified', requirementChecks: [] })
    await rm(join(root, 'observed.txt'))
    expect((await inspectDesignAcceptance(root, true)).valid).toBe(false)
    report.evidencePaths = []
    await save()
    expect((await inspectDesignAcceptance(root, true)).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
