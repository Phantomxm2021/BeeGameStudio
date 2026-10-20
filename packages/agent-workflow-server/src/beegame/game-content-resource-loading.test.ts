import { expect, test } from 'bun:test'
import { loadProductionResources } from './game-content-consumer'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const ui = (nodes: any[]) => ({ schema: 'beegame-content.v1', id: 'test', kind: 'ui-screen', assetRefs: ['a','b','font'],
  data: { rootId: 'root', nodes: [{ id: 'root', role: 'screen-root' }, ...nodes.map((node,i) => ({id: 'n'+i,parentId:'root',...node}))] } } as any)

async function fixture(run: (f: any) => Promise<void>) {
  const original = { createImageBitmap: globalThis.createImageBitmap, FontFace: globalThis.FontFace, document: globalThis.document }
  const closed: string[] = [], calls: string[] = [], decoded: string[] = [], installed = new Set()
  const gate = deferred(), otherGate = deferred(), started = deferred()
  let images = 0, fontLoads = 0, atlasFault = ''
  const resources = [
    {id:'a',root_path:'assets/a.png',file_paths:['assets/a.png','assets/a.json']},
    {id:'b',root_path:'assets/b.png',file_paths:['assets/b.png']},
    {id:'font',root_path:'assets/text.woff2',file_paths:['assets/text.woff2']},
  ]
  globalThis.createImageBitmap = (async (source: Blob, ...crop: number[]) => {
    const key = crop.length ? 'crop' : await source.text()
    decoded.push(key)
    return {width:2,height:1,close:() => closed.push(key)}
  }) as any
  globalThis.FontFace = class {
    status = 'unloaded'
    async load() { fontLoads++; this.status = 'loaded'; return this }
  } as any
  globalThis.document = {fonts:{add:(face:unknown) => installed.add(face),delete:(face:unknown) => installed.delete(face)}} as any
  const fetcher = async (url: any) => {
    const path = new URL(String(url)).pathname
    calls.push(path)
    if (path.endsWith('manifest.json')) return Response.json({version:9,modules:{resources:resources.map(r=>'assets/'+r.id+'.resource.json')}})
    const resource = resources.find(r=>path.endsWith('/'+r.id+'.resource.json'))
    if (resource) return Response.json(resource)
    if (path.endsWith('.png')) {
      if (++images === 2) started.resolve()
      await (path.endsWith('/a.png') ? gate.promise : otherGate.promise)
      return new Response(path)
    }
    if (path.endsWith('a.json')) return atlasFault === 'http' ? new Response('',{status:503}) :
      Response.json(atlasFault === 'format' ? {invalid:true} : {frames:{idle:{frame:{x:0,y:0,w:atlasFault === 'bounds' ? 3 : 1,h:1}}}})
    if (path.endsWith('.woff2')) return new Response('synthetic-font')
    throw Error('Unexpected request: '+path)
  }
  try { await run({gate,otherGate,started,fetcher,calls,closed,decoded,installed,
    fontLoads:()=>fontLoads,setAtlasFault:(fault:string)=>{atlasFault=fault}}) }
  finally { gate.resolve(); otherGate.resolve(); Object.assign(globalThis,original) }
}

const docs = () => [ui([
  {role:'image',assetRef:'a',data:{frame:'idle'}},
  {role:'image',assetRef:'a',data:{frame:'idle'}},
  {role:'image',assetRef:'b'},
  {role:'text',text:'A',data:{font:{assetRef:'font'}}},
  {role:'text',text:'B',data:{font:{assetRef:'font'}}},
])]

test('independent resources start together while repeated image, atlas, frame and font work is shared',async()=>{
  await fixture(async f=>{
    const pending=loadProductionResources('http://fixture/assets/manifest.json',docs(),f.fetcher)
    try {
      // If image loading becomes serial again, the second image cannot reach this gate.
      await Promise.race([f.started.promise,Bun.sleep(1000).then(()=>{throw Error('Resources were serialized')})])
    } finally {f.gate.resolve();f.otherGate.resolve()}
    const result=await pending
    for(const path of ['/assets/a.png','/assets/b.png','/assets/a.json','/assets/text.woff2'])
      expect(f.calls.filter((value:string)=>value===path)).toHaveLength(1)
    expect(f.decoded.sort()).toEqual(['/assets/a.png','/assets/b.png','crop'].sort())
    expect(f.fontLoads()).toBe(1)
    expect(result.assets.size).toBe(3)
    expect(result.fonts.size).toBe(1)
    result.dispose()
    expect(f.closed.sort()).toEqual(f.decoded.sort())
    expect(f.installed.size).toBe(0)
  })
})

test.each(['format','http','bounds'])('atlas %s failure releases every bitmap and font, including late image work',async fault=>{
  await fixture(async f=>{
    f.setAtlasFault(fault)
    const pending=loadProductionResources('http://fixture/assets/manifest.json',docs(),f.fetcher)
    let settled=false
    const rejected=pending.then(()=>undefined,error=>error).finally(()=>{settled=true})
    await f.started.promise
    f.otherGate.resolve()
    await Bun.sleep(10)
    const premature=settled
    f.gate.resolve()
    expect(String(await rejected)).toContain(fault==='http' ? 'Resource metadata HTTP 503' : fault==='format' ? 'Unsupported atlas metadata' : 'outside')
    expect(premature).toBe(false)
    expect(f.closed.sort()).toEqual(['/assets/a.png','/assets/b.png'])
    expect(f.installed.size).toBe(0)
  })
})

test('invalid documents fail before resource jobs begin',async()=>{
  await fixture(async f=>{
    await expect(loadProductionResources('http://fixture/assets/manifest.json',[...docs(),{invalid:true} as any],f.fetcher)).rejects.toThrow()
    expect(f.calls.filter((path:string)=>/\.(png|woff2)$/.test(path))).toEqual([])
    expect(f.decoded).toEqual([])
  })
})
