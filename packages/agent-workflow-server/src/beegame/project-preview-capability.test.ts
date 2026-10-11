import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { projectPreviewCapabilityPath, publishProjectPreviewCapability } from './project-preview-capability'

test('capability refresh and cleanup are serialized; old cleanup cannot revoke the new execution', async () => {
  const session = randomUUID(), workspace = process.cwd()
  const first = await publishProjectPreviewCapability(workspace, session, 'http://127.0.0.1:1000/first')
  const [second] = await Promise.all([publishProjectPreviewCapability(workspace, session, 'http://127.0.0.1:1000/second'), first()])
  const path = projectPreviewCapabilityPath(workspace, session)
  expect(JSON.parse(await readFile(path, 'utf8')).apiUrl).toEndWith('/second')
  expect(projectPreviewCapabilityPath(workspace, randomUUID())).not.toBe(path)
  await first(); expect(JSON.parse(await readFile(path, 'utf8')).apiUrl).toEndWith('/second')
  await second(); await expect(readFile(path)).rejects.toThrow()
})
