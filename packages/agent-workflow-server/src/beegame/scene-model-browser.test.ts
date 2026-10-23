import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { sharedPlaywright } from './shared-playwright'

test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('adding a textured GLB preserves its materials, animation and independent parts', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const { chromium } = await import(sharedPlaywright().moduleUrl)
  const executablePath = process.env.BGS_LAYOUT_BROWSER_EXECUTABLE ?? chromium.executablePath()
  if (!existsSync(executablePath)) throw Error('Use an installed Chromium; this test does not download browsers')
  const reserve = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') })
  const port = reserve.port; reserve.stop(true)
  const server = Bun.spawn([process.execPath, 'node_modules/vite/bin/vite.js', 'packages/scene-editor/tests/browser', '--config', 'packages/scene-editor/tests/browser/vite.config.mts', '--port', String(port)], { cwd: root, stdout: 'ignore', stderr: 'pipe' })
  const serverErrors = new Response(server.stderr).text()
  const errors: string[] = []
  let browser, page
  try {
    const url = `http://127.0.0.1:${port}/scene-model.html`
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
      await Bun.sleep(100)
    }
    if (!ready) throw Error('Isolated model fixture server did not become ready')
    browser = await chromium.launch({ executablePath, headless: true, args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(8000)
    await page.route('**/favicon.ico', (route: any) => route.fulfill({ status: 204, body: '' }))
    page.on('pageerror', (error: Error) => errors.push(error.message))
    page.on('console', (message: any) => { if (message.type() === 'error') errors.push(message.text()) })
    const sample = async (canvas: any, name: string) => {
      const png = await canvas.screenshot()
      if (process.env.BGS_LAYOUT_REPORT_DIR) {
        await mkdir(process.env.BGS_LAYOUT_REPORT_DIR, { recursive: true })
        await writeFile(`${process.env.BGS_LAYOUT_REPORT_DIR}/${name}.png`, png)
      }
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const pixels = [0, 0, 0], sumX = [0, 0, 0], sumY = [0, 0, 0]
      // Scene panels overlay the full-screen canvas; exclude their UI colours.
      const scene = name !== 'model-preview'
      for (let y = scene ? Math.ceil(info.height * .16) : 0; y < info.height * (scene ? .9 : 1); y++) for (let x = scene ? Math.ceil(info.width * .25) : 0; x < info.width * (scene ? .75 : 1); x++) {
        const at = (y * info.width + x) * 4
        for (let c = 0; c < 3; c++) if (data[at + c] > 180 && data[at + c] > data[at + (c + 1) % 3] + 60 && data[at + c] > data[at + (c + 2) % 3] + 60) { pixels[c]++; sumX[c] += x; sumY[c] += y }
      }
      return { pixels, x: sumX.map((sum, i) => sum / pixels[i]), y: sumY.map((sum, i) => sum / pixels[i]) }
    }
    await page.goto(url)
    await page.waitForFunction(() => Boolean((window as any).sceneModelFixture))
    await page.getByRole('button', { name: 'Scene actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Asset library', exact: true }).click()
    await page.getByTitle('textured-parts.glb · Right-click for actions').dblclick()
    const preview = page.getByLabel('Preview textured-parts.glb').locator('canvas')
    await page.waitForTimeout(600)
    const original = await sample(preview, 'model-preview')
    expect(original.pixels.every(count => count > 50), JSON.stringify(original)).toBe(true)
    await page.getByRole('button', { name: 'Back to asset library', exact: true }).click()
    await page.getByTitle('textured-parts.glb · Right-click for actions').click({ button: 'right' })
    // This isolated fixture loads editor CSS only, without the app's portal layering.
    // Activate the existing menu handler; the editor's normal add/validate/render path still runs.
    await page.getByRole('menuitem', { name: 'Add to scene', exact: true }).evaluate((button: HTMLElement) => button.click())
    await page.getByRole('button', { name: 'Game camera preview', exact: true }).click()
    // Select the camera so selection outlines cannot contribute to model pixels.
    await page.getByTestId('scene-tree-item-camera').getByText('Main Camera', { exact: true }).click()
    const canvas = page.getByTestId('scene-camera-frame').locator('canvas')
    await page.waitForTimeout(500)
    const first = await sample(canvas, 'model-added')
    expect(first.pixels.every(count => count > 50), JSON.stringify({ original, added: first })).toBe(true)
    const samples = [first]
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(230); samples.push(await sample(canvas, `model-motion-${i}`)) }
    expect(Math.max(...samples.map(s => s.x[2])) - Math.min(...samples.map(s => s.x[2]))).toBeGreaterThan(20)
    for (const sample of samples) {
      expect(sample.pixels.every(count => count > 50)).toBe(true)
      expect(Math.abs(sample.x[0] - first.x[0])).toBeLessThan(1)
      expect(Math.abs(sample.x[1] - first.x[1])).toBeLessThan(1)
      expect(Math.abs(sample.y[2] - first.y[2])).toBeLessThan(1)
    }
    await page.getByRole('button', { name: 'Scene actions', exact: true }).click()
    await page.getByRole('menuitem', { name: /Save scene/ }).click()
    const saved = await page.evaluate(() => (window as any).sceneModelFixture.saved)
    const model = Object.values(saved.nodes).find((node: any) => node.components.some((component: any) => component.type === 'mesh-filter')) as any
    expect(model.components.find((component: any) => component.type === 'mesh-renderer').material).toBeUndefined()
    expect(await page.evaluate(() => { const f = (window as any).sceneModelFixture; return JSON.stringify(f.doc) === f.before })).toBe(true)
    await page.goto(`${url}?override`)
    await page.waitForFunction(() => Boolean((window as any).sceneModelFixture))
    await page.getByRole('button', { name: 'Game camera preview', exact: true }).click()
    await page.waitForTimeout(500)
    const overridden = await sample(canvas, 'model-explicit-override')
    expect(overridden.pixels[0]).toBeGreaterThan(1000)
    expect(overridden.pixels[1]).toBe(0)
    expect(overridden.pixels[2]).toBe(0)
    expect(errors).toEqual([])
  } catch (error) {
    const ui = await page?.locator('body').innerText().catch(() => '')
    throw Error(`${String(error)}\nFixture UI: ${ui?.slice(-2500)}\nBrowser errors: ${errors.join('\n')}`)
  } finally {
    try { await browser?.close() } finally { server.kill(); await server.exited; await serverErrors }
  }
}, 60000)
