import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
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
        const canvas = document.createElement('canvas')
        const measureText = lib.createUiTextMeasurer(canvas.getContext('2d'), () => 'Arial')
        const rectangles = lib.inspectUiLayout(nodes, 'root', { width, height }, { measureText })
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
        }
      }, { kind, width, height })
      expect(result.sourcePreserved).toBe(true)
      expect(result.boundsOk).toBe(true)
      expect(result.textMeasured).toBe(true)
      for (const difference of result.differences) expect(difference).toBeLessThan(.6)
      if(process.env.BGS_LAYOUT_REPORT_DIR)evidence.push({group:'UI 布局计算对照',viewport:`${width} × ${height}`,
        strategy:kind==='menu'?'菜单／纵向布局':kind==='hud'?'HUD／横向布局':kind==='grid'?'等宽网格':kind==='pause'?'暂停弹窗':'结算弹窗',screenshot:await page.screenshot(),checks:[
          `计算结果与原生 CSS 最大边界误差 ${Math.max(...result.differences).toFixed(3)} px（阈值 0.6 px）`,
          '元素未超出父容器、内容区或视口',
          '文字使用真实浏览器字体测量',
          '源布局数据未被改写',
        ]})
    }
    expect(errors).toEqual([])
    await saveLayoutBrowserReport('ui-layout','UI 布局实测',
      '菜单、HUD、等宽网格、暂停与结算弹窗在五种浏览器尺寸下的计算／原生 CSS 对照。截图是全新计算验证夹具，不是私人游戏、UI Editor 完整验收或视觉设计稿，也不证明任意源布局均能自适应。',evidence)
  } finally {
    await browser?.close()
    server.stop(true)
  }
}, 30000)
