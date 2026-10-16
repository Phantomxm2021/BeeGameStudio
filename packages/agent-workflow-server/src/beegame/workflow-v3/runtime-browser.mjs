// Host-only static-build observation. Not an Agent-provided PASS report.
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { observeAudio } from './runtime-audio.mjs'

let input = ''
for await (const part of process.stdin) input += part
const { endpoint, artifact, files, uiProbes, requiredViewport, previewHost, entryUrl = 'http://bgs-runtime.invalid/index.html' } = JSON.parse(input)
const entry = new URL(entryUrl), servingBase = new URL('.', entry)
if (!['http:', 'https:'].includes(entry.protocol) || entry.username || entry.password || entry.search || entry.hash)
  throw new Error('Expected a static publication entry URL')
const url = new URL(endpoint)
if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('Expected the host-owned local test browser')
const { chromium } = await import(process.env.BGS_PLAYWRIGHT_MODULE)
const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
const sharp = uiProbes?.some(probe => probe.mode === 'pixels') ? (await import(process.env.BGS_SHARP_MODULE)).default : undefined
// Serialized by Playwright into the game frame. A rotated/skewed rectangle's
// AABB is not its interactive edge length; keep such controls unverified rather
// than adding another transform solver beside the shared layout implementation.
function measureDomNodes(nodes) {
  return nodes.map(node => {
    let matches
    try { matches = node.selector ? [...document.querySelectorAll(node.selector)] :
      [...document.querySelectorAll('[data-node-id]')].filter(element => element.getAttribute('data-node-id') === node.id) }
    catch { return { id: node.id, unverified: 'Invalid mapped node selector' } }
    if (matches.length !== 1) return { id: node.id, unverified: matches.length ? 'Ambiguous node selector/data-node-id' : 'Missing node selector/data-node-id' }
    const element = matches[0], rect = element.getBoundingClientRect(), css = getComputedStyle(element)
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
        return { id: node.id, unverified: 'Saved-active node is hidden in this runtime state' }
      if (node.minimumControlSize) {
        const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
        if (!matrix.is2D || Math.abs(matrix.b) > .000001 || Math.abs(matrix.c) > .000001 || matrix.a <= 0 || matrix.d <= 0 ||
            style.perspective !== 'none' || style.rotate && !['none', '0deg'].includes(style.rotate) ||
            style.scale && style.scale !== 'none' && style.scale.split(' ').some(value => !Number.isFinite(Number(value)) || Number(value) <= 0))
          return { id: node.id, unverified: 'Control edge size under rotation, skew, reflection or perspective is unverified; bounding boxes are insufficient' }
      }
    }
    return { id: node.id, bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, fontSize: parseFloat(css.fontSize) }
  })
}
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
  async function observe(probe, variant, marker, suppressFont = false, silence = false, smokeViewport) {
  const errors = [], missing = new Set(), unsupported = new Set(), requested = new Set()
  const context = await browser.newContext({ viewport: { width: probe?.viewport[0] ?? smokeViewport?.[0] ?? 1280, height: probe?.viewport[1] ?? smokeViewport?.[1] ?? 720 }, hasTouch: Boolean(smokeViewport || probe?.hasTouch), deviceScaleFactor: probe?.deviceScaleFactor ?? 1, serviceWorkers: 'block', acceptDownloads: false })
  try {
    const hostUrl = 'http://bgs-preview.invalid/'
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*' }
    await context.routeWebSocket('**/*', socket => { unsupported.add('non-static WebSocket'); socket.close() })
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (previewHost && url.href === hostUrl && route.request().method() === 'GET' &&
            route.request().isNavigationRequest() && !route.request().frame().parentFrame()) {
          await route.fulfill(previewHost); return
        }
        if (url.origin !== entry.origin || !['GET', 'HEAD', ...(previewHost ? ['OPTIONS'] : [])].includes(route.request().method())) {
          unsupported.add('external request or non-static method'); await route.abort(); return
        }
        if (!url.pathname.startsWith(servingBase.pathname)) {
          missing.add(url.pathname+' (outside publication base '+servingBase.pathname+')')
          await route.fulfill({ status: 404, body: 'Outside publication base' }); return
        }
        const path = decodeURIComponent(url.pathname.slice(servingBase.pathname.length)) || 'index.html'
        const expected = allowed.get(path)
        if (!expected) { missing.add(path); await route.fulfill({ status: 404, body: 'Not found' }); return }
        if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
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
            await route.fulfill({ status: 404, headers: previewHost ? cors : undefined, body: 'Font suppressed by the host observation' }); return
          }
        }
        const imageReplacement = marker && path === probe.resource.path
        if(imageReplacement && expected.sha256 !== probe.resource.sha256)throw new Error('Probe image differs from measured bytes')
        const audioReplacement = silence && path === probe.resource.path
        if (audioReplacement && expected.sha256 !== probe.resource.sha256) throw new Error('Probe audio differs from measured bytes')
        await route.fulfill({ status: 200, headers: previewHost ? cors : undefined, contentType: imageReplacement ? 'image/png' : audioReplacement ? 'audio/wav' : expected.mime,
          body: imageReplacement ? Buffer.from(marker.body,'base64') : audioReplacement ? Buffer.from(probe.silence,'base64') : replacement ?? body })
        requested.add(path)
      } catch {
        if (errors.length < 20) errors.push('Build changed or request could not be served')
        await route.abort().catch(() => undefined)
      }
    })
    const outer = await context.newPage()
    outer.on('pageerror', error => { if (errors.length < 20) errors.push(error.message.slice(0, 300)) })
    outer.on('console', message => {
      // Only the exact, intentionally suppressed font request's 404 is expected.
      // Original-load errors and all other URLs remain actual driver observations.
      if (suppressFont && message.location().url === new URL(probe.resource.path,servingBase).href &&
          message.text().startsWith('Failed to load resource:')) return
      if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 300))
    })
    await outer.goto(previewHost ? hostUrl : entry.href, { waitUntil: 'networkidle', timeout: 15000 })
    let page = outer.mainFrame()
    if (previewHost) {
      const element = await outer.locator('#beegame-preview').elementHandle()
      const frame = await element?.contentFrame()
      await element?.dispose()
      if (!frame) throw Error('Preview measurement iframe is unavailable')
      page = frame
    }
    const environment = { embedding: previewHost ? 'sandboxed-iframe' : 'standalone', ...await page.evaluate(() => ({origin:globalThis.origin,viewport:[innerWidth,innerHeight],devicePixelRatio,
      maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer: coarse)').matches,hover:matchMedia('(hover: hover)').matches})) }
    if (probe?.mode === 'audio') {
      let observed
      try {
        for (const step of probe.steps ?? []) await page.locator(step.click).click({ timeout: 5000 })
        observed = await observeAudio(page, probe, requested, servingBase)
      } catch { observed = { reason: 'Declared audio activation path unavailable' } }
      return { ...observed, environment, errors, missingFiles: [...missing], unsupported: [...unsupported], requestedFiles: [...requested] }
    }
    let bounds, reason, pixels, scene, font, textFit, physicalBounds, coordinateSpace, composition
    if (probe) {
      try { for (const step of probe.steps ?? []) await page.locator(step.click).click({ timeout: 5000 }) }
      catch { reason = 'Declared UI activation path could not be observed; no arbitrary test JS was executed' }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const locator = page.locator(probe.selector)
      let count
      try { count = await locator.count() }
      catch (error) {
        // A malformed selected UI input is not a browser crash. Retain other
        // observations in the batch, but never swallow genuine driver failures.
        if (probe.mode || !(error.name==='InvalidSelectorError' || /while parsing (?:css )?selector|Unknown engine/.test(error.message))) throw error
        reason = 'Target selector is invalid; select one actual UI element: '+probe.selector
      }
      // A disabled node may be removed or hidden. Do not interpret a failed
      // activation/load or an ambiguous selector as successful disappearance.
      if (!probe.mode && variant?.property === 'enabled') {
        if (count > 1) reason = 'Disabled target selector is ambiguous'
        const visible = count === 0 ? false : count === 1 ? await locator.evaluate(element => {
          const r = element.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) return false
          for (let parent = element; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent)
            if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false
          }
          return true
        }) : undefined
        if (!requested.has(probe.document)) reason = 'Target build did not request the registered source'
        return { visible, reason, environment, errors, missingFiles:[...missing], unsupported:[...unsupported] }
      }
      if (count !== undefined && count !== 1) reason = 'Selector must identify exactly one actual target UI element'
      else if (count === 1) bounds = await locator.evaluate(element => {
        const r = element.getBoundingClientRect(), css = getComputedStyle(element)
        if (r.width <= 0 || r.height <= 0 || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return null
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })
      if (!probe.mode && bounds && !reason) {
        // Opacity is not inherited in computed style; a positive client rect
        // does not establish visibility through transparent ancestors.
        const hiddenAncestor = await locator.evaluate(element => {
          for(let parent=element.parentElement;parent;parent=parent.parentElement){
            const css=getComputedStyle(parent)
            if(css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse' || Number(css.opacity)===0)return true
          }
          return false
        })
        if(hiddenAncestor) reason='Target UI ancestor is hidden; geometry alone cannot establish visible consumption'
      }
      if (!requested.has(probe.document)) reason = 'Target build did not request the registered source; compiled or ignored data is unverified'
      if (!bounds && !reason) reason = 'Target element is hidden or has no measurable geometry'
      if (probe.mode === 'scene' && bounds && !reason) {
        const canvas = await locator.evaluate(element => ({canvas:element.tagName==='CANVAS',width:element.width,height:element.height}))
        if (!canvas.canvas || canvas.width<=0 || canvas.height<=0)
          reason = 'Scene causality needs one visible actual Canvas; no renderer is supplied by the checker'
        else {
          const screenshot = await locator.screenshot({animations:'disabled',timeout:5000,scale:'css'})
          scene = {sha256:createHash('sha256').update(screenshot).digest('hex'),canvas}
        }
      }
      if (probe.coordinateRoot && !probe.mode && bounds && !reason) {
        const basis = await locator.evaluate((element, config) => {
          let roots
          try {roots=document.querySelectorAll(config.selector)}
          catch {return {reason:'coordinateRoot is not a valid CSS selector'}}
          if (roots.length!==1) return {reason:'coordinateRoot must select exactly one independent DOM root'}
          const root=roots[0]
          if (root===element || !root.contains(element)) return {reason:'coordinateRoot must be a strict ancestor, not the measured node or an unrelated surface'}
          const css=getComputedStyle(root), width=parseFloat(css.width), height=parseFloat(css.height)
          if (Math.abs(width-config.size[0])>.01 || Math.abs(height-config.size[1])>.01 || !Number.isFinite(width+height))
            return {reason:'coordinateRoot untransformed dimensions differ from saved logical dimensions: expected '+config.size.join('x')+', observed '+width+'x'+height}
          if (['borderLeftWidth','borderTopWidth','borderRightWidth','borderBottomWidth','paddingLeft','paddingTop','paddingRight','paddingBottom'].some(key=>parseFloat(css[key])!==0))
            return {reason:'coordinateRoot border/padding changes the logical origin; select the actual unpadded source root'}
          for(let parent=root;parent;parent=parent.parentElement){
            const c=getComputedStyle(parent)
            if(c.display==='none' || c.visibility==='hidden' || c.visibility==='collapse' || Number(c.opacity)===0)
              return {reason:'coordinateRoot or its ancestor is hidden'}
            if(parent.scrollLeft || parent.scrollTop) return {reason:'Scrolled coordinateRoot ancestors are outside this fixed-surface driver'}
            const m=new DOMMatrixReadOnly(c.transform==='none'?undefined:c.transform)
            if(!m.is2D || Math.abs(m.b)>.000001 || Math.abs(m.c)>.000001 || m.a<=0 || m.d<=0 ||
                c.perspective!=='none' || c.rotate && !['none','0deg'].includes(c.rotate) ||
                c.scale && c.scale!=='none' && c.scale.split(' ').some(v=>!Number.isFinite(Number(v)) || Number(v)<=0))
              return {reason:'coordinateRoot supports positive axis-aligned scale/translation only; rotation, reflection or perspective is unverified'}
          }
          const r=root.getBoundingClientRect()
          if(r.width<=0 || r.height<=0 || r.left<-.01 || r.top<-.01 || r.right>innerWidth+.01 || r.bottom>innerHeight+.01)
            return {reason:'coordinateRoot is collapsed or extends outside the declared window'}
          return {root:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},scale:[r.width/config.size[0],r.height/config.size[1]],logicalViewport:config.size}
        }, {selector:probe.coordinateRoot,size:probe.layoutViewport})
        physicalBounds=bounds
        if(basis.reason){reason=basis.reason;bounds=undefined}
        else {
          coordinateSpace=basis
          const [sx,sy]=basis.scale
          bounds={left:(bounds.left-basis.root.left)/sx,top:(bounds.top-basis.root.top)/sy,
            right:(bounds.right-basis.root.left)/sx,bottom:(bounds.bottom-basis.root.top)/sy}
        }
      }
      // Validate the coordinate basis first: a rejected root must not leave
      // window-space bounds labelled as saved logical UI pixels in the report.
      if (!probe.mode && probe.minimumControlSize && bounds && !reason) {
        const [control] = await page.evaluate(measureDomNodes, [{ id: probe.nodeId, selector: probe.selector, minimumControlSize: probe.minimumControlSize }])
        if (control.unverified) reason = control.unverified
      }
      if (probe.checkTextFit && bounds && !reason) textFit = await locator.evaluate(element => {
        const box=element.getBoundingClientRect(), outside=r=>r.left<box.left-1 || r.top<box.top-1 || r.right>box.right+1 || r.bottom>box.bottom+1
        const overflow=[], walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT)
        const visible=element=>{
          for(let parent=element;parent;parent=parent.parentElement){
            const css=getComputedStyle(parent)
            if(css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse' || Number(css.opacity)===0)return false
          }
          return true
        }
        let fragments=0, overflowCount=0, clippedCount=0
        for(let node=walker.nextNode();node;node=walker.nextNode()) {
          if(!node.textContent.trim() || !visible(node.parentElement))continue
          const range=document.createRange();range.selectNodeContents(node)
          for(const r of range.getClientRects()) {
            if(!r.width || !r.height)continue
            fragments++
            // A fragment can fit the target box and still be cut by an outer
            // clip. That is incomplete evidence, not a visible-text PASS.
            let clipped=false
            for(let parent=node.parentElement;parent;parent=parent.parentElement){
              const css=getComputedStyle(parent),p=parent.getBoundingClientRect(), clips=v=>['hidden','clip','scroll','auto'].includes(v)
              if((clips(css.overflowX) && (r.left<p.left-1 || r.right>p.right+1)) ||
                (clips(css.overflowY) && (r.top<p.top-1 || r.bottom>p.bottom+1))){clipped=true;break}
            }
            if(clipped)clippedCount++
            else if(outside(r)){overflowCount++;if(overflow.length<8)overflow.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom})}
          }
        }
        const pseudo=[element,...element.querySelectorAll('*')].some(child=>visible(child) &&
          ['::before','::after'].some(part=>!['none','normal','""',"''"].includes(getComputedStyle(child,part).content)))
        return {status:overflowCount?'failed':clippedCount || pseudo?'unverified':fragments?'passed':'not-applicable',
          fragments,overflowCount,clippedCount,pseudo,overflow}
      })
      if (probe.mode === 'font' && bounds && !reason) {
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        const details = await locator.evaluate(element => ({ text: element.textContent,
          fontSize: parseFloat(getComputedStyle(element).fontSize), children: element.childElementCount,
          before: getComputedStyle(element, '::before').content, after: getComputedStyle(element, '::after').content }))
        if (details.children || !['none','normal'].includes(details.before) || !['none','normal'].includes(details.after))
          reason = 'Font probe requires plain DOM text without child elements or pseudo-element text'
        else {
          let cdp
          try {
            let sharedSession = false
            try { cdp = await context.newCDPSession(previewHost ? page : outer) }
            catch (error) {
              if (!previewHost || !error.message.includes('does not have a separate CDP session')) throw error
              cdp = await context.newCDPSession(outer)
              sharedSession = true
            }
            await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
            const {root} = await cdp.send('DOM.getDocument', sharedSession ? { depth: -1, pierce: true } : {})
            let documentId = root.nodeId
            if (sharedSession) {
              const frame = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#beegame-preview' })
              const {node} = await cdp.send('DOM.describeNode', { nodeId: frame.nodeId })
              if (!node.contentDocument?.nodeId) throw Error('Game frame document unavailable')
              documentId = node.contentDocument.nodeId
            }
            const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: documentId, selector: probe.selector})
            if (!nodeId) throw Error('Target node unavailable')
            const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId})
            font = { text: details.text, fontSize: details.fontSize,
              fonts: fonts.filter(value => value.glyphCount > 0).sort((a,b) => a.postScriptName.localeCompare(b.postScriptName)),
              sha256: createHash('sha256').update(await locator.screenshot({animations:'disabled',timeout:5000})).digest('hex') }
          } catch { reason = 'Actual glyph fonts could not be observed; native CSS selectors and supported Chromium CDP required' }
          finally { await cdp?.detach() }
        }
        if (!requested.has(probe.resource.path)) reason = 'Target did not request the selected registered font member'
      }
      if(probe.mode === 'pixels' && bounds && !reason){
        const canvas = await locator.evaluate(element=>({canvas:element.tagName==='CANVAS',width:element.width,height:element.height}))
        if(!canvas.canvas || canvas.width<=0 || canvas.height<=0 ||
            Math.abs(bounds.right-bounds.left-probe.viewport[0])>1 || Math.abs(bounds.bottom-bounds.top-probe.viewport[1])>1)
          reason='Pixel probe needs a visible Canvas CSS box matching the declared logical viewport; backing-store density may differ'
        else{
          // Authored regions and DOM boxes are CSS pixels, not backing-store pixels.
          const screenshot=await locator.screenshot({animations:'disabled',timeout:5000,scale:'css'})
          const {data,info}=await sharp(screenshot).removeAlpha().raw().toBuffer({resolveWithObject:true})
          const regions=variant?.regions ?? probe.regions, mask=regions ? regionMask(info,regions) : undefined
          pixels={sha256:createHash('sha256').update(screenshot).digest('hex'),canvas,
            colors:probe.markers.map(value=>colorBounds(data,info,value.color,mask,regions))}
          if(!requested.has(probe.resource.path))reason='Actual target did not request the selected image member'
        }
      }
    }
    if (probe?.composition && !probe.mode && !variant && !reason) {
      const observed = await page.evaluate(measureDomNodes, probe.composition.nodes)
      const unverified = [...probe.composition.unverified], issues = [], checked = []
      for (const actual of observed) {
        if (actual.unverified) { unverified.push({ id: actual.id, reason: actual.unverified }); continue }
        const expected = probe.composition.nodes.find(node => node.id === actual.id), physical = actual.bounds
        const box = coordinateSpace ? { left: (physical.left-coordinateSpace.root.left)/coordinateSpace.scale[0],
          top: (physical.top-coordinateSpace.root.top)/coordinateSpace.scale[1], right: (physical.right-coordinateSpace.root.left)/coordinateSpace.scale[0],
          bottom: (physical.bottom-coordinateSpace.root.top)/coordinateSpace.scale[1] } : physical
        checked.push(actual.id)
        if (Object.keys(expected.bounds).some(key => Math.abs(box[key]-expected.bounds[key]) > 1))
          issues.push({ id: actual.id, kind: 'geometry', expected: expected.bounds, actual: box })
        if (expected.fontSize !== undefined && Math.abs(actual.fontSize-expected.fontSize) > .1)
          issues.push({ id: actual.id, kind: 'font-size', expected: expected.fontSize, actual: actual.fontSize })
        if (expected.minimumControlSize && [physical.right-physical.left, physical.bottom-physical.top].some((size, i) => size+.01 < expected.minimumControlSize[i]))
          issues.push({ id: actual.id, kind: 'minimum-control-size', minimum: expected.minimumControlSize,
            actual: [physical.right-physical.left, physical.bottom-physical.top] })
      }
      composition = { status: issues.length ? 'failed' : unverified.length || !checked.length ? 'unverified' : 'passed',
        checked, issues, unverified, scope: 'Saved state-independent marked DOM geometry/font sizes/control minima only; no visual fidelity or dynamic-state verdict' }
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
    return { driver: 'host-owned Chromium; actual static build', environment, viewport: probe?.viewport ?? smokeViewport ?? [1280, 720], surfacePresent, bounds, physicalBounds, coordinateSpace, pixels, scene, font, textFit, composition, reason,
      requestedFiles: [...requested], missingFiles: [...missing], errors, unsupported: [...unsupported],
      limitations: 'Initial load/error smoke only. Container/text presence is NOT pixel/rendering proof. Fetching JSON is NOT proof its layout, hierarchy, resources or gameplay rules are consumed.' }
  } finally { await context.close() }
  }
  if (!uiProbes) {
    const desktop = await observe()
    if (!requiredViewport) console.log(JSON.stringify(desktop))
    else {
      const phone = await observe(undefined, undefined, undefined, false, false, requiredViewport)
      console.log(JSON.stringify({...desktop, surfacePresent: desktop.surfacePresent && phone.surfacePresent,
        errors: [...desktop.errors, ...phone.errors], missingFiles: [...desktop.missingFiles, ...phone.missingFiles],
        unsupported: [...desktop.unsupported, ...phone.unsupported], phone,
        limitations: desktop.limitations+' Host-required phone initial load only; control minima and other states require bound UI probes and remain unverified here.'}))
    }
  }
  else {
    const results = [], errors = [], missing = new Set(), unsupported = new Set()
    const conditions = (probe, observed) => ({environment:observed.environment,
      activation:{kind:'locator-clicks',steps:probe.steps??[],...(probe.mode==='audio'?{playSteps:probe.playSteps,stopSteps:probe.stopSteps}:{})},
      coverage:'Only this viewport, pixel density and declared activation path; no complete gameplay or visual-quality verdict'})
    for (const probe of uiProbes) {
      if (probe.mode === 'scene') {
        const baseline = await observe(probe), repeated = await observe(probe), changed = await observe(probe,probe.variants[0]), restored = await observe(probe)
        const observations = [baseline,repeated,changed,restored]
        let reason = observations.find(value => value.reason)?.reason
        if (!reason && (baseline.scene.sha256 !== repeated.scene.sha256 || baseline.scene.sha256 !== restored.scene.sha256))
          reason = 'Original Canvas is not stable across repeated/restored loads; node causality cannot be isolated'
        if (!reason && baseline.scene.sha256 === changed.scene.sha256)
          reason = 'Disabling the selected saved Scene node did not change the observed Canvas; node use is unverified'
        const status = observations.some(value => value.errors.length || value.missingFiles.length) ? 'failed' : reason ? 'unverified' : 'passed'
        results.push({document:probe.document,nodeId:probe.nodeId,viewport:probe.viewport,status,reason,conditions:conditions(probe,baseline),
          baseline:baseline.scene,repeated:repeated.scene,changed:changed.scene,restored:restored.scene})
        for (const value of observations) {errors.push(...value.errors);value.missingFiles.forEach(file=>missing.add(file));value.unsupported.forEach(file=>unsupported.add(file))}
        continue
      }
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
        results.push({ document: probe.document, nodeId: probe.nodeId, componentId: probe.componentId, resource: probe.resource, status, reason, conditions:conditions(probe,before),
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
        results.push({document:probe.document,nodeId:probe.nodeId,viewport:probe.viewport,resource:probe.resource,status,reason,conditions:conditions(probe,before),
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
        results.push({document:probe.document,nodeId:probe.nodeId,componentId:probe.componentId,tileId:probe.tileId,resource:probe.resource,viewport:probe.viewport,status,reason,conditions:conditions(probe,baseline),
          baseline:baseline.pixels,before:before.pixels,resourceChanged:other.pixels,
          changed:changed.map(value=>({property:value.property,expected:value.expected,actual:value.actual.pixels})),restored:restored.pixels,expectedBefore:probe.before})
        for(const value of observations){errors.push(...value.errors);value.missingFiles.forEach(file=>missing.add(file));value.unsupported.forEach(file=>unsupported.add(file))}
        continue
      }
      const before = await observe(probe), changed = []
      for (const variant of probe.variants) changed.push({ property: variant.property, expected: variant.expected, actual: await observe(probe, variant) })
      const disabled = await observe(probe, {property:'enabled', replacement:probe.disabledSource})
      const restored = await observe(probe)
      const match = (actual, expected) => actual && Object.keys(expected).every(key => Math.abs(actual[key]-expected[key]) <= 1)
      const geometryObservations = [before, ...changed.map(value=>value.actual), restored]
      const observations = [...geometryObservations, disabled]
      // Do not compare minima in the inverse-scaled reference coordinate space.
      // Only original/restored controls matter: mutations deliberately alter size.
      const controlSizes = probe.minimumControlSize ? [before, restored].map(value => {
        const box = value.physicalBounds ?? value.bounds
        return box && !value.reason ? [box.right-box.left, box.bottom-box.top] : undefined
      }) : undefined
      const controlFailure = controlSizes?.some(size => size && size.some((value, i) => value + .01 < probe.minimumControlSize[i]))
      // Do not refit a changed surface to make a wrong node match. The
      // independent reference must stay stable through source perturbations.
      const basisChanged = probe.coordinateRoot && before.coordinateSpace && observations.some(value=>value.coordinateSpace &&
        (!match(value.coordinateSpace.root,before.coordinateSpace.root) ||
          value.coordinateSpace.scale.some((scale,i)=>Math.abs(scale-before.coordinateSpace.scale[i])>.000001)))
      const runtimeReason = before.reason || changed.find(value=>value.actual.reason)?.actual.reason || restored.reason || disabled.reason ||
        (basisChanged?'coordinateRoot changed during source perturbation/restoration; no target-based calibration is accepted':undefined)
      const enabledFailure = !runtimeReason && !disabled.errors.length && !disabled.missingFiles.length &&
        !disabled.unsupported.length && disabled.visible === true
      const textFailure=observations.some(value=>value.textFit?.status==='failed'), textUnknown=observations.some(value=>value.textFit?.status==='unverified')
      const mismatch = !match(before.bounds,probe.before) ? 'baseline' : changed.find(value=>!match(value.actual.bounds,value.expected))?.property ??
        (!match(restored.bounds,probe.before)?'restored':undefined)
      const geometryFailure = !runtimeReason && probe.variants.length>0 && mismatch
      const compositionFailure = [before, restored].some(value => value.composition?.status === 'failed')
      const compositionUnknown = [before, restored].some(value => value.composition?.status === 'unverified')
      const textPhase = before.textFit?.status==='failed'?'baseline':changed.find(value=>value.actual.textFit?.status==='failed')?.property ?? 'restored'
      const reason = compositionFailure ? 'Rendered composition differs from saved UI geometry, font sizes or control minima; inspect composition.issues' : controlFailure ? 'Actual CSS control size is below declared minimumControlSize '+probe.minimumControlSize.join('x') : textFailure ? 'Visible text exceeds node bounds at '+textPhase : runtimeReason ||
        (enabledFailure ? 'Saved enabled=false is ignored: target remains visible' : undefined) ||
        (geometryFailure ? 'Observed geometry differs from saved layout at '+mismatch+
          (probe.coordinateRoot?' in saved logical UI pixels':' in window CSS pixels; a fixed source-sized surface may use an explicit independent coordinateRoot. This mismatch is not proof of the whole-game appearance.') : !probe.variants.length ?
          'No observable saved layout property perturbation; baseline/restoration and text observations do not prove data consumption' :
          textUnknown ? 'Complete visible text fit could not be established' : compositionUnknown ? 'Rendered composition coverage is incomplete; inspect composition.unverified' : undefined)
      const status = compositionFailure || controlFailure || textFailure || geometryFailure || enabledFailure ? 'failed' : runtimeReason || !probe.variants.length || textUnknown || compositionUnknown || disabled.unsupported.length ? 'unverified' :
        observations.some(value => value.errors.length || value.missingFiles.length) ? 'failed' : 'passed'
      results.push({ document: probe.document, nodeId: probe.nodeId, viewport: probe.viewport, status, reason, conditions:conditions(probe,before),
        composition: { before: before.composition, restored: restored.composition },
        coordinateDomain:probe.coordinateRoot?'saved logical UI pixels':'window CSS pixels',
        ...(probe.coordinateRoot?{coordinateRoot:probe.coordinateRoot,layoutViewport:probe.layoutViewport,
          mappings:geometryObservations.map(value=>({basis:value.coordinateSpace,physicalBounds:value.physicalBounds}))}:{}),
        enabled:{beforeVisible:Boolean(before.bounds && !before.reason),disabledVisible:disabled.visible,
          restoredVisible:Boolean(restored.bounds && !restored.reason),...(disabled.reason?{reason:disabled.reason}:{})},
        unobservedProperties:probe.unobservedProperties,
        ...(controlSizes?{controlSize:{unit:'CSS pixels',minimum:probe.minimumControlSize,before:controlSizes[0],restored:controlSizes[1]}}:{}),
        ...(probe.checkTextFit?{textFit:{before:before.textFit,changed:changed.map(value=>({property:value.property,actual:value.actual.textFit})),restored:restored.textFit}}:{}),
        before: before.bounds, changed: changed.map(value=>({ property:value.property,actual:value.actual.bounds,expected:value.expected })), restored: restored.bounds, expectedBefore: probe.before })
      for (const value of observations) {
        errors.push(...value.errors); value.missingFiles.forEach(file => missing.add(file)); value.unsupported.forEach(file => unsupported.add(file))
      }
    }
    console.log(JSON.stringify({ driver: 'host-owned Chromium; actual target build; in-memory source response mutation',
      probes: results, errors, missingFiles: [...missing], unsupported: [...unsupported],
      limitations: 'Selected Scene-node visible causality, declared DOM geometry/text-font, static Canvas image/Tilemap or HTML audio probes only; response-only changes/restoration. Scene causality does not prove correct shape/placement or all nodes. Decoded audio capture ignores volume/mute: native properties checked separately, no final output/listening/loop-boundary proof. Not collisions, sorting, animation, 3D/Canvas fonts/Web Audio/full gameplay acceptance.' }))
  }
} finally { await browser.close() }
