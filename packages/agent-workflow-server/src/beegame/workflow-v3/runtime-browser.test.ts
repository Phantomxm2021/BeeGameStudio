import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { previewTestHostDocument } from '../preview-test-access'
import { sharedPlaywright } from '../shared-playwright'
import { audioProbeWav } from './audio-consumption'

// Driver regression only: prepared operands isolate iframe/CDP/media behavior
// from resource authoring/acceptance. These are not game delivery fixtures.
test.each(['audio', 'font'] as const)('prepared %s driver observes its game frame inside the Preview sandbox', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-frame-driver-'))
  const browser = createPreviewTestBrowser()
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
  let child: ReturnType<typeof Bun.spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const audio = mode === 'audio', path = audio ? 'clip.wav' : 'font.ttf'
    const bytes = audio ? audioProbeWav(false) : await readFile(process.platform === 'darwin'
      ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    const before = audio ? { volume: .6, loop: false } : { text: 'Signal 19AB', fontSize: 28 }
    const body = JSON.stringify(before)
    const html = audio
      ? '<button id="start">Play</button><button id="stop">Stop</button><audio id="clip" crossorigin="anonymous" src="./clip.wav"></audio>' +
        '<script type="module">const d=await fetch("./fixture.json").then(r=>r.json()),a=document.querySelector("audio");a.volume=d.volume;a.loop=d.loop;' +
        'document.querySelector("#start").onclick=()=>a.play();document.querySelector("#stop").onclick=()=>a.pause();</script>'
      : '<style>@font-face{font-family:Fixture;src:url("./font.ttf")}#label{font-family:Fixture,serif;width:500px;height:80px}</style><div id="label"></div>' +
        '<script type="module">const d=await fetch("./fixture.json").then(r=>r.json()),e=document.querySelector("#label");e.textContent=d.text;e.style.fontSize=d.fontSize+"px";</script>'
    const content = { 'index.html': html, 'fixture.json': body, [path]: bytes }
    for (const [file, value] of Object.entries(content)) await writeFile(join(root, file), value)
    const variants = audio
      ? [{ property: 'volume', expected: { volume: .73, loop: false } }, { property: 'loop', expected: { volume: .6, loop: true } }]
      : [{ property: 'text', expected: { text: 'Changed 27CD', fontSize: 28 } }, { property: 'font-size', expected: { text: 'Signal 19AB', fontSize: 36 } }]
    const probe = { mode, document: 'fixture.json', nodeId: 'target', componentId: 'sound',
      selector: audio ? '#clip' : '#label', viewport: [960, 540], originalSha256: hash(body),
      resource: { path, sha256: hash(bytes) }, before,
      variants: variants.map(value => ({ ...value, replacement: JSON.stringify(value.expected) })),
      ...(audio ? { playSteps: [{ click: '#start' }], stopSteps: [{ click: '#stop' }], silence: audioProbeWav().toString('base64') } : {}) }
    const { endpoint } = await browser.start()
    const node = Bun.which('node')
    if (!node) throw Error('Installed Node required; no download attempted')
    const driver = Bun.spawn([node, fileURLToPath(new URL('./runtime-browser.mjs', import.meta.url))], {
      cwd: root, env: { PATH: process.env.PATH, BGS_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    child = driver
    timer = setTimeout(() => child?.kill(), 20000)
    const entryUrl = 'http://bgs-runtime.invalid/previews/measurement/index.html'
    driver.stdin.write(JSON.stringify({ endpoint, artifact: root, uiProbes: [probe],
      entryUrl, previewHost: previewTestHostDocument(new URL(entryUrl)),
      files: Object.entries(content).map(([file, value]) => ({ path: file, sha256: hash(value), mime: Bun.file(join(root, file)).type })) }))
    driver.stdin.end()
    const [code, output, error] = await Promise.all([driver.exited, new Response(driver.stdout).text(), new Response(driver.stderr).text()])
    expect(code, error).toBe(0)
    const report = JSON.parse(output)
    expect(report.probes[0].status, output).toBe('passed')
    expect(report.probes[0].conditions.environment).toMatchObject({ embedding: 'sandboxed-iframe', origin: 'null' })
    expect(report.errors).toEqual([])
    expect(await readFile(join(root, 'fixture.json'), 'utf8')).toBe(body)
  } finally {
    clearTimeout(timer); if (child && child.exitCode === null) { child.kill(); await child.exited }
    await browser.close(); await rm(root, { recursive: true, force: true })
  }
}, 30000)
