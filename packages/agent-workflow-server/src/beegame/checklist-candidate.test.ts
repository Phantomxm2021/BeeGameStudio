import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHECKLIST_PATH,
  checklistCandidatePath,
  commitChecklistCandidate,
  readChecklistCandidate,
} from './checklist-candidate'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true })))
})

test('publishes only the validated candidate and replaces no canonical baseline beforehand', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'checklist-candidate-'))
  workspaces.push(workspacePath)
  const candidatePath = checklistCandidatePath('dispatch-1')
  await mkdir(join(workspacePath, 'docs/acceptance'), { recursive: true })
  await writeFile(join(workspacePath, CHECKLIST_PATH), 'old canonical')
  await mkdir(join(workspacePath, '.beegame/workflow/checklist-candidates'), { recursive: true })
  await writeFile(join(workspacePath, candidatePath), '- [ ] flow.start Player starts successfully\n')

  expect(await readFile(join(workspacePath, CHECKLIST_PATH), 'utf8')).toBe('old canonical')
  await commitChecklistCandidate({ workspacePath, candidatePath })
  await expect(readChecklistCandidate({ workspacePath, candidatePath })).rejects.toThrow()
  expect(await readFile(join(workspacePath, CHECKLIST_PATH), 'utf8')).toContain('flow.start')
})

test('rejects candidate paths outside the dedicated diagnostic directory', async () => {
  await expect(
    readChecklistCandidate({ workspacePath: '/workspace', candidatePath: CHECKLIST_PATH }),
  ).rejects.toThrow('checklist candidate path is invalid')
})
