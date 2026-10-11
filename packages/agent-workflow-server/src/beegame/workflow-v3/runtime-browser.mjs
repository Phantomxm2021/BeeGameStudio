// Host-only static-build observation. Not an Agent-provided PASS report.
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { observeAudio } from './runtime-audio.mjs'

let input = ''
for await (const part of process.stdin) input += part
const { endpoint, artifact, files, uiProbes } = JSON.parse(input)
const url = new URL(endpoint)
if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('Expected the host-owned local test browser')
const { chromium } = await import(process.env.BGS_PLAYWRIGHT_MODULE)
const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
const sharp = uiProbes?.some(probe => probe.mode === 'pixels') ? (await import(process.env.BGS_SHARP_MODULE)).default : undefined
function regionMask(info, regions) {
  const mask=new Uint8Array(info.width*info.height)
  for(const r of regions){
    // A two-pixel edge tolerance handles browser rasterization, not missing
    // cells. Verify the interiors and forbid marker pixels outside all cells.
    for(const [margin,bit] of [[-2,1],[2,2]]){
      const left=Math.max(0,Math.ceil(r.left+margin-.5)),right=Math.min(info.width,Math.ceil(r.right-margin-.5)),
        top=Math.max(0,Math.ceil(r.top+margin-.5)),bottom=Math.min(info.height,Math.ceil(r.bottom-margin-.5))
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)mask[y*info.width+x]|=bit
    }
  }
  return mask
}
function colorBounds(data, info, color, mask, regions) {
  let left=info.width, top=info.height, right=-1, bottom=-1, count=0
  let interior=0, matchedInterior=0, outside=0
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const offset=(y*info.width+x)*info.channels
    const bits=mask?.[y*info.width+x]
    if(bits&2)interior++
    if(color.every((value,i)=>Math.abs(data[offset+i]-value)<=1)){
      count++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)
      if(mask){if(bits&2)matchedInterior++;if(!(bits&1))outside++}
    }
  }
  const missingCellInteriors=[]
  if(regions)for(const [index,r] of regions.entries()){
    let required=0,matched=0
    const l=Math.max(0,Math.ceil(r.left+2-.5)),t=Math.max(0,Math.ceil(r.top+2-.5)),
      right=Math.min(info.width,Math.ceil(r.right-2-.5)),bottom=Math.min(info.height,Math.ceil(r.bottom-2-.5))
    for(let y=t;y<bottom;y++)for(let x=l;x<right;x++){
      required++;const offset=(y*info.width+x)*info.channels
      if(color.every((value,i)=>Math.abs(data[offset+i]-value)<=1))matched++
    }
    if(!required || matched/required<0.9)missingCellInteriors.push(index)
  }
  const regionProof=mask ? {regionsMatch:interior>0 && missingCellInteriors.length===0 && outside===0,
    checkedCells:regions.length,missingCellInteriors,interior,matchedInterior,outside} : {}
  return count ? {bounds:{left,top,right:right+1,bottom:bottom+1},count,...regionProof} : {count:0,...regionProof}
}
try {
  const base = await realpath(artifact)
  const allowed = new Map(files.map(file => [file.path, file]))
  async function observe(probe, variant, marker, suppressFont = false, silence = false) {
  const errors = [], missing = new Set(), unsupported = new Set(), requested = new Set()
  const context = await browser.newContext({ viewport: { width: probe?.viewport[0] ?? 1280, height: probe?.viewport[1] ?? 720 }, serviceWorkers: 'block', acceptDownloads: false })
  try {
    await context.routeWebSocket('**/*', socket => { unsupported.add('non-static WebSocket'); socket.close() })
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (url.origin !== 'http://bgs-runtime.invalid' || !['GET', 'HEAD'].includes(route.request().method())) {
          unsupported.add('external request or non-static method'); await route.abort(); return
        }
        const path = decodeURIComponent(url.pathname).slice(1) || 'index.html'
        const expected = allowed.get(path)
        if (!expected) { missing.add(path); await route.fulfill({ status: 404, body: 'Not found' }); return }
        const real = await realpath(resolve(base, path)), rel = relative(base, real)
        if (!rel || rel === '..' || rel.startsWith('../')) throw new Error('Request escaped build directory')
        const body = await readFile(real)
        if (createHash('sha256').update(body).digest('hex') !== expected.sha256) throw new Error('Measured file changed before serving')
        const replacement = variant && path === (variant.path ?? probe?.document) ? variant.replacement : undefined
        if (path === probe?.document && createHash('sha256').update(body).digest('hex') !== probe.originalSha256)
          throw new Error('Probe source differs from measured bytes')
        if (probe?.mode === 'font' && path === probe.resource.path) {
          if (expected.sha256 !== probe.resource.sha256) throw new Error('Probe font differs from measured bytes')
          if (suppressFont) {
            requested.add(path)
            await route.fulfill({ status: 404, body: 'Font suppressed by the host observation' }); return
          }
        }
        const imageReplacement = marker && path === probe.resource.path
        if(imageReplacement && expected.sha256 !== probe.resource.sha256)throw new Error('Probe image differs from measured bytes')
        const audioReplacement = silence && path === probe.resource.path
        if (audioReplacement && expected.sha256 !== probe.resource.sha256) throw new Error('Probe audio differs from measured bytes')
        await route.fulfill({ status: 200, contentType: imageReplacement ? 'image/png' : audioReplacement ? 'audio/wav' : expected.mime,
          body: imageReplacement ? Buffer.from(marker.body,'base64') : audioReplacement ? Buffer.from(probe.silence,'base64') : replacement ?? body })
        requested.add(path)
      } catch {
        if (errors.length < 20) errors.push('Build changed or request could not be served')
        await route.abort().catch(() => undefined)
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => { if (errors.length < 20) errors.push(error.message.slice(0, 300)) })
    page.on('console', message => {
      // Only the exact, intentionally suppressed font request's 404 is expected.
      // Original-load errors and all other URLs remain actual driver observations.
      if (suppressFont && message.location().url === 'http://bgs-runtime.invalid/'+probe.resource.path &&
          message.text().startsWith('Failed to load resource:')) return
      if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 300))
    })
    await page.goto('http://bgs-runtime.invalid/index.html', { waitUntil: 'networkidle', timeout: 15000 })
    if (probe?.mode === 'audio') {
      let observed
      try {
        for (const step of probe.steps ?? []) await page.locator(step.click).click({ timeout: 5000 })
        observed = await observeAudio(page, probe, requested)
      } catch { observed = { reason: 'Declared audio activation path unavailable' } }
      return { ...observed, errors, missingFiles: [...missing], unsupported: [...unsupported], requestedFiles: [...requested] }
    }
    let bounds, reason, pixels, font
    if (probe) {
      try { for (const step of probe.steps ?? []) await page.locator(step.click).click({ timeout: 5000 }) }
      catch { reason = 'Declared UI activation path could not be observed; no arbitrary test JS was executed' }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const locator = page.locator(probe.selector)
      if (await locator.count() !== 1) reason = 'Selector must identify exactly one actual target UI element'
      else bounds = await locator.evaluate(element => {
        const r = element.getBoundingClientRect(), css = getComputedStyle(element)
        if (r.width <= 0 || r.height <= 0 || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return null
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })
      if (!requested.has(probe.document)) reason = 'Target build did not request the registered UI source; compiled or ignored data is unverified'
      if (!bounds && !reason) reason = 'Target element is hidden or has no measurable geometry'
      if (probe.mode === 'font' && bounds && !reason) {
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        const details = await locator.evaluate(element => ({ text: element.textContent,
          fontSize: parseFloat(getComputedStyle(element).fontSize), children: element.childElementCount,
          before: getComputedStyle(element, '::before').content, after: getComputedStyle(element, '::after').content }))
        if (details.children || !['none','normal'].includes(details.before) || !['none','normal'].includes(details.after))
          reason = 'Font probe requires plain DOM text without child elements or pseudo-element text'
        else {
          const cdp = await context.newCDPSession(page)
          try {
            await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
            const {root} = await cdp.send('DOM.getDocument')
            const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: probe.selector})
            if (!nodeId) throw Error('Target node unavailable')
            const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId})
            font = { text: details.text, fontSize: details.fontSize,
              fonts: fonts.filter(value => value.glyphCount > 0).sort((a,b) => a.postScriptName.localeCompare(b.postScriptName)),
              sha256: createHash('sha256').update(await locator.screenshot({animations:'disabled',timeout:5000})).digest('hex') }
          } catch { reason = 'Actual glyph fonts could not be observed; native CSS selectors and supported Chromium CDP required' }
          finally { await cdp.detach() }
        }
        if (!requested.has(probe.resource.path)) reason = 'Target did not request the selected registered font member'
      }
      if(probe.mode === 'pixels' && bounds && !reason){
        const canvas = await locator.evaluate(element=>({canvas:element.tagName==='CANVAS',width:element.width,height:element.height}))
        if(!canvas.canvas || canvas.width!==probe.viewport[0] || canvas.height!==probe.viewport[1] ||
            Math.abs(bounds.right-bounds.left-canvas.width)>1 || Math.abs(bounds.bottom-bounds.top-canvas.height)>1)
          reason='Pixel probe needs an unscaled actual Canvas matching the declared viewport'
        else{
          const screenshot=await locator.screenshot({animations:'disabled',timeout:5000})
          const {data,info}=await sharp(screenshot).removeAlpha().raw().toBuffer({resolveWithObject:true})
          const regions=variant?.regions ?? probe.regions, mask=regions ? regionMask(info,regions) : undefined
          pixels={sha256:createHash('sha256').update(screenshot).digest('hex'),
            colors:probe.markers.map(value=>colorBounds(data,info,value.color,mask,regions))}
          if(!requested.has(probe.resource.path))reason='Actual target did not request the selected image member'
        }
      }
    }
    const surfacePresent = await page.locator('body').evaluate(body => {
      // Absolute-positioned UI/Canvas does not contribute to body height.
      // Observe a concrete visible surface, not the flow container's bounds.
      return [body, ...body.querySelectorAll('*')].some(element => {
        const visual = element.matches('canvas,svg,img,video,button,input,textarea,select') ||
          [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))
        if (!visual) return false
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
            rect.left >= innerWidth || rect.top >= innerHeight) return false
        for (let parent = element; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent)
          if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false
        }
        return true
      })
    })
    return { driver: 'host-owned Chromium; actual static build', viewport: probe?.viewport ?? [1280, 720], surfacePresent, bounds, pixels, font, reason,
      requestedFiles: [...requested], missingFiles: [...missing], errors, unsupported: [...unsupported],
      limitations: 'Initial load/error smoke only. Container/text presence is NOT pixel/rendering proof. Fetching JSON is NOT proof its layout, hierarchy, resources or gameplay rules are consumed.' }
  } finally { await context.close() }
  }
  if (!uiProbes) console.log(JSON.stringify(await observe()))
  else {
    const results = [], errors = [], missing = new Set(), unsupported = new Set()
    for (const probe of uiProbes) {
      if (probe.mode === 'audio') {
        const before = await observe(probe), changed = []
        for (const variant of probe.variants) changed.push({ property: variant.property, expected: variant.expected, actual: await observe(probe, variant) })
        const silent = await observe(probe, undefined, undefined, false, true), restored = await observe(probe)
        const originals = [before, ...changed.map(value => value.actual), restored], observations = [...originals, silent]
        const match = (value, expected) => value.audio && [value.audio.playing, value.audio.after].every(state =>
          Math.abs(state.volume - expected.volume) < .0001 && state.loop === expected.loop)
        let reason = observations.find(value => value.reason)?.reason
        if (!reason && originals.some(value => value.audio.signal.peak <= .00001))
          reason = 'Original registered clip has no isolated non-silent decoded signal; resource causality remains unverified'
        const failed = observations.some(value => value.failed || value.errors.length || value.missingFiles.length) ||
          !reason && (!match(before, probe.before) || !changed.every(value => match(value.actual, value.expected)) || !match(restored, probe.before) || silent.audio.signal.peak > .00001)
        const status = failed ? 'failed' : reason ? 'unverified' : 'passed'
        results.push({ document: probe.document, nodeId: probe.nodeId, componentId: probe.componentId, resource: probe.resource, status, reason,
          expectedBefore: probe.before, before: before.audio, changed: changed.map(value => ({property: value.property, expected: value.expected, actual: value.actual.audio})),
          silent: silent.audio, restored: restored.audio })
        for (const value of observations) { errors.push(...value.errors); value.missingFiles.forEach(file => missing.add(file)); value.unsupported.forEach(file => unsupported.add(file)) }
        continue
      }
      if (probe.mode === 'font') {
        const before = await observe(probe), changed = []
        for (const variant of probe.variants) changed.push({property:variant.property,expected:variant.expected,actual:await observe(probe,variant)})
        const suppressed = await observe(probe,undefined,undefined,true), restored = await observe(probe)
        const originals = [before,...changed.map(value => value.actual),restored]
        const signature = value => JSON.stringify(value.font?.fonts)
        const match = (value, expected) => value.font?.text === expected.text && Math.abs(value.font.fontSize-expected.fontSize) <= .1
        let reason = [...originals,suppressed].find(value => value.reason)?.reason
        if (!reason && originals.some(value => value.font?.fonts.length !== 1 || value.font.fonts.some(f => !f.isCustomFont)))
          reason = 'Actual text does not use a single isolated custom font (mixed/system/glyph fallback or no observable glyphs); consumption remains unverified'
        if (!reason && (suppressed.errors.length || suppressed.missingFiles.length))
          reason = 'Intentional font suppression prevented a clean fallback observation; no font causality verdict'
        if (!reason && (signature(before) !== signature(restored) || before.font.sha256 !== restored.font.sha256))
          reason = 'Original text/font rendering is not stable after restoration'
        if (!reason && (signature(before) === signature(suppressed) || before.font.sha256 === suppressed.font.sha256))
          reason = 'Suppressing the selected font did not isolate its actual glyph usage and visible rendering'
        const status = originals.some(value => value.errors.length || value.missingFiles.length) ? 'failed' : reason ? 'unverified'
          : match(before,probe.before) && changed.every(value => match(value.actual,value.expected)) && match(restored,probe.before) ? 'passed' : 'failed'
        results.push({document:probe.document,nodeId:probe.nodeId,viewport:probe.viewport,resource:probe.resource,status,reason,
          expectedBefore:probe.before,before:before.font,changed:changed.map(value => ({property:value.property,expected:value.expected,actual:value.actual.font})),
          suppressed:{font:suppressed.font,errors:suppressed.errors,missingFiles:suppressed.missingFiles},restored:restored.font})
        for (const value of originals) { errors.push(...value.errors);value.missingFiles.forEach(file => missing.add(file)) }
        for (const value of [...originals,suppressed]) value.unsupported.forEach(file => unsupported.add(file))
        continue
      }
      if(probe.mode === 'pixels'){
        const baseline=await observe(probe), before=await observe(probe,undefined,probe.markers[0]),
          other=await observe(probe,undefined,probe.markers[1]), changed=[]
        for(const variant of probe.variants)changed.push({property:variant.property,expected:variant.expected,actual:await observe(probe,variant,probe.markers[0])})
        const restored=await observe(probe), observations=[baseline,before,other,...changed.map(value=>value.actual),restored]
        const markerBounds=(value,index=0)=>value.pixels?.colors[index]?.bounds
        const match=(actual,expected)=>actual && Object.keys(expected).every(key=>Math.abs(actual[key]-expected[key])<=2)
        let reason=observations.find(value=>value.reason)?.reason
        if(!reason && baseline.pixels.colors.some(value=>value.count))reason='Marker color already exists in the original Canvas; image causality is ambiguous'
        if(!reason && baseline.pixels.sha256!==restored.pixels.sha256)reason='Original Canvas is not stable after restoration'
        if(!reason && ([before,...changed.map(value=>value.actual)].some(value=>!markerBounds(value)) || !markerBounds(other,1)))
          reason='Selected resource replacement has no independently observable pixels'
        if(!reason && !probe.regions && [before,other,...changed.map(value=>value.actual)].some((value,i)=>{
          const color=value.pixels.colors[i===1?1:0],box=color.bounds
          return box && color.count/((box.right-box.left)*(box.bottom-box.top))<0.9
        }))reason='Marker is tinted, rotated or occluded; this pixel driver cannot isolate its geometry'
        const status=observations.some(value=>value.errors.length || value.missingFiles.length)?'failed':reason?'unverified':
          baseline.pixels.sha256===before.pixels.sha256?'failed':
          match(markerBounds(before),probe.before) && match(markerBounds(other,1),probe.before) &&
          changed.every(value=>match(markerBounds(value.actual),value.expected)) &&
          (!probe.regions || (before.pixels.colors[0].regionsMatch && other.pixels.colors[1].regionsMatch &&
            changed.every(value=>value.actual.pixels.colors[0].regionsMatch)))?'passed':'failed'
        results.push({document:probe.document,nodeId:probe.nodeId,componentId:probe.componentId,tileId:probe.tileId,resource:probe.resource,viewport:probe.viewport,status,reason,
          baseline:baseline.pixels,before:before.pixels,resourceChanged:other.pixels,
          changed:changed.map(value=>({property:value.property,expected:value.expected,actual:value.actual.pixels})),restored:restored.pixels,expectedBefore:probe.before})
        for(const value of observations){errors.push(...value.errors);value.missingFiles.forEach(file=>missing.add(file));value.unsupported.forEach(file=>unsupported.add(file))}
        continue
      }
      const before = await observe(probe), changed = []
      for (const variant of probe.variants) changed.push({ property: variant.property, expected: variant.expected, actual: await observe(probe, variant) })
      const restored = await observe(probe)
      const match = (actual, expected) => actual && Object.keys(expected).every(key => Math.abs(actual[key]-expected[key]) <= 1)
      const reason = before.reason || changed.find(value=>value.actual.reason)?.actual.reason || restored.reason
      const observations = [before, ...changed.map(value=>value.actual), restored]
      const status = reason ? 'unverified' : observations.some(value => value.errors.length || value.missingFiles.length) ? 'failed'
        : match(before.bounds, probe.before) && changed.every(value=>match(value.actual.bounds,value.expected)) && match(restored.bounds, probe.before) ? 'passed' : 'failed'
      results.push({ document: probe.document, nodeId: probe.nodeId, viewport: probe.viewport, status, reason,
        before: before.bounds, changed: changed.map(value=>({ property:value.property,actual:value.actual.bounds,expected:value.expected })), restored: restored.bounds, expectedBefore: probe.before })
      for (const value of observations) {
        errors.push(...value.errors); value.missingFiles.forEach(file => missing.add(file)); value.unsupported.forEach(file => unsupported.add(file))
      }
    }
    console.log(JSON.stringify({ driver: 'host-owned Chromium; actual target build; in-memory source response mutation',
      probes: results, errors, missingFiles: [...missing], unsupported: [...unsupported],
      limitations: 'Declared DOM geometry/text-font, static Canvas image/Tilemap or HTML audio probes only; response-only changes/restoration. Decoded audio capture ignores volume/mute: native properties checked separately, no final output/listening/loop-boundary proof. Not collisions, sorting, animation, 3D/Canvas fonts/Web Audio/full gameplay acceptance.' }))
  }
} finally { await browser.close() }
