import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Optional, test-only evidence output. Does not participate in delivery or runtime. */
export type LayoutVisualCase = {
  group: string
  viewport: string
  strategy: string
  screenshot: Uint8Array
  checks: string[]
  expectedBounds?: { left: number; top: number; right: number; bottom: number }
}
export async function saveLayoutBrowserReport(name: string, title: string, scope: string, cases: LayoutVisualCase[]) {
  const directory = process.env.BGS_LAYOUT_REPORT_DIR
  if (!directory) return
  if (!isAbsolute(directory)) throw new Error('BGS_LAYOUT_REPORT_DIR must be absolute')
  await mkdir(directory, { recursive: true })
  const { default: sharp } = await import('sharp')
  const records = await Promise.all(cases.map(async item => {
    const png = await sharp(item.screenshot).metadata()
    return { ...item, width: png.width, height: png.height, screenshot: `data:image/png;base64,${Buffer.from(item.screenshot).toString('base64')}` }
  }))
  const escapes:Record<string,string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const escape = (value: string) => value.replace(/[&<>"']/g, char => escapes[char])
  const data = JSON.stringify(records).replace(/</g, '\\u003c')
  // Screenshots are embedded: the saved report works offline without a fixture server.
  await Bun.write(join(directory, `${name}.html`), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escape(title)}</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:light-dark(#f6f7f9,#111214);color:light-dark(#17191d,#eceef2)}
body{margin:0;padding:24px;max-width:1500px;margin-inline:auto}h1{font-size:24px}p{line-height:1.6}.scope{max-width:920px;color:light-dark(#555b67,#abb0ba)}
.controls{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}label{display:grid;gap:8px}select{font:inherit;padding:8px;min-height:40px}
#cases{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}article{min-width:0}h2{font-size:18px;font-weight:500}
.picture{position:relative;background:#000;line-height:0}.picture img{display:block;width:100%;height:auto}.picture svg{position:absolute;inset:0;width:100%;height:100%}
.checks{padding-left:20px;font-size:14px;line-height:1.7}.legend{font-size:14px}.caption{font-size:14px;color:light-dark(#555b67,#abb0ba)}
@media(max-width:480px){body{padding:16px}}@media print{.controls{display:none}article{break-inside:avoid}}
</style></head><body>
<h1>${escape(title)}</h1><p class="scope">${escape(scope)}</p>
<p>${records.length} 个实测画面通过 · ${escape(new Date().toISOString())} · 费用 0（未调用模型）</p>
<div class="controls"><label>验证内容<select id="group"></select></label><label>浏览器尺寸<select id="viewport"></select></label></div>
<p class="legend">${records.some(item => item.expectedBounds) ? '截图来自真实浏览器；3D 画面中的青色虚线为计算出的模型边界，不是另画一份模型。' : '截图来自真实浏览器的原生 CSS 排布，不是重新绘制的布局示意图。'}</p>
<main id="cases"></main><script id="data" type="application/json">${data}</script><script>
const records=JSON.parse(document.getElementById('data').textContent),group=document.getElementById('group'),viewport=document.getElementById('viewport'),main=document.getElementById('cases');
const options=(element,values)=>{element.replaceChildren(...values.map(value=>{const option=document.createElement('option');option.value=option.textContent=value;return option}))};
options(group,[...new Set(records.map(item=>item.group))]);
function render(){main.replaceChildren();for(const item of records.filter(item=>item.group===group.value&&item.viewport===viewport.value)){
 const card=document.createElement('article'),heading=document.createElement('h2');heading.textContent=({'expand':'扩展取景','keep-height':'保持垂直范围','keep-width':'保持水平范围','letterbox':'保持宽高比／留边'})[item.strategy]||item.strategy;card.append(heading);
 const picture=document.createElement('div');picture.className='picture';const image=document.createElement('img');image.src=item.screenshot;image.alt=item.group+' '+item.viewport+' '+item.strategy;picture.append(image);
 if(item.expectedBounds){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),rect=document.createElementNS(ns,'rect'),b=item.expectedBounds;
 svg.setAttribute('viewBox','0 0 '+item.width+' '+item.height);svg.setAttribute('aria-hidden','true');
 for(const [key,value] of Object.entries({x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top,fill:'none',stroke:'#00d9e8','stroke-width':2,'stroke-dasharray':'6 4'}))rect.setAttribute(key,String(value));svg.append(rect);picture.append(svg)}
 card.append(picture);const caption=document.createElement('p');caption.className='caption';caption.textContent='截图实际尺寸 '+item.width+' × '+item.height;card.append(caption);
 const checks=document.createElement('ul');checks.className='checks';for(const text of item.checks){const li=document.createElement('li');li.textContent=text;checks.append(li)}card.append(checks);main.append(card)
}}
function changeGroup(){const values=[...new Set(records.filter(item=>item.group===group.value).map(item=>item.viewport))];options(viewport,values);if(values.includes('390 × 844'))viewport.value='390 × 844';render()}
group.addEventListener('change',changeGroup);viewport.addEventListener('change',render);changeGroup();
</script></body></html>`)
}
