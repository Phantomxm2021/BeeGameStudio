import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resourceIrDeliveryIssues } from './resource-ir-delivery'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function gameIr(variants: unknown[], artifacts: unknown[]) {
  return {
    modules: [{
      moduleId: 'resource-realization',
      nodes: [...variants, ...artifacts],
    }],
  }
}

const variant = (id: string, activation: unknown) => ({
  id,
  kind: 'resource-realization.variant',
  value: { activation },
  edges: [],
})

const artifact = (
  id: string,
  variantId: string,
  path: string,
  artifactClass: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'resource-realization.delivery-artifact',
  value: { path, artifactClass, format: path.split('.').at(-1), ...extra },
  edges: [{ type: 'part-of', targetId: variantId }],
})

test('requires every concrete artifact of a required IR variant', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'resource-ir-delivery-'))
  roots.push(workspace)
  const ir = gameIr(
    [variant('primary', { kind: 'required' })],
    [artifact('scene', 'primary', 'src/scene.ts', 'generated-output')],
  )
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['generated-output'],
  })).toEqual(['IR delivery artifact is invalid: src/scene.ts (missing).'])

  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/scene.ts'), 'export const scene = {}')
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['generated-output'],
  })).toEqual([])
})

test('accepts one complete alternative variant and rejects an unregistered resource path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'resource-ir-delivery-'))
  roots.push(workspace)
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  await writeFile(
    join(workspace, 'assets/runtime/a.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8y3WQAAAABJRU5ErkJggg==', 'base64'),
  )
  const ir = gameIr(
    [
      variant('a', { kind: 'alternative', groupId: 'visual' }),
      variant('b', { kind: 'alternative', groupId: 'visual' }),
    ],
    [
      artifact('a-image', 'a', 'assets/runtime/a.png', 'runtime-resource'),
      artifact('b-image', 'b', 'assets/runtime/b.png', 'runtime-resource'),
    ],
  )
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['runtime-resource'],
    registeredResourcePaths: new Set(),
  })).toEqual(['No complete IR delivery variant exists for alternative group visual.'])
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['runtime-resource'],
    registeredResourcePaths: new Set(['assets/runtime/a.png']),
  })).toEqual([])
})

test('defers a mixed-class alternative to the stage that can complete either variant', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'resource-ir-delivery-'))
  roots.push(workspace)
  const ir = gameIr(
    [
      variant('resource-choice', { kind: 'alternative', groupId: 'presentation' }),
      variant('code-choice', { kind: 'alternative', groupId: 'presentation' }),
    ],
    [
      artifact('image', 'resource-choice', 'assets/runtime/image.png', 'runtime-resource'),
      artifact('code', 'code-choice', 'src/presentation.ts', 'generated-output'),
    ],
  )
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['runtime-resource'],
    registeredResourcePaths: new Set(),
  })).toEqual([])
})

test('rejects wrong file signatures and measurable file-size budgets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'resource-ir-delivery-'))
  roots.push(workspace)
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/image.png'), 'not a png')
  const ir = gameIr(
    [variant('primary', { kind: 'required' })],
    [artifact('image', 'primary', 'assets/runtime/image.png', 'runtime-resource', {
      budgets: [{ metric: 'file-size', limit: 4, unit: 'bytes' }],
    })],
  )
  expect(resourceIrDeliveryIssues({
    gameIr: ir,
    workspacePath: workspace,
    artifactClasses: ['runtime-resource'],
    registeredResourcePaths: new Set(['assets/runtime/image.png']),
  })).toEqual([
    'IR delivery artifact is invalid: assets/runtime/image.png (content is not valid png).',
  ])
})
