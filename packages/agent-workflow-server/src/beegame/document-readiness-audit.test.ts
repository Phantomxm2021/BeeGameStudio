import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditDocumentReadiness,
  REQUIRED_PROJECT_DOCUMENTS,
} from './document-readiness-audit'

describe('document readiness audit', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('requires the complete non-empty document baseline and canonical asset contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    expect(auditDocumentReadiness(workspace)).toMatchObject({ valid: false })

    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] PATH-001 Launch the game and observe the initial playable state.\n'
          : `# ${path}\n`,
      )
    }
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: [],
      },
      slots: [],
    }))

    expect(auditDocumentReadiness(workspace)).toEqual({ valid: true, issues: [] })
  })

  test('rejects an invented asset manifest root shape', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] PATH-001 Launch the game.\n'
          : `# ${path}\n`,
      )
    }
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project: { platform: 'selected-target' },
      assets: [],
    }))

    const audit = auditDocumentReadiness(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain(
      'assets/asset-manifest.json: project_target must be an object; received undefined.',
    )
    expect(audit.issues).toContain(
      'assets/asset-manifest.json: slots must be an array; received undefined.',
    )
  })

  test('requires identified acceptance tasks without interpreting game semantics', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] Launch the game.\n- [ ] `PATH-002`\n- [ ] PATH-003 Observe a result.\n- [ ] PATH-003 Observe the duplicate.\n'
          : `# ${path}\n`,
      )
    }
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: [],
      },
      slots: [],
    }))

    expect(auditDocumentReadiness(workspace).issues).toEqual([
      'docs/acceptance/gameplay-checklist.md: Checklist task 1 has no stable identifier.',
      'docs/acceptance/gameplay-checklist.md: Checklist task PATH-002 has no observable task description.',
      'docs/acceptance/gameplay-checklist.md: Checklist stable identifier is duplicated: PATH-003',
    ])
  })

  test('accepts legacy bracketed stable identifiers without matching business keywords', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] [contract:item-primary] Observe the committed behavior.\n'
          : `# ${path}\n`,
      )
    }
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: [] },
      slots: [],
    }))

    expect(auditDocumentReadiness(workspace)).toEqual({ valid: true, issues: [] })
  })
})
