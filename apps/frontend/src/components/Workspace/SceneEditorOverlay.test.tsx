import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneDocument } from '@beegame/scene-editor';
import { beeGameAdapter, type BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import { SceneEditorOverlay } from './SceneEditorOverlay';
import { tileSprite, tileBatches } from '../../../../../packages/scene-editor/src/tilemap-preview';
import { parseGridData, parseTilemapData, type TilemapComponent } from '@beegame/scene-editor';
import { editorDocumentToSceneContent } from './sceneContentAdapter';
import { Texture } from 'three';

vi.mock('@beegame/scene-editor', async importOriginal => ({
  ...await importOriginal<typeof import('@beegame/scene-editor')>(),
  SceneEditor: ({ initialDocument }: { initialDocument: SceneDocument }) => (
    <div data-testid="loaded-scene">
      {initialDocument.name}
      {Object.values(initialDocument.assets).map(asset => <span key={asset.id}>{asset.name}{asset.spriteSheet ? ` frame ${('frames' in asset.spriteSheet ? Object.keys(asset.spriteSheet.frames).length : asset.spriteSheet.frameWidth)}` : ''}</span>)}
      <output data-testid="scene-data">{JSON.stringify(initialDocument)}</output>
    </div>
  ),
}));

describe('SceneEditorOverlay loading experience', () => {
  afterEach(() => vi.restoreAllMocks());

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

  it('attaches each atlas by exact sibling path, not a colliding basename',async()=>{
    const {document}=tilemapFixture();
    document.assetRefs=['ART'];
    document.data.nodes=[{id:'root',components:[]}];
    vi.spyOn(beeGameAdapter,'getProjectAssets').mockResolvedValue({contract_state:'ready',version:9,requirements:[],resources:[{
      id:'ART',status:'verified',root_path:'a/icon.png',file_paths:['a/icon.png','a/icon.json','b/icon.png','b/icon.json'],source:{type:'agent-authored'},
    }]});
    vi.spyOn(beeGameAdapter,'loadProjectAssetFile').mockImplementation(async(_project,_id,path)=>path.endsWith('.json')
      ?new Blob([JSON.stringify({frames:{idle:{frame:{x:0,y:0,w:path.startsWith('a/')?16:32,h:16}}}})],{type:'application/json'})
      :new Blob(['image'],{type:'image/png'}));
    render(<SceneEditorOverlay projectId="images" onClose={vi.fn()}/>);
    const editor=JSON.parse((await screen.findByTestId('scene-data')).textContent!) as SceneDocument;
    expect(editor.assets.ART.spriteSheet).toEqual({frames:{idle:{x:0,y:0,width:16,height:16}}});
    expect(editor.assets['ART:b/icon.png'].spriteSheet).toEqual({frames:{idle:{x:0,y:0,width:32,height:16}}});
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
