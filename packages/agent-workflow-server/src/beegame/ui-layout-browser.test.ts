import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { sharedPlaywright } from './shared-playwright'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { saveLayoutBrowserReport, type LayoutVisualCase } from './layout-browser-report'

/** Opt-in free browser conformance test. No model, game workspace or running BGS service. */
test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('portable menu/HUD layouts agree with native browser allocation and actual text metrics', async () => {
  const { chromium } = await import(sharedPlaywright().moduleUrl)
  const defaultExecutable = chromium.executablePath()
  const executablePath = process.env.BGS_LAYOUT_BROWSER_EXECUTABLE ?? defaultExecutable
  if (!existsSync(executablePath)) throw new Error('Set BGS_LAYOUT_BROWSER_EXECUTABLE to an installed Chromium; this test does not install browsers')
  const source = await bundleContentConsumer()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request =>
    new URL(request.url).pathname === '/consumer.mjs'
      ? new Response(source, { headers: { 'Content-Type': 'application/javascript' } })
      : new Response('<!doctype html><meta charset="utf-8"><style>body{margin:0}*{box-sizing:border-box}</style><body></body>', { headers: { 'Content-Type': 'text/html' } }) })
  let browser
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--mute-audio'] })
    const page = await browser.newPage()
    const errors: string[] = []
    const evidence:LayoutVisualCase[]=[]
    page.on('pageerror', (error: Error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.port}`)
    for (const kind of ['menu', 'hud', 'grid', 'pause', 'result'] as const) for (const [width, height] of [[1280, 720], [390, 844], [375, 667], [667, 375], [480, 240]]) {
      await page.setViewportSize({ width, height })
      const result = await page.evaluate(async ({ kind, width, height }: { kind: string; width: number; height: number }) => {
        const consumerUrl = '/consumer.mjs' // Served by this test, not a host filesystem import.
        const lib = await import(consumerUrl)
        await lib.initializeUiLayout()
        document.body.replaceChildren()
        await document.fonts.ready
        const nodes = kind === 'menu' ? [
          { id: 'root', role: 'screen-root', layout: { container: { direction: 'column', gap: 20, justify: 'center', align: 'center' } } },
          { id: 'title', parentId: 'root', role: 'text', text: '游戏标题 / Game', style: { fontSize: 28, lineHeight: 38 } },
          { id: 'actions', parentId: 'root', role: 'container', layout: { container: { direction: 'column', gap: 12 } } },
          { id: 'play', parentId: 'actions', role: 'button', text: '开始游戏', layout: { size: [220, 44] } },
          { id: 'help', parentId: 'actions', role: 'button', text: '操作说明', layout: { size: [220, 44] } },
        ] : kind === 'hud' ? [
          { id: 'root', role: 'hud-root', layout: { container: { direction: 'row', gap: 12, padding: [12, 12, 12, 12], align: 'start' } } },
          { id: 'score', parentId: 'root', role: 'text', text: '得分：1234567', layout: { size: [160, 44], minSize: [160, 44], item: { grow: 1 } } },
          { id: 'pause', parentId: 'root', role: 'button', text: '暂停', layout: { size: [60, 44] } },
        ] : kind === 'grid' ? [
          { id: 'root', role: 'screen-root', layout: { container: { direction: 'grid', columns: 3, gap: 12, padding: [12, 12, 12, 12] } } },
          ...['one', 'two', 'three', 'four'].map(id => ({ id, parentId: 'root', role: 'button', text: id, layout: { size: [1, 44] } })),
        ] : [
          { id: 'root', role: 'screen-root', layout: { container: { direction: 'column', justify: 'center', align: 'center', padding: [16, 16, 16, 16] } } },
          { id: 'panel', parentId: 'root', role: 'container', layout: { container: { direction: 'column', gap: 8, padding: [16, 16, 16, 16] } } },
          { id: 'heading', parentId: 'panel', role: 'text', text: kind === 'pause' ? '暂停 / Paused' : '游戏结束 / Result', style: { fontSize: 24, lineHeight: 32 } },
          { id: 'score', parentId: 'panel', role: 'text', text: '得分：1234567', style: { fontSize: 18, lineHeight: 24 } },
          { id: 'primary', parentId: 'panel', role: 'button', text: kind === 'pause' ? '继续游戏' : '再玩一次', layout: { size: [220, 44], minSize: [220, 44] } },
          { id: 'home', parentId: 'panel', role: 'button', text: '返回菜单', layout: { size: [220, 44], minSize: [220, 44] } },
        ]
        const before = JSON.stringify(nodes)
        const inspected = await lib.inspectUiLayoutInBrowser(nodes, 'root', { width, height }, { fontFamily: () => 'Arial' })
        const rectangles = inspected.nodes
        const byId = new Map<string, HTMLElement>()
        for (const node of nodes as any[]) {
          const el = document.createElement('div')
          el.dataset.id = node.id
          el.textContent = node.text ?? ''
          el.style.font = `400 ${node.style?.fontSize ?? 18}px Arial`
          el.style.lineHeight = `${node.style?.lineHeight ?? 18 * 1.35}px`
          el.style.whiteSpace = 'pre'
          el.style.flexShrink = '0'
          if (node.layout?.size) { el.style.width = `${node.layout.size[0]}px`; el.style.height = `${node.layout.size[1]}px` }
          if (node.layout?.minSize) { el.style.minWidth = `${node.layout.minSize[0]}px`; el.style.minHeight = `${node.layout.minSize[1]}px` }
          if (node.layout?.item?.grow) el.style.flexGrow = String(node.layout.item.grow)
          const flow = node.layout?.container
          if (flow) {
            el.style.display = flow.direction === 'grid' ? 'grid' : 'flex'
            if (flow.direction === 'grid') el.style.gridTemplateColumns = `repeat(${flow.columns},minmax(0,1fr))`
            else el.style.flexDirection = flow.direction
            el.style.gap = `${flow.gap ?? 0}px`
            el.style.justifyContent = flow.justify === 'center' ? 'center' : 'flex-start'
            el.style.alignItems = flow.align ?? 'stretch'
            el.style.alignContent = 'start'
            if (flow.padding) el.style.padding = flow.padding.map((v: number) => `${v}px`).join(' ')
          }
          if (node.id === 'root') { el.style.width = `${width}px`; el.style.height = `${height}px` }
          if (kind === 'grid' && node.id !== 'root') el.style.width = 'auto'
          const parent = node.parentId ? byId.get(node.parentId)! : document.body
          parent.append(el); byId.set(node.id, el)
        }
        return {
          sourcePreserved: JSON.stringify(nodes) === before,
          differences: rectangles.map((rect: any) => {
            const actual = byId.get(rect.id)!.getBoundingClientRect()
            return Math.max(...(['left', 'top', 'right', 'bottom'] as const).map(side => Math.abs(actual[side] - rect.bounds[side])))
          }),
          boundsOk: rectangles.every((rect: any) => !rect.outsideViewport && !rect.outsideParent && !rect.outsideContentArea),
          textMeasured: rectangles.filter((rect: any) => rect.textFit !== 'not-applicable').every((rect: any) => rect.textFit !== 'unmeasured'),
          candidateExplicit: inspected.textMeasurements.every((measurement: any) => measurement.basis === 'candidate-font'),
        }
      }, { kind, width, height })
      expect(result.sourcePreserved).toBe(true)
      expect(result.boundsOk).toBe(true)
      expect(result.textMeasured).toBe(true)
      expect(result.candidateExplicit).toBe(true)
      for (const difference of result.differences) expect(difference).toBeLessThan(.6)
      if(process.env.BGS_LAYOUT_REPORT_DIR)evidence.push({group:'UI 布局计算对照',viewport:`${width} × ${height}`,
        strategy:kind==='menu'?'菜单／纵向布局':kind==='hud'?'HUD／横向布局':kind==='grid'?'等宽网格':kind==='pause'?'暂停弹窗':'结算弹窗',screenshot:await page.screenshot(),checks:[
          `计算结果与原生 CSS 最大边界误差 ${Math.max(...result.differences).toFixed(3)} px（阈值 0.6 px）`,
          '元素未超出父容器、内容区或视口',
          '文字使用真实浏览器字体测量',
          '源布局数据未被改写',
        ]})
    }
    const sampled = await page.evaluate(async () => {
      const consumerUrl = '/consumer.mjs'
      const lib = await import(consumerUrl)
      const source = [
        { id: 'root', role: 'hud-root' },
        { id: 'score', parentId: 'root', role: 'text', text: '0', layout: { size: [35,32] },
          style: { fontSize: 24, lineHeight: 32, letterSpacing: 1 },
          responsive: { compact: { style: { fontSize: 28 } } } },
      ]
      const before = JSON.stringify(source)
      const options = { fontFamily: () => 'monospace', textSamples: { score: ['99999'] } }
      const inspected = await lib.inspectUiLayoutInBrowser(source, 'root', { width: 500, height: 400 }, options)
      const measurement = inspected.textMeasurements[0]
      document.body.replaceChildren()
      const text = document.createElement('span')
      text.style.cssText = 'display:inline-block;white-space:pre;font:400 28px monospace;line-height:32px;letter-spacing:1px'
      text.textContent = '99999'
      document.body.append(text)
      const actual = text.getBoundingClientRect()
      const measured = measurement.values.find((value: any) => value.text === '99999')
      let missingFontRejected = false
      try {
        await lib.inspectUiLayoutInBrowser(source.map(node => node.id === 'score'
          ? { ...node, data: { font: { assetRef: 'MISSING' } } } : node), 'root', { width: 500, height: 400 }, options)
      } catch (error) { missingFontRejected = String(error).includes('actual FontFace') }
      return { sourcePreserved: before === JSON.stringify(source), missingFontRejected,
        fit: inspected.nodes.find((node: any) => node.id === 'score').textFit,
        basis: measurement.basis, widthDifference: Math.abs(actual.width - measured.width),
        heightDifference: Math.abs(actual.height - measured.height) }
    })
    expect(sampled.sourcePreserved).toBe(true)
    expect(sampled.missingFontRejected).toBe(true)
    expect(sampled.fit).toBe('exceeds-intrinsic-bounds')
    expect(sampled.basis).toBe('candidate-font')
    expect(sampled.widthDifference).toBeLessThan(.6)
    expect(sampled.heightDifference).toBeLessThan(.6)
    // Original failed project's final UI inputs remain read-only. Candidate
    // measurements expose text risks, not final-font or aesthetic acceptance.
    const directory = new URL('../../../../docs/verification/layout-2026-10-01/design-tools-retest/after-review/content/ui/', import.meta.url)
    const inputs = readdirSync(directory).filter(file => file.endsWith('.json')).map(file => {
      const url = new URL(file, directory), bytes = readFileSync(url, 'utf8')
      return { url, bytes, source: JSON.parse(bytes) }
    })
    const audit = await page.evaluate(async (inputs: { id: string; data: unknown }[]) => {
      const consumerUrl = '/consumer.mjs'
      const lib = await import(consumerUrl)
      const observations = []
      for (const input of inputs) {
        const data = lib.readUiData(input)
        const before = JSON.stringify(data)
        const root = data.nodes.find((node: any) => node.id === data.rootId)
        for (const [width,height] of root.data.targetViewports) {
          const result = await lib.inspectUiLayoutInBrowser(data.nodes, data.rootId, { width,height }, {
            fontFamily: (node: any) => node.style?.fontFamily ?? 'sans-serif',
          })
          observations.push({ id: input.id, viewport: [width,height], preserved: before === JSON.stringify(data),
            unmeasured: result.nodes.filter((node: any) => node.active && node.textFit === 'unmeasured').map((node: any) => node.id),
            exceeds: result.nodes.filter((node: any) => node.active && node.textFit === 'exceeds-intrinsic-bounds').map((node: any) => node.id),
            allCandidate: result.textMeasurements.every((measurement: any) => measurement.basis === 'candidate-font') })
        }
      }
      return observations
    }, inputs.map(input => input.source))
    for (const observation of audit) {
      expect(observation.preserved).toBe(true)
      expect(observation.unmeasured).toEqual([])
      expect(observation.allCandidate).toBe(true)
    }
    for (const input of inputs) expect(readFileSync(input.url, 'utf8')).toBe(input.bytes)
    console.info('Frozen UI candidate-font observations:', JSON.stringify(audit.map(({ id,viewport,exceeds }:
      { id: string; viewport: number[]; exceeds: string[] }) => ({ id,viewport,exceeds }))))
    // One unchanged reference-plane input, compared with independent native CSS
    // percentage placement and scaling, not per-device projected coordinates.
    for (const [width, height] of [[960, 540], [390, 844], [320, 480], [320, 568]]) {
      await page.setViewportSize({ width, height })
      const result = await page.evaluate(async ({ width, height }: { width: number; height: number }) => {
        const consumerUrl = '/consumer.mjs'
        const lib = await import(consumerUrl)
        const camera = { orthographic: true, orthographicSize: 3.36, pixelsPerUnit: 100,
          viewport: { width: 480, height: 672 }, framing: 'letterbox' }
        const nodes = [
          { id: 'root', role: 'screen-root' },
          { id: 'game', role: 'container', parentId: 'root', layout: { anchorMin: [.02, .02], anchorMax: [.98, .98] } },
          { id: 'plane', role: 'container', parentId: 'game', data: { space: 'camera-reference-2d' }, layout: { size: [480, 672], item: { absolute: true } } },
          { id: 'prompt', role: 'text', parentId: 'plane', text: '发球', layout: { position: [120, 568], size: [240, 24] } },
        ]
        const before = JSON.stringify(nodes)
        const computed = lib.inspectUiLayout(nodes, 'root', { width, height }, { camera: { nodeId: 'game', input: camera } })
        document.body.replaceChildren()
        const game = document.createElement('div')
        game.style.cssText = 'position:absolute;left:2%;top:2%;width:96%;height:96%'
        document.body.append(game)
        const host = game.getBoundingClientRect()
        const frameHeight = Math.min(host.width / camera.viewport.width, host.height / camera.viewport.height) * camera.viewport.height
        const scale = frameHeight / (2 * camera.orthographicSize * camera.pixelsPerUnit)
        const plane = document.createElement('div')
        plane.style.cssText = `position:absolute;left:50%;top:50%;width:480px;height:672px;transform:translate(-50%,-50%) scale(${scale})`
        game.append(plane)
        const prompt = document.createElement('div')
        prompt.style.cssText = 'position:absolute;left:120px;top:568px;width:240px;height:24px;font:24px Arial'
        prompt.textContent = '发球'
        plane.append(prompt)
        const actual = prompt.getBoundingClientRect(), expected = computed.find((node: any) => node.id === 'prompt')
        return { sourcePreserved: before === JSON.stringify(nodes),
          difference: Math.max(...(['left', 'top', 'right', 'bottom'] as const).map(side => Math.abs(actual[side] - expected.bounds[side]))),
          outsideCameraView: expected.outsideCameraView, outsideViewport: expected.outsideViewport }
      }, { width, height })
      expect(result.sourcePreserved).toBe(true)
      expect(result.difference).toBeLessThan(.1)
      expect(result.outsideCameraView).toBe(false)
      expect(result.outsideViewport).toBe(false)
    }
    expect(errors).toEqual([])
    await saveLayoutBrowserReport('ui-layout','UI 布局实测',
      '菜单、HUD、等宽网格、暂停与结算弹窗在五种浏览器尺寸下的计算／原生 CSS 对照。截图是全新计算验证夹具，不是私人游戏、UI Editor 完整验收或视觉设计稿，也不证明任意源布局均能自适应。',evidence)
  } finally {
    await browser?.close()
    server.stop(true)
  }
}, 30000)
