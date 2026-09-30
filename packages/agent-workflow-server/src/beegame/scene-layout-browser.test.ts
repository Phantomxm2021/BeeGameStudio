import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { sharedPlaywright } from './shared-playwright'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { saveLayoutBrowserReport, type LayoutVisualCase } from './layout-browser-report'

test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('actual Tilemap and 3D GLB camera projections agree with computed bounds', async () => {
  const root=fileURLToPath(new URL('../../../../',import.meta.url))
  const {chromium}=await import(sharedPlaywright().moduleUrl)
  const executablePath=process.env.BGS_LAYOUT_BROWSER_EXECUTABLE ?? chromium.executablePath()
  if(!existsSync(executablePath))throw new Error('Use an installed Chromium; this test does not download browsers')
  const reserve=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('reserved')})
  const port=reserve.port;reserve.stop(true)
  const server=Bun.spawn([process.execPath,'node_modules/vite/bin/vite.js','packages/scene-editor/tests/browser',
    '--config','packages/scene-editor/tests/browser/vite.config.mts','--port',String(port)],{cwd:root,stdout:'ignore',stderr:'pipe'})
  let browser, page
  const errors:string[]=[]
  const evidence:LayoutVisualCase[]=[]
  const serverErrors=new Response(server.stderr).text()
  try {
    const url=`http://127.0.0.1:${port}/scene-camera.html`
    let ready=false
    for(let i=0;i<100;i++) {
      try{if((await fetch(url)).ok){ready=true;break}}catch{}
      await Bun.sleep(100)
    }
    if(!ready)throw new Error('Isolated editor fixture server did not become ready')
    const source=await bundleContentConsumer()
    browser=await chromium.launch({executablePath,headless:true,args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
    page=await browser.newPage({viewport:{width:1280,height:720}})
    page.setDefaultTimeout(8000)
    page.on('pageerror',(error:Error)=>errors.push(error.message))
    page.on('console',(message:any)=>{if(message.type()==='error')errors.push(message.text())})
    page.on('response',async(response:any)=>{if(response.status()>=400)errors.push((await response.text()).slice(0,2000))})
    await page.goto(url)
    await page.waitForFunction(()=>Boolean((window as any).sceneCameraFixture),null,{timeout:8000})
    await page.getByRole('button',{name:'Game camera preview',exact:true}).click()
    const frame=page.getByTestId('scene-camera-frame')
    await page.waitForFunction(()=>document.querySelector('[data-framing="expand"]'))
    await page.getByText('Game Camera',{exact:true}).click()
    for(const framing of ['expand','keep-width','keep-height','letterbox']) {
      if(framing!=='expand') {
        await page.getByRole('button',{name:'Camera framing',exact:true}).click()
        await page.getByRole('option',{name:framing,exact:true}).click()
      }
    for(const [width,height] of [[1280,720],[390,844],[667,375],[480,240],[1600,720]]) {
      await page.setViewportSize({width,height})
      await page.waitForTimeout(200)
      const result=await page.evaluate(async ({source,framing}:{source:string;framing:string})=>{
        const lib=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})))
        const fixture=(window as any).sceneCameraFixture
        const host=document.querySelector('[data-testid="scene-camera-host"]')!.getBoundingClientRect()
        const data=structuredClone(fixture.source.data)
        data.nodes[0].components[0].data.framing=framing
        const inspected=lib.inspectSceneLayout2d(data,{width:host.width,height:host.height},()=>fixture.tiles)
        const projected=lib.point2d(inspected.worldToScreen,128,74)
        return {projected,view:inspected.view,sourcePreserved:JSON.stringify(fixture.source)===fixture.before,
          editorPreserved:JSON.stringify(fixture.doc)===fixture.editorBefore}
      },{source,framing})
      expect(result.sourcePreserved).toBe(true);expect(result.editorPreserved).toBe(true)
      const box=await frame.boundingBox()
      expect(Math.abs(box!.width-result.view.rect.width)).toBeLessThan(.6)
      expect(Math.abs(box!.height-result.view.rect.height)).toBeLessThan(.6)
      const pixels=await sharp(await frame.locator('canvas').screenshot()).ensureAlpha().raw().toBuffer({resolveWithObject:true})
      const x=Math.round(result.projected[0]-result.view.rect.x),y=Math.round(result.projected[1]-result.view.rect.y)
      const offset=(y*pixels.info.width+x)*4
      expect(pixels.data[offset]).toBeGreaterThan(200)
      expect(pixels.data[offset+1]).toBeLessThan(40)
      expect(pixels.data[offset+2]).toBeLessThan(40)
      if(process.env.BGS_LAYOUT_REPORT_DIR)evidence.push({group:'2D Tilemap',viewport:`${width} × ${height}`,strategy:framing,
        screenshot:await page.getByTestId('scene-camera-host').screenshot(),checks:[
          '实际 Tilemap 像素与计算位置一致',
          `取景区域尺寸误差 ${Math.max(Math.abs(box!.width-result.view.rect.width),Math.abs(box!.height-result.view.rect.height)).toFixed(3)} px`,
          '原始 Scene JSON 与初始编辑器数据未被改写',
        ]})
    }
    }
    await page.getByRole('button',{name:'Game camera preview',exact:true}).click()
    expect(await frame.getAttribute('data-framing')).toBeNull()

    await page.setViewportSize({width:1280,height:720})
    await page.goto(`http://127.0.0.1:${port}/scene-camera-3d.html`)
    await page.waitForFunction(()=>Boolean((window as any).sceneCamera3dFixture))
    await page.getByText('Main Camera',{exact:true}).click()
    await page.waitForTimeout(400)
    const redBounds=async()=>{
      const pixels=await sharp(await frame.locator('canvas').screenshot()).ensureAlpha().raw().toBuffer({resolveWithObject:true})
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
      for(let y=0;y<pixels.info.height;y++)for(let x=0;x<pixels.info.width;x++){
        const at=(y*pixels.info.width+x)*4
        if(pixels.data[at]>200&&pixels.data[at+1]<40&&pixels.data[at+2]<40){
          left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1)
        }
      }
      expect(Number.isFinite(left)).toBe(true)
      return {left,right,top,bottom}
    }
    // Change observer zoom first; leaving preview must not reset it.
    await frame.locator('canvas').hover()
    await page.mouse.wheel(0,-120)
    await page.waitForTimeout(200)
    const observerBefore=await redBounds()
    await page.getByRole('button',{name:'Game camera preview',exact:true}).click()
    for(const orthographic of [false,true]) {
      await page.setViewportSize({width:1280,height:720})
      if(orthographic)await page.getByRole('switch',{name:'Camera orthographic',exact:true}).click()
      for(const framing of ['expand','keep-height','keep-width','letterbox']) {
        await page.setViewportSize({width:1280,height:720})
        await page.getByRole('button',{name:'Camera framing',exact:true}).click()
        await page.getByRole('option',{name:framing,exact:true}).click()
        for(const [width,height] of [[1280,720],[390,844],[667,375]]) {
          await page.setViewportSize({width,height});await page.waitForTimeout(150)
          const expected=await page.evaluate(({orthographic,framing}:any)=>{
            const fixture=(window as any).sceneCamera3dFixture
            const host=document.querySelector('[data-testid="scene-camera-host"]')!.getBoundingClientRect()
            return {...fixture.expected(orthographic,framing,{width:host.width,height:host.height}),preserved:JSON.stringify(fixture.doc)===fixture.before}
          },{orthographic,framing})
          expect(expected.preserved).toBe(true)
          const actual=await redBounds()
          for(const edge of ['left','right','top','bottom'] as const)expect(Math.abs(actual[edge]-expected.bounds[edge])).toBeLessThan(3)
          const box=await frame.boundingBox()
          expect(Math.abs(box!.width-expected.view.rect.width)).toBeLessThan(.6)
          expect(Math.abs(box!.height-expected.view.rect.height)).toBeLessThan(.6)
          if(process.env.BGS_LAYOUT_REPORT_DIR)evidence.push({group:orthographic?'3D 正交':'3D 透视',viewport:`${width} × ${height}`,strategy:framing,
            screenshot:await page.getByTestId('scene-camera-host').screenshot(),expectedBounds:{
              left:expected.bounds.left+expected.view.rect.x,right:expected.bounds.right+expected.view.rect.x,
              top:expected.bounds.top+expected.view.rect.y,bottom:expected.bounds.bottom+expected.view.rect.y},checks:[
              `模型边界最大误差 ${Math.max(...(['left','right','top','bottom'] as const).map(edge=>Math.abs(actual[edge]-expected.bounds[edge]))).toFixed(3)} px（阈值 3 px）`,
              '父级位置与 quaternion 旋转参与实际渲染',
              '初始编辑器数据未被改写',
            ]})
        }
      }
    }
    await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(150)
    await page.getByRole('button',{name:'Game camera preview',exact:true}).click()
    await page.waitForTimeout(150)
    expect(await redBounds()).toEqual(observerBefore)
    expect(errors).toEqual([])
    await saveLayoutBrowserReport('scene-camera','Scene 取景实测',
      '隔离 Scene Editor 夹具：真实 2D Tilemap／3D GLB 渲染、四种取景策略和横竖屏对照。只验证静态投影与数据保持；不代表真实游戏布局、美术、玩法或 XR 真机验收。退出预览后的自由相机位置与缩放恢复也已通过。',evidence)
    if(process.env.BGS_LAYOUT_REPORT_DIR)console.info('Scene report saved; closing owned browser and fixture server')
  } catch(error) {
    server.kill();await server.exited
    const ui=await page?.locator('body').innerText().catch(()=> '')
    throw new Error(`${String(error)}\nFixture UI: ${ui?.slice(-2500)}\nBrowser errors: ${errors.join('\n')}\nFixture server: ${(await serverErrors).slice(-6000)}`)
  } finally {
    try { await browser?.close();if(process.env.BGS_LAYOUT_REPORT_DIR)console.info('Owned browser closed') }
    finally {
      server.kill();await server.exited
      if(process.env.BGS_LAYOUT_REPORT_DIR)console.info('Owned fixture server exited')
      await serverErrors
      if(process.env.BGS_LAYOUT_REPORT_DIR)console.info('Fixture stderr drained')
    }
  }
},90000)
