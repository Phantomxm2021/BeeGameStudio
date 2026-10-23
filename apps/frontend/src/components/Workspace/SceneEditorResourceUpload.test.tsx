import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SceneEditor } from '../../../../../packages/scene-editor/src/editor';
import { makeEmptyScene } from '../../../../../packages/scene-editor/src/persistence';

vi.mock('../../../../../packages/scene-editor/src/viewport', () => ({ SceneViewport: () => <div data-testid="offline-viewport" /> }));
afterEach(() => vi.restoreAllMocks());

it('imports and selects an image through the Scene picker while preserving unsaved edits and saving clean selectors', async () => {
  const doc = makeEmptyScene('upload-scene');
  doc.dimension = '2d';
  doc.assets.OLD = { id: 'OLD', name: 'old.png', mimeType: 'image/png', path: 'old.png', bytes: 'data:image/png;base64,AA==' };
  doc.rootIds = ['player'];
  doc.nodes = { player: { id: 'player', name: 'Player', parentId: null, children: [], active: true, locked: false,
    tags: [], transform: { position: [1,2,0], rotation: [0,0,0], scale: [1,1,1] }, components: [{
      id: 'sprite', type: 'sprite-renderer', enabled: true, assetId: 'OLD',
      material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: .7, alphaMode: 'opaque' },
      properties: { atlasMember: 'old.json', frame: 'old', frameSize: [10,10], marker: 'keep' },
    }] } };
  const upload = vi.fn().mockResolvedValue({ NEW: { id: 'NEW', name: 'new.png', mimeType: 'image/png', path: 'new.png', bytes: 'data:image/png;base64,AA==' } });
  const save = vi.fn().mockResolvedValue(undefined);
  const { container } = render(<SceneEditor initialDocument={doc} onUploadAssets={upload} onSave={save} />);
  fireEvent.click(screen.getByText('Player'));
  const name = container.querySelector<HTMLInputElement>('input.name-input')!;
  fireEvent.change(name, {target:{value:'Edited player'}}); fireEvent.blur(name);
  fireEvent.click(screen.getByRole('button',{name:'Choose sprite'}));
  const picker = screen.getByRole('dialog',{name:'Select Sprite'});
  const file = new File(['offline'],'new.png',{type:'image/png'});
  fireEvent.change(within(picker).getByLabelText('Upload assets'),{target:{files:[file]}});
  fireEvent.click(await within(picker).findByRole('button',{name:'Use image new.png'}));
  expect(upload).toHaveBeenCalledWith([file]);
  fireEvent.keyDown(container.firstElementChild!,{key:'s',metaKey:true});
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  const node = save.mock.calls[0][0].nodes.player;
  expect(node).toMatchObject({name:'Edited player',transform:{position:[1,2,0]}});
  expect(node.components[0]).toMatchObject({assetId:'NEW',properties:{marker:'keep'},material:{opacity:.7}});
  expect(node.components[0].properties).not.toHaveProperty('atlasMember');
  expect(node.components[0].properties).not.toHaveProperty('frameSize');
});
