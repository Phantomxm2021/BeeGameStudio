import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import { runContentCheck } from './content-checks'
import { measurementSummary } from './agent-measurement'
import type { AgentMeasurement } from './state'

test.each(['bound', 'wrong-frame', 'missing-resource', 'missing-file', 'no-binding'] as const)(
  'UI binding coverage preserves every node and reports actual selections: %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-ui-bindings-'))
    try {
      await mkdir(join(root, 'assets/runtime'), { recursive: true })
      await mkdir(join(root, 'content/ui'), { recursive: true })
      const image = 'assets/runtime/sheet.png', atlas = 'assets/runtime/sheet.json'
      await writeFile(join(root, image), await sharp({ create: {
        width: 8, height: 4, channels: 4, background: '#ff0000',
      } }).png().toBuffer())
      await writeFile(join(root, atlas), JSON.stringify({ frames: {
        primary: { frame: { x: 0, y: 0, w: 4, h: 4 } },
        secondary: { frame: { x: 4, y: 0, w: 4, h: 4 } },
      } }))
      const manifest = assetManifestAuthoringExamples().canonical
      manifest.project_target!.asset_format_capabilities = ['png', 'json']
      manifest.requirements = []
      manifest.resources = mode === 'missing-resource' ? [] : [{
        ...manifest.resources[0]!, id: 'art', fulfills: [], dimension: '2D', asset_kind: 'sprite-atlas',
        root_path: image, file_paths: [image, atlas],
      }]
      await writeBeeGameAssetManifest(root, manifest)
      if (mode === 'missing-file') await rm(join(root, image))
      const ui: any = uiLayoutFixture()
      // Even a registered atlas does not establish a UI node binding.
      ui.assetRefs = ['art']
      if (mode !== 'no-binding') ui.data.nodes[1].data = { image: {
        assetRef: 'art', member: image, atlasMember: atlas, frame: mode === 'wrong-frame' ? 'absent' : 'primary',
      } }
      ui.data.nodes.push({ id: 'panel', role: 'shape', parentId: 'root', data: { variant: 'cream' } })
      ui.data.nodes.push({ id: 'badge', role: 'image', parentId: 'root', assetRef: 'art',
        data: { member: image, atlasMember: atlas, frame: 'secondary' } })
      const document = 'content/ui/menu.json', body = JSON.stringify(ui)
      await writeFile(join(root, document), body)
      const check = await runContentCheck(root, 'content-resources', { expectedOutputs: [document] }, [], {})
      const rows = check.coverage!.uiNodeBindings!
      expect(rows.map(row => row.nodeId)).toEqual(['root', 'play', 'panel', 'badge'])
      expect(rows.find(row => row.nodeId === 'panel')).toMatchObject({ bindings: [], resolution: 'not-declared' })
      const play = rows.find(row => row.nodeId === 'play')!
      expect(play.resolution).toBe(mode === 'no-binding' ? 'not-declared' : mode === 'bound' ? 'resolved' : 'invalid')
      if (mode !== 'no-binding') expect(play.bindings[0]).toMatchObject({
        location: 'node.data.image', assetRef: 'art', member: image, atlasMember: atlas,
      })
      if (mode === 'wrong-frame') expect(play.issues.join(' ')).toContain('absent')
      if (mode === 'missing-resource') expect(play.issues.join(' ')).toContain('Unknown resource')
      expect(check.status).toBe(mode === 'bound' || mode === 'no-binding' ? 'passed' : 'failed')
      if (mode === 'bound' || mode === 'no-binding') expect(rows.find(row => row.nodeId === 'badge')).toMatchObject({
        resolution: 'resolved', bindings: [{ location: 'node', assetRef: 'art', frame: 'secondary' }],
      })
      expect(await readFile(join(root, document), 'utf8')).toBe(body)

      // Synthetic host geometry observation only; no browser or paid service.
      const record: AgentMeasurement = { id: 'synthetic', requestKey: 'test', runtimeArtifact: 'dist',
        reportPaths: [], reports: [], requirementsRevision: 'test', startedAt: new Date().toISOString(),
        checks: [check, { id: 'ui-data-consumption', version: 'test', status: 'passed', inputs: [],
          createdAt: new Date().toISOString(), observation: JSON.stringify({ probes: [
            { document, nodeId: 'play', status: 'passed', viewport: [960, 540] },
          ] }) }],
      }
      const before = JSON.stringify(record), summary = measurementSummary(record, true)
      const reported = summary.uiBindingCoverage.nodes!
      expect(reported.find(row => row.nodeId === 'play')!.observations.map((item: any) => item.checkId)).toEqual(['ui-data-consumption'])
      expect(reported.find(row => row.nodeId === 'badge')!.observations).toEqual([])
      const compact = measurementSummary(record, false)
      expect(compact.uiBindingCoverage).toMatchObject({ nodeCount: 4, unobservedNodeCount: 3, nodesScope: 'issues-only' })
      expect(compact.uiBindingCoverage.nodes!.map(node => node.nodeId)).toEqual(rows.filter(row => row.issues.length || row.resolution === 'invalid' || row.resolution === 'unverified').map(row => row.nodeId))
      expect(compact.checks.find(check => check.id === 'content-resources')!.coverage).not.toHaveProperty('uiNodeBindings')
      expect(summary.uiBindingCoverage.limitation).toContain('do not verify image/frame consumption')
      expect(summary.quality).toBe('unverified')
      expect(summary.deliveryEligible).toBe(false)
      expect(JSON.stringify(record)).toBe(before)
      expect(measurementSummary({ ...record, checks: [] }).uiBindingCoverage.nodes).toBeNull()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
