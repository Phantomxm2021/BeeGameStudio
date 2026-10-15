import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { bundleContentConsumer, CONTENT_CONSUMER_API } from '../game-content-consumer-cli'
import { digest, WorkflowError, type Run } from './state'

// Only exact host records are ignored. A README, imported source, unknown dot
// file or alias makes this an existing project, not permission to overwrite it.
async function sourcePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  async function visit(dir: string) {
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      const path = relative(root, join(dir, entry.name))
      if (path === '.beegame' || path === 'transcripts' ||
          /^logs\/(index\.json|runtime-diagnostics\.jsonl(?:\.\d+)?)$/.test(path)) continue
      if (entry.isDirectory()) await visit(join(root,path))
      else paths.push(path)
    }
  }
  await visit(root)
  return paths
}

export async function observeProjectCreation(root: string, brief: {
  settings: Record<string, unknown>; build_source?: unknown; creation_mode?: unknown
}): Promise<Run['creation']> {
  if (brief.build_source != null || brief.creation_mode !== 'creative' ||
      (await sourcePaths(await realpath(root))).length) return undefined
  const settings = brief.settings
  const editableContent = settings.platform === 'Web' && settings.bgsVisualEditing !== false
  return {initialDelivery:'playable-slice',editableContent,
    ...(editableContent && settings.engine === 'React' && settings.dimension === '2D' &&
      ['Landscape','Portrait'].includes(String(settings.orientation)) ? {webStarter:'react-canvas-2d-v1' as const} : {})}
}

/** Generic connection sample, not game content or a visual direction. Dynamic
 * simulation stays in game.js; the shared consumer is not a gameplay engine. */
export async function webStarterFiles(orientation: 'Landscape' | 'Portrait', language: string) {
  const [width,height] = orientation === 'Portrait' ? [540,960] : [960,540]
  const scene = {schema:'beegame-content.v1',id:'main',kind:'scene-2d',assetRefs:[],data:{
    cameraNodeId:'camera',settings:{coordinateSystem:{
      origin:'top-left',units:'logical-pixels',width,height,pixelsPerUnit:100}},
    nodes:[
      {id:'camera',components:[{id:'camera',type:'camera',data:{orthographic:true,
        orthographicSize:height/200,coordinateSpace:'logical-pixels',viewport:{width,height},framing:'expand'}}]},
      {id:'surface',transform:{position:[width/2,height/2,0]},components:[
        {id:'surface',type:'sprite-renderer',data:{size:[width,height],color:'#18202b'}}]},
    ],
  }}
  const ui = {schema:'beegame-content.v1',id:'hud',kind:'ui-hud',assetRefs:[],data:{
    rootId:'hud',nodes:[
      {id:'hud',role:'hud-root',layout:{size:[width,height]},data:{
        orientation,referenceResolution:[width,height],targetViewports:[[width,height]],minimumControlSize:[44,44]}},
      {id:'status',parentId:'hud',role:'text',bindings:{text:'status'},
        layout:{anchor:'top-left',position:[24,24],size:[Math.min(width-120,480),48]},
        style:{fontSize:18,color:'#ffffff'}},
      {id:'reset',parentId:'hud',role:'button',text:'↺',actions:{click:'reset'},
        layout:{anchor:'top-right',position:[-24,24],size:[48,48]},
        style:{fontSize:24,color:'#ffffff',backgroundColor:'#334155'}},
    ],
  }}
  const json = (value: unknown) => JSON.stringify(value,null,2)+'\n'
  const index = {schema:'beegame-content-package.v2',id:'game',dimension:'2d',sceneModel:'game-object-v2',
    documentRevision:digest(json(scene)+json(ui)),assetManifestRevision:digest('no-assets'),
    entryScene:'main',files:['scenes/main.json','ui/hud.json'],documents:[
      {id:'main',path:'scenes/main.json',kind:'scene-2d',loadPhase:'startup'},
      {id:'hud',path:'ui/hud.json',kind:'ui-hud',loadPhase:'startup'},
    ]}
  return {
    'package.json':json({name:'bgs-web-game',private:true,type:'module',scripts:{dev:'vite --host 127.0.0.1',build:'vite build'},
      dependencies:{react:'19.3.0','react-dom':'19.3.0'},devDependencies:{vite:'8.3.0'}}),
    'index.html':'<!doctype html><html lang="'+language+'"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BGS</title><div id="root"></div><script type="module" src="./src/main.jsx"></script></html>\n',
    'vite.config.js':`import { cp } from 'node:fs/promises';
export default { base: './', publicDir: false, plugins: [{
  name: 'editable-content', apply: 'build',
  async closeBundle() { await cp('content', 'dist/content', { recursive: true }); }
}] };
`,
    'content/index.json':json(index),'content/scenes/main.json':json(scene),'content/ui/hud.json':json(ui),
    'src/bgs-content-consumer.mjs':await bundleContentConsumer(),
    'src/bgs-content-api.json':json(CONTENT_CONSUMER_API),
    'src/game.js':`// Connection sample only. Implement the current playable slice here.
// Read ./bgs-content-api.json for the shared API, not the compiled consumer.
// Keep tunable gameplay values in scene.settings (or one imported config),
// and expose HUD values through this state rather than duplicating constants.
export function createGame({ canvas, scene }) {
  let resets = 0;
  const state = { status: 'BGS · 0' };
  return {
    state,
    update(dt) { /* Add simulation; dt is seconds. */ },
    draw(ctx, viewport) { /* Add dynamic drawing; consume scene nodes/camera. */ },
    action(action, nodeId) { if (action === 'reset') state.status = 'BGS · ' + ++resets; },
    dispose() { /* Remove any game-owned input/audio subscriptions. */ },
  };
}
`,
    'src/main.jsx':`import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseBeeGameContentIndex, fetchStartupContentDocuments, readSceneData, readUiData,
  createProductionUiSurface, renderProductionScene2d } from './bgs-content-consumer.mjs';
import { createGame } from './game.js';
import './style.css';

function App() {
  const canvas = useRef(null), hud = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let frame = 0, surface, game, stopped = false, previous = 0, lastHud = '';
    const cleanup = () => {
      stopped = true; abort.abort(); cancelAnimationFrame(frame);
      game?.dispose(); surface?.dispose();
    };
    const fail = error => { if (!stopped) { cleanup(); setError(String(error)); } };
    (async () => {
      const fetcher = (url) => fetch(url, { signal: abort.signal });
      const indexUrl = new URL('./content/index.json', document.baseURI);
      const response = await fetcher(indexUrl);
      if (!response.ok) throw Error('content/index.json: HTTP ' + response.status);
      const index = parseBeeGameContentIndex(await response.json());
      const docs = await fetchStartupContentDocuments(index, indexUrl, fetcher);
      if (stopped) return;
      const scene = readSceneData(docs.find(doc => doc.id === index.entryScene));
      const ui = readUiData(docs.find(doc => doc.kind === 'ui-hud'));
      surface = await createProductionUiSurface(hud.current);
      if (stopped) { surface.dispose(); return; }
      game = createGame({ canvas: canvas.current, scene });
      const tick = now => {
        try {
          const viewport = { width: canvas.current.clientWidth, height: canvas.current.clientHeight };
          if (viewport.width > 0 && viewport.height > 0) {
            game.update(previous ? Math.min((now - previous) / 1000, 0.05) : 0);
            renderProductionScene2d(canvas.current, scene, viewport);
            game.draw(canvas.current.getContext('2d'), viewport);
            // Avoid replacing interactive DOM every frame when nothing changed.
            const key = JSON.stringify([viewport, game.state]);
            if (key !== lastHud) {
              surface.render(ui, viewport, { state: game.state, onAction: (action, id) => game.action(action, id) });
              lastHud = key;
            }
          }
          previous = now; frame = requestAnimationFrame(tick);
        } catch (error) { fail(error); }
      };
      frame = requestAnimationFrame(tick);
    })().catch(fail);
    return cleanup;
  }, []);
  return <main><canvas ref={canvas}/><div className="hud" ref={hud}/>{error && <pre role="alert">{error}</pre>}</main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`,
    'src/style.css':`html,body,#root,main{margin:0;width:100%;height:100%;overflow:hidden}main{position:relative;background:#111827}canvas,.hud{position:absolute;inset:0;width:100%;height:100%}.hud{pointer-events:none}pre[role=alert]{position:absolute;inset:16px;color:#fff;background:#7f1d1d;white-space:pre-wrap}
`,
  }
}

/** Called only under the first native writer reservation. Exclusive writes and
 * exact-byte recovery never replace an existing or subsequently edited source. */
export async function installWebStarter(run: Run) {
  if (run.creation?.webStarter !== 'react-canvas-2d-v1') return
  const root = await realpath(run.workspacePath)
  const brief = JSON.parse(run.requirements.text)
  const files = await webStarterFiles(brief.settings.orientation, brief.game_user_visible_language)
  for (const path of await sourcePaths(root)) {
    const file = join(root,path)
    if (!Object.hasOwn(files,path) || !(await lstat(file)).isFile() ||
        await readFile(file,'utf8') !== files[path as keyof typeof files])
      throw new WorkflowError('starter-conflict','Existing project source preserved; starter not installed: '+path)
  }
  // Check every destination before writing any, including empty aliased parents.
  for (const path of Object.keys(files)) {
    let parent = root
    for (const segment of relative(root,dirname(join(root,path))).split('/').filter(Boolean)) {
      parent = join(parent,segment)
      await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw error })
      if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory())
        throw new WorkflowError('starter-conflict','Starter parent must be a real directory: '+parent)
    }
  }
  for (const [path,bytes] of Object.entries(files))
    await writeFile(join(root,path),bytes,{flag:'wx'}).catch(async error => {
      if (error.code !== 'EEXIST' || !(await lstat(join(root,path))).isFile() ||
          await readFile(join(root,path),'utf8') !== bytes) throw error
    })
}
