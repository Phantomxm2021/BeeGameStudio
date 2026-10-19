import {expect, test} from 'bun:test'
import {existsSync} from 'node:fs'
import {sharedPlaywright} from './shared-playwright'
import {bundleContentConsumer} from './game-content-consumer-cli'

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
