import {expect, test} from 'bun:test'
import {existsSync} from 'node:fs'
import {sharedPlaywright} from './shared-playwright'
import {bundleContentConsumer} from './game-content-consumer-cli'

test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('shared UI backgrounds and Scene tint/alpha consume saved data in an offline browser',async()=>{
  const {chromium}=await import(sharedPlaywright().moduleUrl)
  const executablePath=process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()
  if(!existsSync(executablePath))throw Error('An installed Chromium is required; no browser download')
  const source=await bundleContentConsumer()
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/consumer.mjs'
    ?new Response(source,{headers:{'content-type':'text/javascript'}}):new Response('<!doctype html><body>')})
  let browser
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--mute-audio']})
    const page=await browser.newPage()
    await page.route('**/*',(route:any)=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort())
    await page.goto(server.url.href)
    const result=await page.evaluate(async()=>{
      const modulePath='/consumer.mjs';const lib=await import(modulePath)
      const ui={schema:'beegame-content.v1',id:'menu',kind:'ui-screen',assetRefs:[],data:{rootId:'root',nodes:[
        {id:'root',role:'screen-root'},
        {id:'panel',parentId:'root',role:'button',text:'Start',layout:{size:[100,40]},
          style:{background:{color:'#204060',opacity:.25,radius:12},opacity:.8}},
      ]}}
      const beforeUi=JSON.stringify(ui)
      const host=document.createElement('div');document.body.append(host)
      const surface=await lib.createProductionUiSurface(host)
      const uiSupport=lib.inspectProductionUiSupport(lib.readUiData(ui))
      surface.render(lib.readUiData(ui),{width:200,height:100})
      const element=host.querySelector('[data-node-id="panel"]') as HTMLElement
      const style=getComputedStyle(element)
      const uiResult={supported:uiSupport.supported,background:style.backgroundColor,radius:style.borderRadius,opacity:style.opacity,text:element.textContent}
      const image=document.createElement('canvas');image.width=3;image.height=1
      const imageCtx=image.getContext('2d')!
      imageCtx.putImageData(new ImageData(new Uint8ClampedArray([0,255,0,255,200,100,50,128,240,220,200,255]),3,1),0,0)
      const scene:any={schema:'beegame-content.v1',id:'level',kind:'scene-2d',assetRefs:['sprite'],data:{cameraNodeId:'camera',settings:{coordinateSystem:{pixelsPerUnit:100}},nodes:[
        {id:'camera',transform:{position:[1,.5,0]},components:[{id:'camera-component',type:'camera',data:{orthographic:true,orthographicSize:.005,coordinateSpace:'logical-pixels',viewport:{width:2,height:1}}}]},
        {id:'sprite',transform:{position:[1,.5,0]},components:[{id:'sprite-component',type:'sprite-renderer',assetRef:'sprite',data:{size:[2,1],color:'#ffffff',opacity:1,material:{color:'#80ff00',opacity:.5}}}]},
      ]}}
      const beforeScene=JSON.stringify(scene),canvas=document.createElement('canvas')
      const assets=new Map([['sprite',{source:image,url:'memory',frame:[1,0,2,1]}]])
      const sceneSupport=lib.inspectProductionSceneSupport(lib.readSceneData(scene))
      const createElement=document.createElement
      let sceneCanvasCreations=0
      document.createElement=function(this:Document,name:string,options?:ElementCreationOptions) {
        if(name==='canvas')sceneCanvasCreations++
        return Reflect.apply(createElement,this,[name,options])
      } as typeof document.createElement
      lib.renderProductionScene2d(canvas,lib.readSceneData(scene),{width:2,height:1},assets)
      const scenePreserved=beforeScene===JSON.stringify(scene)
      const tinted=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      lib.renderProductionScene2d(canvas,lib.readSceneData(scene),{width:2,height:1},assets)
      const tintedAgain=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      delete scene.data.nodes[1].components[0].data.material
      scene.data.nodes[1].components[0].data.opacity=.5
      lib.renderProductionScene2d(canvas,lib.readSceneData(scene),{width:2,height:1},assets)
      const white=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      const invalid=structuredClone(scene);invalid.data.nodes[1].components[0].data.opacity=2
      const invalidSupport=lib.inspectProductionSceneSupport(lib.readSceneData(invalid))
      let error='';try{lib.renderProductionScene2d(canvas,lib.readSceneData(invalid),{width:2,height:1},assets)}catch(e){error=(e as Error).message}
      const afterFailure=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      const moving=lib.readSceneData(structuredClone(scene))
      const movingNode=moving.nodes[1]
      delete movingNode.components[0].assetRef
      movingNode.components[0].data={size:[1,1],color:'#ff0000'}
      movingNode.transform.position=[.5,.5,0]
      lib.renderProductionScene2d(canvas,moving,{width:2,height:1})
      const beforeLateFailure=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      movingNode.components.push({type:'text',data:{size:[1,1],fontSize:1,fontFamily:'sans-serif'}})
      let lateError='';try{lib.renderProductionScene2d(canvas,moving,{width:2,height:1})}catch(e){lateError=(e as Error).message}
      const afterLateFailure=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      movingNode.components.pop()
      movingNode.transform.position=[1.5,.5,0]
      lib.renderProductionScene2d(canvas,moving,{width:2,height:1})
      const moved=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      movingNode.enabled=false
      lib.renderProductionScene2d(canvas,moving,{width:2,height:1})
      const hidden=[...canvas.getContext('2d')!.getImageData(0,0,2,1).data]
      document.createElement=createElement
      surface.dispose()
      return {uiResult,uiPreserved:beforeUi===JSON.stringify(ui),sceneSupport,tinted,white,invalidSupport,error,afterFailure,scenePreserved,
        beforeLateFailure,afterLateFailure,lateError,moved,hidden,sceneCanvasCreations,tintedAgain}
    })
    expect(result.uiResult).toMatchObject({supported:true,radius:'12px',opacity:'0.8',text:'Start'})
    expect(result.uiResult.background).toContain('0.25')
    expect(result.uiPreserved).toBe(true)
    expect(result.sceneSupport.supported).toBe(true)
    expect(result.scenePreserved).toBe(true)
    for(const [actual,expected] of result.tinted.map((v:number,i:number)=>[v,[100,100,0,64,120,220,0,128][i]]))expect(Math.abs(actual-expected)).toBeLessThanOrEqual(3)
    for(const [actual,expected] of result.white.map((v:number,i:number)=>[v,[200,100,50,64,240,220,200,128][i]]))expect(Math.abs(actual-expected)).toBeLessThanOrEqual(3)
    expect(result.invalidSupport.supported).toBe(false)
    expect(result.error).toContain('opacity')
    expect(result.afterFailure).toEqual(result.white)
    expect(result.lateError).toContain('Scene text missing')
    expect(result.beforeLateFailure).toEqual([255,0,0,255,0,0,0,0])
    expect(result.afterLateFailure).toEqual(result.beforeLateFailure)
    expect(result.moved).toEqual([0,0,0,0,255,0,0,255])
    expect(result.hidden).toEqual([0,0,0,0,0,0,0,0])
    expect(result.tintedAgain).toEqual(result.tinted)
    expect(result.sceneCanvasCreations).toBe(2)
  }finally{await browser?.close();server.stop(true)}
},30000)


test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('skin button keeps its atlas pixels, live label and click action through rerender',async()=>{
  const {chromium}=await import(sharedPlaywright().moduleUrl)
  const executablePath=process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()
  if(!existsSync(executablePath))throw Error('An installed Chromium is required; no browser download')
  const source=await bundleContentConsumer()
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/consumer.mjs'
    ?new Response(source,{headers:{'content-type':'text/javascript'}}):new Response('<!doctype html><body>')})
  let browser
  try {
    browser=await chromium.launch({executablePath,headless:true})
    const page=await browser.newPage()
    await page.route('**/*',(route:any)=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort())
    await page.goto(server.url.href)
    const result=await page.evaluate(async (example:any)=>{
      const modulePath='/consumer.mjs',lib=await import(modulePath)
      const documentData={schema:'beegame-content.v1',id:'skin-example',kind:'ui-screen',assetRefs:['ui-skins'],
        data:{rootId:'root',nodes:[{id:'root',role:'screen-root'},example]}}
      const before=JSON.stringify(documentData)
      const image=document.createElement('canvas');image.width=3;image.height=1
      image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray([255,0,0,255,0,200,255,255,0,200,255,255]),3,1),0,0)
      // A prepared atlas retains same-colour padding around the selected frame.
      const assets=new Map([['ui-skins',{source:image,url:'memory',sheet:{frames:{primary:{x:2,y:0,width:1,height:1}}}}]])
      const host=document.createElement('div');document.body.append(host)
      const surface=await lib.createProductionUiSurface(host),clicks:string[]=[]
      const data=lib.readUiData(documentData)
      const draw=(label:string)=>surface.render(data,{width:320,height:180},{assets,state:{'play.label':label},
        onAction:(action:string,nodeId:string)=>clicks.push(action+':'+nodeId)})
      draw('Begin')
      const button=host.querySelector<HTMLButtonElement>('[data-node-id="play"]')!
      const first=button.textContent,shadow=getComputedStyle(button).textShadow
      const pixel=Array.from(button.querySelector('canvas')!.getContext('2d')!.getImageData(0,0,1,1).data)
      button.click()
      draw('Again')
      const updated=host.querySelector<HTMLButtonElement>('[data-node-id="play"]')!
      updated.click()
      const second=updated.textContent
      const nextPixel=Array.from(updated.querySelector('canvas')!.getContext('2d')!.getImageData(0,0,1,1).data)
      surface.dispose()
      return {first,second,shadow,pixel,nextPixel,clicks,preserved:before===JSON.stringify(documentData)}
    },{id:'play',parentId:'root',role:'button',assetRef:'ui-skins',data:{frame:'primary'},text:'Start',
      layout:{size:[240,64]},style:{fontSize:24,textShadow:'0 0 8px #38e8ff'},
      bindings:{text:'play.label'},actions:{click:'game.start'}})
    expect(result).toMatchObject({first:'Begin',second:'Again',pixel:[0,200,255,255],nextPixel:[0,200,255,255],
      clicks:['game.start:play','game.start:play'],preserved:true})
    expect(result.shadow).not.toBe('none')
  } finally {await browser?.close();server.stop(true)}
},30000)
