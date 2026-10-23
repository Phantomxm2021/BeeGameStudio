import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { withPlayCapture } from './preview-play-capture.mjs';

// A small static sample, not a game engine or an animation-quality checker.
// The emitted build is self-contained; it never imports host/temp modules.
export function spriteClip(atlas, frameMs, ids, size) {
  if (!Number.isInteger(frameMs) || frameMs < 50 || frameMs > 500 ||
      !Array.isArray(ids) || ids.length < 2 || ids.length > 32 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !id.trim()))
    throw Error('Use 2..32 distinct ordered frame IDs and an integer frame duration of 50..500 ms');
  const { w, h } = size ?? {};
  if (![w, h].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || w * h > 16_000_000) throw Error('Invalid or oversized image dimensions');
  const frames = ids.map(id => {
    const item = atlas.frames?.[id], r = item?.frame;
    if (!r || item.rotated || item.trimmed || ![r.x, r.y, r.w, r.h].every(Number.isInteger) ||
        r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > w || r.y + r.h > h)
      throw Error('Missing, rotated, trimmed or out-of-bounds frame: ' + id);
    return { id, x: r.x, y: r.y, w: r.w, h: r.h };
  });
  if (frames.some(r => r.w !== frames[0].w || r.h !== frames[0].h))
    throw Error('Sample requires equal-size prepared frame canvases; it does not invent pivots or align artwork');
  return { frameMs, frames, width: w, height: h };
}

// Same PNG header boundary as assets.mjs atlas; actual pixels are decoded by
// the browser below, not by a newly authored PNG decoder.
function pngSize(bytes) {
  if (bytes.length < 26 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Sample needs a PNG');
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

async function assetFile(root, path) {
  if (typeof path !== 'string' || !path.startsWith('assets/') || path.includes('\\') ||
      path.split('/').some(p => !p || p.startsWith('.')))
    throw Error('Use a public project-relative assets/ path');
  const file = resolve(root, path);
  if (await realpath(file) !== file || !(await lstat(file)).isFile()) throw Error('Asset must be a regular non-aliased file');
  return file;
}

// Serialized verbatim into the static build. Only draws supplied image crops.
async function playSprite(config) {
  const canvas = document.querySelector('canvas'), button = document.querySelector('button');
  const context = canvas.getContext('2d'), image = new Image();
  image.src = 'sheet.png';
  await image.decode();
  if (image.naturalWidth !== config.width || image.naturalHeight !== config.height) throw Error('Decoded image dimensions differ from atlas');
  canvas.width = config.frames[0].w; canvas.height = config.frames[0].h;
  let index = 0, playing = true, last = performance.now(), elapsed = 0, advances = 0;
  const draw = () => {
    const frame = config.frames[index];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    canvas.dataset.frame = frame.id;
    canvas.dataset.advances = String(advances);
    canvas.dataset.playing = String(playing);
  };
  const toggle = () => {
    playing = !playing; last = performance.now();
    button.textContent = playing ? 'Pause' : 'Play';
    button.setAttribute('aria-pressed', String(!playing)); draw();
  };
  button.onclick = toggle;
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); toggle(); } });
  const tick = now => {
    if (playing) {
      elapsed += now - last;
      if (elapsed >= config.frameMs) {
        const steps = Math.floor(elapsed / config.frameMs); elapsed %= config.frameMs;
        advances += steps; index = (index + steps) % config.frames.length; draw();
      }
    }
    last = now; requestAnimationFrame(tick);
  };
  draw(); canvas.dataset.ready = 'true'; requestAnimationFrame(tick);
}

export async function createSpriteSample(imagePath, atlasPath, frameMs, ids) {
  const root = await realpath(process.cwd());
  const atlasFile = await assetFile(root, atlasPath);
  const atlas = JSON.parse(await readFile(atlasFile, 'utf8'));
  const imageFile = await assetFile(root, imagePath);
  const clip = spriteClip(atlas, frameMs, ids, pngSize(await readFile(imageFile)));
  if (!imagePath.endsWith('.png')) throw Error('Sample supports PNG atlases');
  // Refuse existing apps, including existing dist output. Never replace a
  // generated project to demonstrate the sample or a system repair.
  for (const path of ['package.json', 'sprite-sample-build.mjs', 'sprite-sample-preview.mjs', 'dist']) {
    try { await lstat(resolve(root, path)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('Sprite sample requires a new project; will not overwrite ' + path);
  }
  // Reuse BGS's existing decoder, outside the opaque-origin Preview iframe.
  // Pixel readback there is deliberately restricted by the browser sandbox.
  if (!process.env.BEEGAME_SHARP_MODULE) throw Error('BGS image runtime unavailable; no decoder was installed');
  const sharp = (await import(process.env.BEEGAME_SHARP_MODULE)).default;
  const decoded = sharp(imageFile, { limitInputPixels: 16_000_000 });
  const metadata = await decoded.metadata(), stats = await decoded.stats();
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sprite sample</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:16px;background:#eef1f4;font:16px system-ui;text-align:center}canvas{max-width:80vw;max-height:65vh;width:auto;height:auto;margin:auto}button{padding:12px}p{max-width:40em}</style>' +
    '<canvas id="bgs-sprite"></canvas><button type="button" aria-pressed="false">Pause</button><p>Sprite playback sample. Motion quality is unverified.</p>';
  const build = `import {mkdir,readFile,writeFile,copyFile,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
const spriteClip=${spriteClip.toString()};
const assetFile=${assetFile.toString()};
const pngSize=${pngSize.toString()};
const root=await realpath(process.cwd()), atlasFile=await assetFile(root,${JSON.stringify(atlasPath)});
const atlas=JSON.parse(await readFile(atlasFile,'utf8'));
const imageFile=await assetFile(root,${JSON.stringify(imagePath)});
const config=spriteClip(atlas,${frameMs},${JSON.stringify(ids)},pngSize(await readFile(imageFile)));
await mkdir('dist',{recursive:true});
await copyFile(imageFile,'dist/sheet.png');
await writeFile('dist/index.html',${JSON.stringify(html)}+'<script id="sprite-config" type="application/json">'+JSON.stringify(config).replaceAll('<','\\u003c')+'</script><script>('+${JSON.stringify(playSprite.toString())}+')(JSON.parse(document.querySelector("#sprite-config").textContent)).catch(e=>{document.querySelector("canvas").dataset.error=e.message;document.body.append(document.createTextNode(e.message));throw e})</script></html>');
`;
  const preview = `// Serve only the existing build. No install, rebuild or file enumeration.
const port=Number(process.env.PORT);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT is required');
Bun.serve({hostname:'127.0.0.1',port,fetch(request){
  const path=new URL(request.url).pathname;
  const file=path==='/'||path==='/index.html'?'index.html':path==='/sheet.png'?'sheet.png':null;
  if(!file||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
  return new Response(Bun.file('dist/'+file),{headers:{'Cache-Control':'no-store'}});
}});
`;
  await writeFile(resolve(root, 'sprite-sample-build.mjs'), build, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(root, 'sprite-sample-preview.mjs'), preview, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { build: 'bun sprite-sample-build.mjs', preview: 'bun sprite-sample-preview.mjs' } }, null, 2), { flag: 'wx', mode: 0o600 });
  return { sources: ['package.json', 'sprite-sample-build.mjs', 'sprite-sample-preview.mjs'], artifact: 'dist', quality: 'unverified',
    image: { width: clip.width, height: clip.height, hasAlpha: metadata.hasAlpha, isOpaque: stats.isOpaque },
    note: 'No build, browser or generation started. Use the existing measure entry once, then --sprite-capture. PNG pixels are unchanged; pose quality requires visual judgment.' };
}

/** Fixed assertions for this sample only. No project test script is created. */
export async function inspectSpritePlayback({ page, gameFrame }) {
  const result = { status: 'failed', playback: [], paused: [], resumed: [] };
  try {
    const sprite = gameFrame.locator('#bgs-sprite');
    await gameFrame.waitForSelector('#bgs-sprite[data-ready="true"], #bgs-sprite[data-error]', { timeout: 10_000 });
    assert.equal(await sprite.getAttribute('data-error'), null, 'Sprite failed to load: ' + await sprite.getAttribute('data-error'));
    const config = JSON.parse(await gameFrame.locator('#sprite-config').textContent());
    spriteClip({ frames: Object.fromEntries(config.frames.map(f => [f.id, { frame: f }])) }, config.frameMs, config.frames.map(f => f.id), { w: config.width, h: config.height });
    result.expectedFrames = config.frames.map(f => f.id);
    const sample = async (target, duration) => {
      const start = Date.now();
      do {
        target.push(await sprite.evaluate(el => ({ frame: el.dataset.frame, advances: Number(el.dataset.advances), playing: el.dataset.playing })));
        await page.waitForTimeout(Math.max(10, Math.floor(config.frameMs / 3)));
      } while (Date.now() - start < duration);
    };
    await sample(result.playback, Math.max(5000, config.frames.length * config.frameMs * 2));
    assert.deepEqual([...new Set(result.playback.map(s => s.frame))].sort(), [...result.expectedFrames].sort(), 'Not every selected frame was observed');
    await gameFrame.locator('button').click();
    await sample(result.paused, Math.max(500, config.frameMs * 3));
    assert.ok(result.paused.every(s => s.playing === 'false' && s.advances === result.paused[0].advances && s.frame === result.paused[0].frame), 'Pause did not hold');
    await page.keyboard.press('Space');
    await sample(result.resumed, Math.max(500, config.frameMs * 3));
    assert.ok(result.resumed.every(s => s.playing === 'true') && result.resumed.some(s => s.advances > result.paused[0].advances), 'Resume did not advance');
    result.status = 'passed';
  } catch (error) { result.error = error.message; }
  return result;
}

export async function captureSpriteSample() {
  const report = await withPlayCapture({ mode: 'production', viewport: { width: 800, height: 600 } }, inspectSpritePlayback);
  if (report.observations?.status !== 'passed' || Object.values(report.runtimeErrors ?? {}).some(n => n > 0))
    throw Error('Sprite playback assertions failed; retained ' + report.directory + '/observation.json: ' +
      (report.observations?.error ?? JSON.stringify(report.runtimeErrors)));
  // Complete samples stay in observation.json, not repeated in model context.
  const { observations, ...summary } = report;
  return { ...summary, observations: { status: observations.status, expectedFrames: observations.expectedFrames,
    sampleCounts: { playback: observations.playback.length, paused: observations.paused.length, resumed: observations.resumed.length } } };
}
