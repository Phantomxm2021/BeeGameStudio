import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runChecks, checkIsCurrent } from './checks'
import type { TaskSpec } from './state'

const task: TaskSpec = { id: 'smoke', kind: 'game.verify', goal: 'Observe actual static build', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
  writablePaths: [], expectedOutputs: ['dist/index.html'], checks: ['runtime-smoke'], runtimeArtifact: 'dist' }

for (const kind of ['surface', 'script-error', 'missing-resource', 'external', 'websocket', 'empty'] as const) {
  test('actual host Chromium static build: '+kind, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-browser-'))
    try {
      await mkdir(join(root, 'dist'))
      const extra = kind === 'script-error' ? '<script>throw Error("fixture runtime error")</script>'
        : kind === 'missing-resource' ? '<script src="/missing.js"></script>'
        : kind === 'external' ? '<script>fetch("http://outside.invalid/private")</script>'
        : kind === 'websocket' ? '<script>new WebSocket("ws://outside.invalid/private")</script>' : ''
      await writeFile(join(root, 'dist/index.html'), '<!doctype html><body>'+(kind === 'empty' ? '' : '<canvas width="100" height="100"></canvas>')+extra+'</body>')
      const checked = (await runChecks(root, task, [])).checks[0]!
      expect(checked.status, checked.observation).toBe(kind === 'surface' ? 'passed' : ['external', 'websocket', 'empty'].includes(kind) ? 'unverified' : 'failed')
      expect(checked.observation).toContain('Initial load/error smoke only')
      expect(checked.artifacts?.[0]?.path).toBe('dist')
      expect(await checkIsCurrent(root, checked)).toBe(true)
      await writeFile(join(root, 'dist/added.js'), '// later build output')
      expect(await checkIsCurrent(root, checked)).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
}

test('cancelling a busy observed build terminates the owned driver/browser, keeps bytes and never accepts PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-browser-cancel-'))
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await mkdir(join(root, 'dist'))
    const body = '<!doctype html><body>busy fixture<script>setInterval(()=>fetch("/index.html?tick="+Date.now()),20)</script></body>'
    await writeFile(join(root, 'dist/index.html'), body)
    timer = setTimeout(() => controller.abort(), 1500)
    const result = (await runChecks(root, task, [], controller.signal)).checks[0]!
    expect(result.status).toBe('execution-error')
    expect(result.observation).toContain('cancelled')
    expect(await Bun.file(join(root, 'dist/index.html')).text()).toBe(body)
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }) }
}, 30000)
