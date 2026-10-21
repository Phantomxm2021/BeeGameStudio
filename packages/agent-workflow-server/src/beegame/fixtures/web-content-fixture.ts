import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contentConsumerDistribution, registeredRuntimeFilesSource } from '../game-content-consumer-cli'

// Test-authored sample for exercising the optional Web consumer; never installed by BGS.
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
    entryScene:'main',files:['scenes/main.json','ui/hud.json'],documents:[
      {id:'main',path:'scenes/main.json',kind:'scene-2d',loadPhase:'startup'},
      {id:'hud',path:'ui/hud.json',kind:'ui-hud',loadPhase:'startup'},
    ]}
  return {
    'package.json':json({name:'bgs-web-game',private:true,type:'module',scripts:{dev:'vite --host 127.0.0.1',build:'vite build'},
      dependencies:{react:'19.3.0','react-dom':'19.3.0'},devDependencies:{vite:'8.3.0'}}),
    'index.html':'<!doctype html><html lang="'+language+'"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BGS</title><div id="root"></div><script type="module" src="./src/main.jsx"></script></html>\n',
    'scripts/bgs-runtime-files.mjs':await registeredRuntimeFilesSource(),
    'vite.config.js':`import { copyRegisteredRuntimeFiles } from './scripts/bgs-runtime-files.mjs';
export default { base: './', publicDir: false, plugins: [{
  name: 'editable-content', apply: 'build',
  async closeBundle() { await copyRegisteredRuntimeFiles(process.cwd(), 'dist'); }
}] };
`,
    'content/index.json':json(index),'content/scenes/main.json':json(scene),'content/ui/hud.json':json(ui),
    ...Object.fromEntries(Object.entries(await contentConsumerDistribution()).map(([name, body]) => ['vendor/bgs-runtime/' + name, body])),
    'src/game.js':`// Connection sample only. Implement the current playable slice here.
// Read ../vendor/bgs-runtime/api.json for the shared API, not the compiled consumer.
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
  createProductionUiSurface, renderProductionScene2d, loadProductionResources } from '../vendor/bgs-runtime/content-consumer.mjs';
import { createGame } from './game.js';
import './style.css';

function App() {
  const canvas = useRef(null), hud = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let frame = 0, surface, game, resources, stopped = false, previous = 0, lastHud = '';
    const cleanup = () => {
      stopped = true; abort.abort(); cancelAnimationFrame(frame);
      game?.dispose(); surface?.dispose(); resources?.dispose();
    };
    const fail = error => { if (!stopped) { cleanup(); setError(String(error)); } };
    (async () => {
      const fetcher = (url) => fetch(url, { signal: abort.signal });
      const indexUrl = new URL('./content/index.json', document.baseURI);
      const response = await fetcher(indexUrl);
      if (!response.ok) throw Error('content/index.json: HTTP ' + response.status);
      const index = parseBeeGameContentIndex(await response.json());
      const docs = await fetchStartupContentDocuments(index, indexUrl, fetcher);
      if (docs.some(doc => doc.assetRefs.length)) resources = await loadProductionResources(new URL('./assets/asset-manifest.json', document.baseURI), docs, fetcher);
      if (stopped) { resources?.dispose(); return; }
      const entry = docs.find(doc => doc.id === index.entryScene);
      const scene = entry?.kind.startsWith('scene-') ? readSceneData(entry) : undefined;
      const ui = readUiData(entry?.kind.startsWith('ui-') ? entry : docs.find(doc => doc.kind === 'ui-hud' || doc.kind === 'ui-screen'));
      surface = await createProductionUiSurface(hud.current);
      if (stopped) { surface.dispose(); return; }
      game = createGame({ canvas: canvas.current, scene, assets: resources?.assets, resourceUrl: resources?.resourceUrl });
      const tick = now => {
        try {
          const viewport = { width: canvas.current.clientWidth, height: canvas.current.clientHeight };
          if (viewport.width > 0 && viewport.height > 0) {
            game.update(previous ? Math.min((now - previous) / 1000, 0.05) : 0);
            if (scene) renderProductionScene2d(canvas.current, scene, viewport, resources?.assets, resources?.fonts);
            game.draw(canvas.current.getContext('2d'), viewport);
            // Avoid replacing interactive DOM every frame when nothing changed.
            const key = JSON.stringify([viewport, game.state]);
            if (key !== lastHud) {
              surface.render(ui, viewport, { state: game.state, assets: resources?.assets, fonts: resources?.fonts, onAction: (action, id) => game.action(action, id) });
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

export async function writeWebContentFixture(root: string) {
  for (const [path, body] of Object.entries(await webStarterFiles('Landscape', 'zh'))) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), body)
  }
}
