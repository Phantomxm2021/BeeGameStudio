import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkIsCurrent } from './checks'
import { runArtifactCheck } from './runtime-checks'

const task = { expectedOutputs: ['dist/index.html'], runtimeArtifact: 'dist' }

for (const orientation of ['Landscape','Portrait']) test('publication Touch smoke preserves its stated viewport: '+orientation, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-phone-smoke-'))
  try {
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist/index.html'), '<body><button>Start</button><script>if(innerWidth<900)throw Error("phone-only failure")</script>')
    const result = await runArtifactCheck(root,'runtime-smoke',task,[],{platform:'Web',inputs:['Touch'],orientation})
    expect(result.status,result.observation).toBe('passed')
    const observed=JSON.parse(result.observation)
    expect(observed.viewport).toEqual([1280,720])
    expect(observed.phone).toBeUndefined()
    expect(observed.environment.maxTouchPoints).toBeGreaterThan(0)
    expect(observed.errors).toEqual([])
    const desktop=await runArtifactCheck(root,'runtime-smoke',task,[],{platform:'Web',inputs:['Keyboard'],orientation})
    expect(desktop.status,desktop.observation).toBe('passed')
  } finally { await rm(root,{recursive:true,force:true}) }
},30000)

for (const kind of ['surface', 'script-error', 'missing-resource', 'external', 'websocket', 'empty'] as const) {
  test('actual host Chromium static build: '+kind, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-browser-'))
    try {
      await mkdir(join(root, 'dist'))
      const extra = kind === 'script-error' ? '<script>throw Error("fixture runtime error")</script>'
        : kind === 'missing-resource' ? '<script src="./missing.js"></script>'
        : kind === 'external' ? '<script>fetch("http://outside.invalid/private")</script>'
        : kind === 'websocket' ? '<script>new WebSocket("ws://outside.invalid/private")</script>' : ''
      await writeFile(join(root, 'dist/index.html'), '<!doctype html><body>'+(kind === 'empty' ? '' : '<canvas width="100" height="100"></canvas>')+extra+'</body>')
      const checked = await runArtifactCheck(root, 'runtime-smoke', task, [], {})
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
    const body = '<!doctype html><body>busy fixture<script>setInterval(()=>fetch("./index.html?tick="+Date.now()),20)</script></body>'
    await writeFile(join(root, 'dist/index.html'), body)
    timer = setTimeout(() => controller.abort(), 1500)
    const result = await runArtifactCheck(root, 'runtime-smoke', task, [], {}, controller.signal)
    expect(result.status).toBe('execution-error')
    expect(result.observation).toContain('cancelled')
    expect(await Bun.file(join(root, 'dist/index.html')).text()).toBe(body)
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }) }
}, 30000)
