import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneDocument } from '@beegame/scene-editor';
import { beeGameAdapter, type BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import { SceneEditorOverlay } from './SceneEditorOverlay';
import { tileSprite, tileBatches } from '../../../../../packages/scene-editor/src/tilemap-preview';
import { parseGridData, parseTilemapData, type TilemapComponent } from '@beegame/scene-editor';
import { editorDocumentToSceneContent } from './sceneContentAdapter';
import * as sceneAdapter from './sceneContentAdapter';
import { Texture } from 'three';

const editorUploads = vi.hoisted(() => ({ current: undefined as undefined | ((files: File[]) => Promise<Record<string, import('@beegame/scene-editor').SceneAsset>>) }));

vi.mock('@beegame/scene-editor', async importOriginal => ({
  ...await importOriginal<typeof import('@beegame/scene-editor')>(),
  SceneEditor: ({ initialDocument, sceneChoices, onSelectScene, onUploadAssets }: { onUploadAssets?: typeof editorUploads.current; initialDocument: SceneDocument; sceneChoices?: {id: string; label: string}[]; onSelectScene?: (id: string) => void }) => { editorUploads.current = onUploadAssets; return (
    <div data-testid="loaded-scene">
      {initialDocument.name}
      {Object.values(initialDocument.assets).map(asset => <span key={asset.id}>{asset.name}{asset.spriteSheet ? ` frame ${('frames' in asset.spriteSheet ? Object.keys(asset.spriteSheet.frames).length : asset.spriteSheet.frameWidth)}` : ''}</span>)}
      <output data-testid="scene-data">{JSON.stringify(initialDocument)}</output>
      {sceneChoices?.map(choice => <button key={choice.id} onClick={() => onSelectScene?.(choice.id)}>{choice.label}</button>)}
    </div>
  ); },
}));

describe('SceneEditorOverlay loading experience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('converts only the opened scene and reuses it when switching back', async () => {
    const revision = 'a'.repeat(64);
    const documents = ['first', 'second'].map(id => ({path: `content/${id}.json`, revision, document: {
      schema: 'beegame-content.v1' as const, id, kind: 'scene-2d' as const, assetRefs: [], data: {nodes: [{id:'root',components:[]}]},
    }}));
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({state:'ready',index:{
      schema:'beegame-content-package.v2',id:'content',dimension:'2d',documentRevision:revision,assetManifestRevision:revision,entryScene:'first',sceneModel:'game-object-v2',files:documents.map(d=>d.path),
    },documents});
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({contract_state:'ready',version:9,requirements:[],resources:[]});
    const convert = vi.spyOn(sceneAdapter, 'sceneContentToEditorDocument');
    render(<SceneEditorOverlay projectId="lazy-scenes" onClose={vi.fn()} />);
    await screen.findByTestId('loaded-scene');
    expect(convert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'second',exact:true}));
    expect(JSON.parse(screen.getByTestId('scene-data').textContent!).id).toBe('second');
    expect(convert).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button',{name:'first',exact:true}));
    expect(JSON.parse(screen.getByTestId('scene-data').textContent!).id).toBe('first');
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it('opens the requested scene path instead of the entry scene', async () => {
    const revision = 'a'.repeat(64);
    const documents = ['entry', 'requested'].map(id => ({path: `content/scenes/${id}.json`, revision, document: {
      schema: 'beegame-content.v1' as const, id, kind: 'scene-2d' as const, assetRefs: [], data: {nodes: [{id: 'root', components: []}]},
    }}));
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({state: 'ready', index: {
      schema: 'beegame-content-package.v2', id: 'content', dimension: '2d', documentRevision: revision, assetManifestRevision: revision,
      entryScene: 'entry', sceneModel: 'game-object-v2', files: documents.map(document => document.path),
    }, documents});
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({contract_state: 'ready', version: 9, requirements: [], resources: []});

    render(<SceneEditorOverlay projectId="selected-scene" initialDocumentPath="content/scenes/requested.json" onClose={vi.fn()} />);

    await screen.findByTestId('loaded-scene');
    expect(JSON.parse(screen.getByTestId('scene-data').textContent!).id).toBe('requested');
  });

  it.each([
    ['content/scenes/missing.json', /Requested scene document .* was not found/],
    ['content/ui/menu.json', /Requested document .* is not a scene document/],
  ] as const)('reports an invalid requested path: %s', async (initialDocumentPath, detail) => {
    const revision = 'a'.repeat(64);
    const scene = {schema: 'beegame-content.v1' as const, id: 'entry', kind: 'scene-2d' as const, assetRefs: [], data: {nodes: [{id: 'root', components: []}]}};
    const ui = {...scene, id: 'menu', kind: 'ui-screen' as const};
    const documents = [
      {path: 'content/scenes/entry.json', revision, document: scene},
      {path: 'content/ui/menu.json', revision, document: ui},
    ];
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({state: 'ready', index: {
      schema: 'beegame-content-package.v2', id: 'content', dimension: '2d', documentRevision: revision, assetManifestRevision: revision,
      entryScene: 'entry', sceneModel: 'game-object-v2', files: documents.map(document => document.path),
    }, documents});
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({contract_state: 'ready', version: 9, requirements: [], resources: []});

    render(<SceneEditorOverlay projectId="selected-scene" initialDocumentPath={initialDocumentPath} onClose={vi.fn()} />);

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.queryByTestId('loaded-scene')).not.toBeInTheDocument();
  });

  function tilemapFixture(member = false, missing = '') {
    const revision = 'a'.repeat(64);
    const document: BeeGameSceneContentDocument = {schema:'beegame-content.v1', id:'generated-tile-scene',kind:'scene-2d',assetRefs:['TILES'],data:{nodes:[
      {id:'grid',components:[{id:'g',type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}]},
      {id:'map',parentId:'grid',components:[
        {id:'m',type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'grid',...(member?{member:'defs/tiles.json'}:{}),cells:[{x:0,y:0,tileId:'ground'},{x:1,y:0,tileId:'tree'}]}},
        {id:'r',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1',sortingOrder:1}},
      ]},
    ]}};
    const tiles={schema:'beegame-tileset.v1',tiles:{
      ground:{sprite:{assetRef:'ART',member:'images/terrain.png',atlasMember:'meta/frames.json',frame:'ground'},size:[32,32]},
      tree:{sprite:{assetRef:'TREE',member:'images/tree.png'},size:[32,64]},
    }};
    const metadata={frames:{ground:{frame:{x:32,y:0,w:32,h:32}}}};
    vi.spyOn(beeGameAdapter,'getProjectGameContent').mockResolvedValue({state:'ready',index:{
      schema:'beegame-content-package.v2',id:'content',dimension:'2d',documentRevision:revision,assetManifestRevision:revision,entryScene:document.id,sceneModel:'game-object-v2',files:['content/scene.json'],
    },documents:[{path:'content/scene.json',revision,document}]});
    vi.spyOn(beeGameAdapter,'getProjectAssets').mockResolvedValue({contract_state:'ready',version:9,requirements:[],resources:[
      {id:'TILES',root_path:member?'defs/readme.json':'defs/tiles.json',file_paths:member?['defs/readme.json','defs/tiles.json']:['defs/tiles.json']},
      {id:'ART',root_path:'images/terrain.png',file_paths:['images/terrain.png','meta/frames.json']},
      {id:'TREE',root_path:'images/tree.png',file_paths:['images/tree.png']},
    ].map(r=>({...r,status:'verified' as const,source:{type:'agent-authored' as const,created_at:'2026-09-21',reason:'test'},provisional:false,selected_at:'2026-09-21',selection_reason:[]}))});
    const load=vi.spyOn(beeGameAdapter,'loadProjectAssetFile').mockImplementation(async (_project,_id,path)=>{
      if(path===missing)throw new Error('404');
      const value=path==='defs/tiles.json'?tiles:path==='meta/frames.json'?metadata:{};
      return path.endsWith('.json')?new Blob([JSON.stringify(value)],{type:'application/json'}):new Blob(['image'],{type:'image/png'});
    });
    return {document,load,metadata};
  }

  it.each([false,true])('loads authored TileSet %s through manifest, exact images, atlas and save adapter',async member=>{
    const {document,load}=tilemapFixture(member);
    render(<SceneEditorOverlay projectId="tiles" onClose={vi.fn()}/>);
    const output=await screen.findByTestId('scene-data');
    const editor=JSON.parse(output.textContent!) as SceneDocument;
    const map=editor.nodes.map.components[0] as TilemapComponent, set=editor.assets[map.assetId].tileSet!;
    const ground=tileSprite(editor.assets,set.tiles.ground),tree=tileSprite(editor.assets,set.tiles.tree);
    expect(ground.frame).toEqual({x:32,y:0,width:32,height:32});
    expect(ground.image.bytes).toMatch(/^data:image\/png;base64,/);
    expect(tree.image.path).toBe('images/tree.png');
    expect(tree.frame).toBeUndefined();
    expect(load).toHaveBeenCalledWith('tiles','ART','meta/frames.json',expect.any(AbortSignal));
    const texture=new Texture();texture.image={width:64,height:64};
    const batches=tileBatches(parseGridData((editor.nodes.grid.components[0] as any).properties),parseTilemapData(map.properties),set.tiles,editor.assets,new Map([[ground.image.id,texture],[tree.image.id,texture]]),32);
    expect(batches).toHaveLength(2);
    expect(Array.from(batches[0].geometry.getAttribute('uv').array).slice(0,4)).toEqual([.5,1,.5,.5]);
    batches.forEach(b=>b.geometry.dispose());texture.dispose();
    expect(editorDocumentToSceneContent(editor,document).data.nodes[1].components).toEqual(document.data.nodes[1].components);
  });

  it.each(['images/terrain.png','meta/frames.json','images/tree.png'])('does not open an incomplete scene when transitive dependency %s fails',async path=>{
    tilemapFixture(false,path);
    render(<SceneEditorOverlay projectId="tiles" onClose={vi.fn()}/>);
    expect(await screen.findByText(new RegExp('resource file unavailable: .*'+path.replaceAll('.','\\.')))).toBeInTheDocument();
    expect(screen.queryByTestId('loaded-scene')).not.toBeInTheDocument();
  });

  it('reports missing named frames before mounting the editor',async()=>{
    const {metadata}=tilemapFixture();
    metadata.frames={other:metadata.frames.ground} as unknown as typeof metadata.frames;
    render(<SceneEditorOverlay projectId="tiles" onClose={vi.fn()}/>);
    expect(await screen.findByText(/atlas frame unavailable: ground/)).toBeInTheDocument();
  });

  it.each([['.json', 'a'], ['.atlas.json', 'b']])('attaches JSON-root atlases by exact sibling path (%s, root=%s), not a colliding basename',async (suffix, root)=>{
    const {document}=tilemapFixture();
    document.assetRefs=['ART'];
    document.data.nodes=[{id:'root',components:[{id:'sprite',type:'sprite-renderer',assetRef:'ART',data:{frame:'idle'}}]}];
    vi.spyOn(beeGameAdapter,'getProjectAssets').mockResolvedValue({contract_state:'ready',version:9,requirements:[],resources:[{
      id:'ART',status:'verified',root_path:`${root}/icon${suffix}`,file_paths:['a/icon.png',`a/icon${suffix}`,'b/icon.png',`b/icon${suffix}`],source:{type:'agent-authored'},
    }]});
    vi.spyOn(beeGameAdapter,'loadProjectAssetFile').mockImplementation(async(_project,_id,path)=>path.endsWith('.json')
      ?new Blob([JSON.stringify({frames:{idle:{frame:{x:0,y:0,w:path.startsWith('a/')?16:32,h:16}}}})],{type:'application/json'})
      :new Blob(['image'],{type:'image/png'}));
    render(<SceneEditorOverlay projectId="images" onClose={vi.fn()}/>);
    const editor=JSON.parse((await screen.findByTestId('scene-data')).textContent!) as SceneDocument;
    expect(editor.assets.ART.path).toBe(`${root}/icon.png`);
    expect(editor.assets.ART.spriteSheet).toEqual({frames:{idle:{x:0,y:0,width:root==='a'?16:32,height:16}}});
    expect(editor.assets['ART:b/icon.png'].spriteSheet).toEqual({frames:{idle:{x:0,y:0,width:32,height:16}}});
    expect(editor.nodes.root.components[0]).toMatchObject({assetId:'ART',frame:{x:0,y:0,width:root==='a'?16:32,height:16}});
  });

  it('keeps an asset failure visible when another prerequisite finishes later', async () => {
    let finishContent!: (value: any) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation((_id, requestSignal) => {
      signal = requestSignal;
      return new Promise(resolve => { finishContent = resolve; });
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockRejectedValue(new Error('Invalid asset manifest'));
    render(<SceneEditorOverlay projectId="failed-assets" onClose={vi.fn()} />);
    expect(await screen.findByText('Invalid asset manifest')).toBeInTheDocument();
    await act(async () => { finishContent({state:'ready',documents:[]}); });
    expect(screen.getByText('Could not open scene')).toBeInTheDocument();
    expect(screen.getByText('Invalid asset manifest')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
  });

  it('Escape cancels pending loads before the editor mounts', () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation((_id, signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation(() => new Promise(() => {}));
    const close = vi.fn();
    render(<SceneEditorOverlay projectId="cancel-loading" onClose={close} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(requestSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['scene-2d', 'scene-3d'] as const)('opens a valid %s with verified project resources', async kind => {
    const revision = 'a'.repeat(64);
    const document: BeeGameSceneContentDocument = {
      schema: 'beegame-content.v1', id: 'existing-scene', kind, assetRefs: ['RES-AUDIO'],
      data: { nodes: [
        { id: 'root', name: 'Scene Root', components: [] },
        { id: 'audio', parentId: 'root', components: [
          { id: 'audio-source', type: 'audio-source', assetRef: 'RES-AUDIO', data: { volume: 0 } },
        ] },
      ] },
    };
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      index: {
        schema: 'beegame-content-package.v2', id: 'content', dimension: kind === 'scene-2d' ? '2d' : '3d',
        documentRevision: revision, assetManifestRevision: revision, entryScene: document.id,
        sceneModel: 'game-object-v2', files: ['content/scene.json'],
      },
      documents: [{ path: 'content/scene.json', revision, document }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready', version: 9, requirements: [],
      resources: [
        { id: 'RES-AUDIO', root_path: 'forest.ogg', file_paths: ['forest.ogg'], status: 'verified' as const },
        { id: 'RES-EXTRA', root_path: 'extra.png', file_paths: ['extra.png', 'extra.json'], status: 'verified' as const },
        { id: 'RES-PENDING', root_path: 'pending.png', file_paths: ['pending.png'], status: 'available' as const },
      ].map(resource => ({
        ...resource, source: { type: 'agent-authored' as const, created_at: '2026-09-19', reason: 'test' },
        provisional: false, selected_at: '2026-09-19', selection_reason: [],
      })),
    });
    const loadAsset = vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockImplementation(async (_project, _resource, path) => path.endsWith('.json')
      ? new Blob([JSON.stringify({ frameWidth: 44, frameHeight: 44, states: ['normal', 'hover'] })], { type: 'application/json' })
      : new Blob(['image'], { type: 'image/png' }));
    render(<SceneEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    expect(await screen.findByTestId('loaded-scene')).toHaveTextContent('existing-scene');
    expect(screen.getByTestId('loaded-scene')).toHaveTextContent('forest.ogg');
    expect(screen.getByTestId('loaded-scene')).toHaveTextContent('extra.png frame 44');
    expect(loadAsset).toHaveBeenCalledWith('project-1', 'RES-EXTRA', 'extra.png', expect.any(AbortSignal));
    expect(loadAsset).not.toHaveBeenCalledWith('project-1', 'RES-PENDING', expect.anything(), expect.anything());
    expect(screen.queryByText('Could not open scene')).not.toBeInTheDocument();
  });

  it('loads authored scene font members instead of falling back to metadata only', async () => {
    const revision = 'a'.repeat(64);
    const document: BeeGameSceneContentDocument = {
      schema: 'beegame-content.v1', id: 'font-scene', kind: 'scene-2d', assetRefs: ['FONT-CN-01'], data: {
        nodes: [{ id: 'title', components: [{ id: 'title-text', type: 'text', data: { text: '你好', fontSize: 18, member: 'assets/runtime/fonts/lxgw.woff2' } }] }],
      },
    };
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', index: {
      schema: 'beegame-content-package.v2', id: 'content', dimension: '2d', documentRevision: revision, assetManifestRevision: revision,
      entryScene: document.id, sceneModel: 'game-object-v2', files: ['content/font-scene.json'],
    }, documents: [{ path: 'content/font-scene.json', revision, document }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 9, requirements: [], resources: [{
      id: 'FONT-CN-01', root_path: 'assets/runtime/fonts/lxgw.woff2', file_paths: ['assets/runtime/fonts/lxgw.woff2'], status: 'verified' as const,
      source: { type: 'agent-authored' as const, created_at: '2026-09-19', reason: 'test' }, provisional: false, selected_at: '2026-09-19', selection_reason: [],
    }] });
    const loadFont = vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockResolvedValue(new Blob(['font-bytes'], { type: 'font/woff2' }));

    render(<SceneEditorOverlay projectId="font-project" onClose={vi.fn()} />);

    const editor = JSON.parse((await screen.findByTestId('scene-data')).textContent!) as SceneDocument;
    expect(loadFont).toHaveBeenCalledWith('font-project', 'FONT-CN-01', 'assets/runtime/fonts/lxgw.woff2', expect.any(AbortSignal));
    expect(editor.assets['FONT-CN-01']?.bytes).toMatch(/^data:font\/woff2;base64,/);
    expect(editor.nodes.title.components.find(component => component.type === 'text')).toMatchObject({ fontAssetId: 'FONT-CN-01' });
  });

  it('shows no navigation chrome and closes after interrupting an in-flight load', () => {
    const signals: AbortSignal[] = [];
    const pending = (_projectId: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
    });
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation(pending);
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation(pending);
    const onClose = vi.fn();

    const { container } = render(<SceneEditorOverlay projectId="project-1" onClose={onClose} />);

    expect(container.querySelector('header')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Scene loading progress' })).toHaveAttribute('aria-valuenow', '8');
    expect(screen.queryByRole('button', { name: 'Back to project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Scene Editor' })).not.toBeInTheDocument();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('border', 'bg-transparent');
    fireEvent.click(cancel);

    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it('loads a grouped upload into the existing Scene resource catalog without reopening the document', async () => {
  const revision = 'a'.repeat(64);
  const doc = { schema: 'beegame-content.v1' as const, id: 'upload', kind: 'scene-2d' as const, assetRefs: [], data: { nodes: [{ id: 'root', components: [] }] } };
  vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({state:'ready', index: {
    schema:'beegame-content-package.v2', id:'content', dimension:'2d', documentRevision:revision, assetManifestRevision:revision,
    entryScene:'upload', sceneModel:'game-object-v2', files:['scenes/upload.json'],
  }, documents:[{path:'content/scenes/upload.json',revision,document:doc}]});
  vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({contract_state:'ready',version:9,requirements:[],resources:[]});
  const resource = {id:'NEW',status:'verified',root_path:'assets/icons.png',file_paths:['assets/icons.png','assets/icons.atlas.json'],source:{type:'user-provided'}} as const;
  const upload = vi.spyOn(beeGameAdapter,'uploadProjectAsset').mockResolvedValue({resource,manifest:{version:9,requirements:[],resources:[resource]}} as any);
  vi.spyOn(beeGameAdapter,'loadProjectAssetFile').mockImplementation(async (_project, _resource, path) => new Blob([path.endsWith('.json')
    ? JSON.stringify({frames:{play:{frame:{x:0,y:0,w:1,h:1}}}}) : 'offline image'],{type:path.endsWith('.json')?'application/json':'image/png'}));
  const convert = vi.spyOn(sceneAdapter,'sceneContentToEditorDocument');
  render(<SceneEditorOverlay projectId="upload-scene" onClose={vi.fn()}/>);
  await screen.findByTestId('loaded-scene');
  const before = screen.getByTestId('scene-data').textContent;
  const files = [new File(['image'],'icons.png'),new File(['json'],'icons.atlas.json')];
  let added!: Record<string, import('@beegame/scene-editor').SceneAsset>;
  await act(async () => { added = await editorUploads.current!(files); });
  expect(upload).toHaveBeenCalledWith('upload-scene',expect.stringMatching(/^user-/),files);
  expect(added.NEW).toMatchObject({mimeType:'image/png',spriteSheet:{frames:{play:{x:0,y:0,width:1,height:1}}}});
  expect(added.NEW.bytes).toMatch(/^data:image\/png/);
  expect(convert).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('scene-data').textContent).toBe(before);
});
