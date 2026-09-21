import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beeGameAdapter } from '../../services/beeGameAdapter';
import { UiEditorOverlay } from './UiEditorOverlay';

function selectEditorOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

const uiDocument = {
  schema: 'beegame-content.v1' as const,
  id: 'ui_title',
  kind: 'ui-screen' as const,
  assetRefs: ['RES-UI'],
  data: {
    rootId: 'root',
    nodes: [
      { id: 'root', role: 'screen-root', name: 'Title screen', layout: { position: [0, 0] as [number, number], size: [1280, 720] as [number, number] } },
      { id: 'logo', parentId: 'root', role: 'image', name: 'Logo', assetRef: 'RES-UI', layout: { position: [100, 100] as [number, number], size: [200, 80] as [number, number] }, data: { member: 'ui_logo' } },
      { id: 'panel', parentId: 'root', role: 'nineSlicePanel', name: 'Panel', assetRef: 'RES-UI', layout: { position: [300, 100] as [number, number], size: [240, 180] as [number, number] }, data: { member: 'other', border: { left: 12, right: 12, top: 12, bottom: 12 } } },
      { id: 'keycap', parentId: 'root', role: 'keycap', name: 'Key W', layout: { position: [100, 240] as [number, number], size: [44, 44] as [number, number] }, style: { fill: '#232A5C', border: '#B9C2E8' }, data: { label: { content: 'W', color: '#ffffff' } } },
      { id: 'shape', parentId: 'root', role: 'shape', name: 'Vision cone', layout: { position: [180, 240] as [number, number], size: [64, 72] as [number, number] }, data: { shape: 'cone', color: '#F2D04A' } },
      { id: 'layout', parentId: 'root', role: 'container', name: 'Settings layout', layout: { position: [300, 320] as [number, number], size: [300, 80] as [number, number] } },
      { id: 'volume', parentId: 'layout', role: 'slider', name: 'Master volume', layout: { position: [20, 10] as [number, number], size: [180, 16] as [number, number] }, data: { min: 0, max: 1, step: .05, default: .8, storageKey: 'volume.master' } },
      { id: 'motion', parentId: 'layout', role: 'toggle', name: 'Reduced motion', layout: { position: [220, 4] as [number, number], size: [70, 52] as [number, number] }, style: { boxColor: '#232A5C', checkColor: '#FFD89A' }, data: { label: { content: '减少动效' }, default: 'follow-prefers-reduced-motion', storageKey: 'ui.motion' } },
      { id: 'notice', parentId: 'root', role: 'toast', name: 'Pickup notice', text: 'Collected', layout: { position: [640, 500] as [number, number] }, data: { trigger: 'pickup', lifetimeSecs: 1.4, fontSize: 24 } },
      { id: 'sparks', parentId: 'root', role: 'emitter', name: 'Sparks', layout: { position: [800, 400] as [number, number], size: [180, 100] as [number, number] }, data: { count: 6, particleSize: 8, tint: '#FFD89A' } },
    ],
  },
};

describe('UiEditorOverlay', () => {
  it('defers unreferenced resources until the picker opens and loads them only once', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }] });
    const resource = (id: string, path: string) => ({ id, root_path: path, file_paths: [path], status: 'verified' as const,
      source: { type: 'agent-authored' as const, created_at: '2026-09-21', reason: 'test' }, provisional: false, selected_at: '2026-09-21', selection_reason: [] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [],
      resources: [resource('RES-UI', 'ui_logo.png'), resource('RES-EXTRA', 'extra.png')] });
    const load = vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    expect(load.mock.calls.map(call => call[1])).toEqual(['RES-UI']);
    fireEvent.click(within(hierarchy).getByText('Logo').closest('.ui-editor-tree-row')!);
    fireEvent.click(screen.getByRole('button', { name: 'Choose source image' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use image extra' })).toBeEnabled());
    expect(load.mock.calls.map(call => call[1])).toEqual(['RES-UI', 'RES-EXTRA']);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Select Source Image' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose source image' }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('uses authored resolution, parent anchors, text style and matching gizmo coordinates', async () => {
    const document = {
      ...uiDocument,
      data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root', data: { referenceResolution: [960, 540] } },
        { id: 'title', parentId: 'root', role: 'text', text: 'Title', layout: { anchor: 'top-center', position: [0, 92], size: [480, 56] }, style: { fontSize: 40, opacity: .55, align: 'left' } },
        { id: 'menu', parentId: 'root', role: 'container', layout: { anchor: 'middle-center', position: [0, 70], size: [264, 250] } },
        { id: 'button', parentId: 'menu', role: 'button', layout: { anchor: 'middle-center', position: [0, -84], size: [264, 52] } },
      ] },
    };
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: document as typeof uiDocument }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    await screen.findByLabelText('UI hierarchy');
    expect(container.querySelector('.ui-editor-stage')).toHaveStyle({ width: '960px', height: '540px' });
    expect(container.querySelector('[data-role="text"]')).toHaveStyle({ left: '480px', top: '92px', fontSize: '40px', opacity: '.55', textAlign: 'left', fontWeight: '400', letterSpacing: '0' });
    expect(container.querySelector('.ui-editor-text')).toHaveStyle({ justifyContent: 'flex-start' });
    expect(container.querySelector('[data-role="container"]')).toHaveStyle({ left: '480px', top: '340px', translate: '-50% -50%' });
    expect(container.querySelector('[data-role="button"]')).toHaveStyle({ left: '132px', top: '41px', translate: '-50% -50%' });
    fireEvent.click(within(screen.getByLabelText('UI hierarchy')).getByText('button', { exact: true, selector: '.ui-editor-node-name' }).closest('.ui-editor-tree-row')!);
    const matrix = (container.querySelector('.ui-editor-selection-gizmo') as HTMLElement).style.transform.slice(9, -1).split(',').map(Number);
    expect(matrix[12]).toBe(348);
    expect(matrix[13]).toBe(230);
  });

  it('transforms child gizmos and dragging through the rotated, scaled parent', async () => {
    const document = structuredClone(uiDocument);
    const parent = document.data.nodes.find(node => node.id === 'layout')!;
    parent.layout = { ...parent.layout, rotation: Math.PI / 2, scale: [2, 2] } as typeof parent.layout;
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    fireEvent.click(within(hierarchy).getByText('Master volume').closest('.ui-editor-tree-row')!);
    const matrix = (container.querySelector('.ui-editor-selection-gizmo') as HTMLElement).style.transform.slice(9, -1).split(',').map(Number);
    // Default top-left pivot: parent (300,320) + R90*S2*(20,10).
    expect(matrix[12]).toBeCloseTo(280);
    expect(matrix[13]).toBeCloseTo(360);
    expect((container.querySelector('.ui-editor-node[data-role="container"]') as HTMLElement).style.transformOrigin).toBe('0% 0%');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move selected UI element' }), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 116, clientY: 100 });
    fireEvent.pointerUp(window);
    expect(screen.getByRole('spinbutton', { name: 'Position X' })).toHaveValue(20);
    expect(screen.getByRole('spinbutton', { name: 'Position Y' })).toHaveValue(0);
    fireEvent.click(within(hierarchy).getByText('Settings layout').closest('.ui-editor-tree-row')!);
    fireEvent.click(screen.getByRole('switch', { name: 'Set active' }));
    expect(screen.queryByRole('button', { name: 'Select Master volume' })).not.toBeInTheDocument();
  });

  it('edits the actual canvas size and distinct Dropdown/Tab properties', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    await screen.findByLabelText('UI hierarchy');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Canvas width' }), { target: { value: '960' } });
    expect(container.querySelector('.ui-editor-stage')).toHaveStyle({ width: '960px' });
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add UI' }));
    expect(screen.getByRole('menuitem', { name: 'Image' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dropdown' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Dropdown options' }), { target: { value: 'Easy | Hard' } });
    selectEditorOption('Dropdown selection', 'Hard');
    expect(container.querySelector('.ui-editor-node[data-role="dropdown"]')).toHaveTextContent('Hard');
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add UI' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tab' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Tab selected' }));
    expect(container.querySelector('.ui-editor-node[data-role="tab"]')).toHaveAttribute('data-selected', 'true');
  });

  it('preserves newer edits during save and the current server revision after undo', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    let resolveSave!: (value: { path: string; revision: string; document: typeof uiDocument }) => void;
    const save = vi.spyOn(beeGameAdapter, 'saveProjectGameContentDocument').mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    fireEvent.click(within(hierarchy).getByText('Logo').closest('.ui-editor-tree-row')!);
    const x = screen.getByRole('spinbutton', { name: 'Position X' });
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '125' } });
    fireEvent.change(x, { target: { value: '150' } });
    fireEvent.blur(x);
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    const submitted = structuredClone(save.mock.calls[0][1].document) as typeof uiDocument;
    fireEvent.change(x, { target: { value: '225' } });
    await act(async () => resolveSave({ path: 'content/ui/title.json', revision: 'b'.repeat(64), document: submitted }));
    expect(x).toHaveValue(225);
    expect(screen.getByTestId('ui-save-status')).toHaveTextContent('unsaved');
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(x).toHaveValue(150);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(x).toHaveValue(100);
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(save.mock.calls[1][1].expectedRevision).toBe('b'.repeat(64));
    await act(async () => resolveSave({ path: 'content/ui/title.json', revision: 'c'.repeat(64), document: structuredClone(save.mock.calls[1][1].document) as typeof uiDocument }));
  });

  it('retains screen history and does not switch screens after an earlier save completes', async () => {
    const pause = structuredClone(uiDocument);
    pause.id = 'ui_pause'; pause.data.nodes[0].name = 'Pause screen';
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [
      { path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument },
      { path: 'content/ui/pause.json', revision: 'b'.repeat(64), document: pause },
    ] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    let resolveSave!: (value: { path: string; revision: string; document: typeof uiDocument }) => void;
    const save = vi.spyOn(beeGameAdapter, 'saveProjectGameContentDocument').mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    await screen.findByLabelText('UI hierarchy');
    fireEvent.change(screen.getByRole('textbox', { name: 'Object name' }), { target: { value: 'Edited title' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screens' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ui_pause' }));
    await act(async () => resolveSave({ path: 'content/ui/title.json', revision: 'c'.repeat(64), document: structuredClone(save.mock.calls[0][1].document) as typeof uiDocument }));
    expect(screen.getByRole('textbox', { name: 'Object name' })).toHaveValue('Pause screen');
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screens' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ui_title' }));
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByRole('textbox', { name: 'Object name' })).toHaveValue('Title screen');
  });

  it('closes a select with Escape without exiting and confirms unsaved exit', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });
    const close = vi.fn();
    render(<UiEditorOverlay projectId="project-1" onClose={close} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    fireEvent.click(within(hierarchy).getByText('Logo').closest('.ui-editor-tree-row')!);
    const space = screen.getByLabelText('UI render space');
    fireEvent.click(space);
    fireEvent.keyDown(screen.getByRole('option', { name: 'Screen Space' }), { key: 'Escape' });
    expect(space).toHaveAttribute('aria-expanded', 'false');
    expect(close).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Position X' }), { target: { value: '150' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports failed assets instead of silently opening an incomplete preview', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({ state: 'ready', documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }] });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [{ id: 'RES-UI', status: 'verified', root_path: 'missing.png', file_paths: ['missing.png'], source: { type: 'agent-authored' } }] });
    vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockRejectedValue(new Error('404'));
    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Failed to load 1 assets: RES-UI/missing.png: 404')).toBeInTheDocument();
    expect(screen.queryByLabelText('UI hierarchy')).not.toBeInTheDocument();
  });

  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows the shared loading experience and cancels an in-flight asset load', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    const signals: AbortSignal[] = [];
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation((_projectId, signal) => new Promise((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
    }));
    const onClose = vi.fn();

    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={onClose} />);

    expect(await screen.findByRole('progressbar', { name: 'UI loading progress' })).toBeInTheDocument();
    expect(container.querySelector('header')).not.toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('border', 'bg-transparent');
    fireEvent.click(cancel);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resolves an explicitly selected member from a multi-file resource', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready',
      version: 9,
      requirements: [],
      resources: [{
        id: 'RES-UI',
        status: 'verified',
        root_path: 'assets/runtime/ui/ui_logo.png',
        file_paths: ['assets/runtime/ui/ui_logo.png', 'assets/runtime/ui/other.png'],
        source: { type: 'agent-authored' },
      }],
    });
    vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockResolvedValue(new Blob(['image']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ui-logo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:ui-logo'));
    const logo = await screen.findByRole('treeitem', { name: 'Logo' });
    fireEvent.click(logo.querySelector('.ui-editor-tree-row')!);
    fireEvent.click(screen.getByRole('button', { name: 'Choose source image' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use image other' }));
    expect(screen.getByRole('button', { name: 'Choose source image' })).toHaveTextContent('other');
    selectEditorOption('Image type', 'Filled');
    expect(screen.getByLabelText('Fill method')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Fill amount' })).toBeInTheDocument();

    const panel = await screen.findByRole('treeitem', { name: 'Panel' });
    fireEvent.click(panel.querySelector('.ui-editor-tree-row')!);
    expect(screen.getByLabelText('Image type')).toHaveTextContent('Sliced');
    expect(screen.getByRole('spinbutton', { name: 'Slice left' })).toHaveValue(12);
    expect(container.querySelector('.ui-editor-node[data-role="nineSlicePanel"] .ui-editor-image.sliced')).toHaveStyle({ borderWidth: '12px 12px 12px 12px' });

    const keycap = await screen.findByRole('treeitem', { name: 'Key W' });
    fireEvent.click(keycap.querySelector('.ui-editor-tree-row')!);
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('W');
    fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), { target: { value: '↑' } });
    expect(container.querySelector('.ui-editor-node[data-role="keycap"]')).toHaveTextContent('↑');
    expect(container.querySelector('.ui-editor-node[data-role="shape"]')).toHaveStyle({ clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' });
  });

  it('supports Unity-style tools, zoom, rename, and duplication', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready',
      version: 1,
      requirements: [],
      resources: [],
    });

    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    const logoItem = await within(hierarchy).findByRole('treeitem', { name: 'Logo' });
    const logo = logoItem.querySelector('.ui-editor-tree-row')!;
    fireEvent.click(logo);

    expect(container.querySelector('header')).not.toBeInTheDocument();
    expect(screen.getByLabelText('UI navigation hints')).toBeInTheDocument();
    expect(screen.getByTestId('ui-save-status')).toHaveTextContent('saved');
    expect(screen.getByRole('tree', { name: 'UI hierarchy tree' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Object name' })).toHaveValue('Logo');
    expect(screen.queryByRole('combobox', { name: 'Font asset' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose source image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make Logo unselectable' })).toBeInTheDocument();
    expect(screen.getByLabelText('Color picker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move tool' })).toHaveClass('active');
    const positionX = screen.getByRole('spinbutton', { name: 'Position X' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move selected UI element' }), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 132, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 164, clientY: 100 });
    fireEvent.pointerUp(window);
    expect(positionX).toHaveValue(180);
    expect(screen.getByTestId('ui-save-status')).toHaveTextContent('unsaved');
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByRole('spinbutton', { name: 'Position X' })).toHaveValue(100);
    expect(screen.getByTestId('ui-save-status')).toHaveTextContent('saved');
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByRole('spinbutton', { name: 'Position X' })).toHaveValue(180);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByRole('spinbutton', { name: 'Position X' })).toHaveValue(100);
    const activeToggle = screen.getByRole('switch', { name: 'Set active' });
    fireEvent.click(activeToggle);
    expect(activeToggle).not.toBeChecked();
    expect(container.querySelector('.ui-editor-node[data-role="image"]')).not.toBeInTheDocument();
    fireEvent.click(activeToggle);
    expect(activeToggle).toBeChecked();
    expect(container.querySelector('.ui-editor-node[data-role="image"]')).toBeInTheDocument();
    const scaleX = screen.getByRole('spinbutton', { name: 'Scale X' });
    fireEvent.change(scaleX, { target: { value: '2' } });
    expect(screen.getByRole('spinbutton', { name: 'Scale Y' })).toHaveValue(1);
    expect(screen.queryByRole('button', { name: /proportional scale/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scale tool' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Scale selected UI element' }), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 132, clientY: 164 });
    fireEvent.pointerUp(window);
    expect(screen.getByRole('spinbutton', { name: 'Scale X' })).toHaveValue(2.25);
    expect(screen.getByRole('spinbutton', { name: 'Scale Y' })).toHaveValue(1.5);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Scale selected UI element' }), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 132, clientY: 164, shiftKey: true });
    fireEvent.pointerUp(window);
    expect(screen.getByRole('spinbutton', { name: 'Scale X' })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: 'Scale Y' })).toHaveValue(1.5);
    fireEvent.keyDown(window, { key: 'q' });
    expect(screen.getByRole('button', { name: 'Select tool' })).toHaveClass('active');
    fireEvent.keyDown(window, { key: 'w' });
    expect(screen.getByRole('button', { name: 'Move tool' })).toHaveClass('active');
    expect(screen.getByRole('radiogroup', { name: 'Anchor preset' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'middle-center' }));
    expect(screen.getByRole('radio', { name: 'middle-center' })).toHaveAttribute('aria-checked', 'true');
    selectEditorOption('UI render space', 'World Space (XR)');
    expect(screen.getByRole('spinbutton', { name: 'Position Z' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Rotation Y' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
    expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(container.querySelector('.ui-editor-stage')).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.9)' });

    const viewport = container.querySelector('.ui-editor-stage-wrap')!;
    fireEvent.wheel(viewport, { deltaY: 20 });
    expect(container.querySelector('.ui-editor-stage')).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.86)' });
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -10 });
    expect(container.querySelector('.ui-editor-stage')).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.95)' });

    fireEvent.doubleClick(logo);
    const rename = screen.getByRole('textbox', { name: 'Rename UI element' });
    fireEvent.change(rename, { target: { value: 'Brand mark' } });
    fireEvent.keyDown(rename, { key: 'Enter' });
    expect(screen.getByText('Brand mark')).toBeInTheDocument();

    const renamedRow = within(screen.getByLabelText('UI hierarchy')).getByText('Brand mark').closest('.ui-editor-tree-row')!;
    fireEvent.contextMenu(renamedRow, { clientX: 80, clientY: 120 });
    fireEvent.click(within(screen.getByRole('menu', { name: 'Hierarchy context menu' })).getByRole('menuitem', { name: 'Duplicate' }));
    expect(screen.getByText('Brand mark Copy')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add UI' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Button' }));
    expect(within(screen.getByLabelText('UI hierarchy')).getByText('Button')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' }));
    expect(within(screen.getByLabelText('UI hierarchy')).queryByText('Button')).not.toBeInTheDocument();

    const renamed = within(screen.getByLabelText('UI hierarchy')).getByText('Brand mark').closest('.ui-editor-tree-row')!;
    fireEvent.contextMenu(renamed, { clientX: 80, clientY: 120 });
    const contextMenu = screen.getByRole('menu', { name: 'Hierarchy context menu' });
    expect(contextMenu).toBeInTheDocument();
    expect(within(contextMenu).getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
  });

  it('maps semantic roles to Unity-style objects, components, and behaviors', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({ contract_state: 'ready', version: 1, requirements: [], resources: [] });

    const { container } = render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');

    fireEvent.click(within(hierarchy).getByText('Master volume').closest('.ui-editor-tree-row')!);
    expect(screen.getByText('Slider Object')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Slider value' })).toHaveValue(.8);
    expect(container.querySelector('.ui-editor-slider-fill')).toHaveStyle({ width: '80%' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Slider value' }), { target: { value: '.25' } });
    expect(container.querySelector('.ui-editor-slider-fill')).toHaveStyle({ width: '25%' });

    fireEvent.click(within(hierarchy).getByText('Reduced motion').closest('.ui-editor-tree-row')!);
    expect(screen.getByText('Toggle Object')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle initial value')).toHaveTextContent('Follow System');
    expect(container.querySelector('.ui-editor-toggle-preview')).toHaveClass('mixed');
    selectEditorOption('Toggle initial value', 'On');
    expect(container.querySelector('.ui-editor-toggle-preview')).toHaveClass('checked');

    fireEvent.click(within(hierarchy).getByText('Settings layout').closest('.ui-editor-tree-row')!);
    expect(screen.getByText('Layout Object')).toBeInTheDocument();
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument();

    fireEvent.click(within(hierarchy).getByText('Pickup notice').closest('.ui-editor-tree-row')!);
    expect(screen.getByText('Toast Object')).toBeInTheDocument();
    expect(screen.getByText('Toast Behavior')).toBeInTheDocument();

    fireEvent.click(within(hierarchy).getByText('Sparks').closest('.ui-editor-tree-row')!);
    expect(screen.getByText('Particle Object')).toBeInTheDocument();
    expect(screen.getByText('Particle System')).toBeInTheDocument();
    expect(container.querySelectorAll('.ui-editor-particle-preview i')).toHaveLength(6);
  });

  it('dismisses custom menus when focus leaves their focus scope', async () => {
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready',
      version: 1,
      requirements: [],
      resources: [],
    });

    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    const editorMenu = screen.getByRole('button', { name: 'Editor menu' });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });

    fireEvent.click(editorMenu);
    const addUi = screen.getByRole('menuitem', { name: 'Add UI' });
    fireEvent.click(addUi);
    expect(screen.getByRole('menu', { name: 'Add UI objects' })).toBeInTheDocument();
    fireEvent.pointerDown(zoomIn);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Add UI objects' })).not.toBeInTheDocument());

    fireEvent.click(editorMenu);
    expect(screen.queryByRole('menu', { name: 'Add UI components' })).not.toBeInTheDocument();
    fireEvent.pointerDown(zoomIn);

    const logoRow = within(hierarchy).getByRole('treeitem', { name: 'Logo' }).querySelector('.ui-editor-tree-row')!;
    fireEvent.click(logoRow);
    const sourceImage = screen.getByRole('button', { name: 'Choose source image' });
    fireEvent.click(sourceImage);
    const picker = await screen.findByRole('dialog', { name: 'Select Source Image' });
    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Select Source Image' })).not.toBeInTheDocument());

    fireEvent.contextMenu(logoRow, { clientX: 80, clientY: 120 });
    const rename = await screen.findByRole('menuitem', { name: 'Rename' });
    act(() => { rename.focus(); zoomIn.focus(); });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Hierarchy context menu' })).not.toBeInTheDocument());
  });

  it('keeps multiple UI screens inside the editor menu', async () => {
    const pauseDocument = structuredClone(uiDocument);
    pauseDocument.id = 'ui_pause';
    pauseDocument.data.nodes[0].name = 'Pause screen';
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [
        { path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument },
        { path: 'content/ui/pause.json', revision: 'b'.repeat(64), document: pauseDocument },
      ],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready',
      version: 1,
      requirements: [],
      resources: [],
    });

    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    await screen.findByLabelText('UI hierarchy');
    expect(screen.queryByRole('combobox', { name: 'UI document' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screens' }));
    const screens = screen.getByRole('menu', { name: 'UI screens' });
    expect(within(screens).getAllByRole('menuitem')).toHaveLength(2);
    fireEvent.click(within(screens).getByRole('menuitem', { name: 'ui_pause' }));
    expect(screen.getByTestId('ui-save-status').parentElement).toHaveTextContent('ui_pause');
  });

  it('uses macOS shortcut labels and Return for rename on Apple platforms', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'content/ui/title.json', revision: 'a'.repeat(64), document: uiDocument }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready',
      version: 1,
      requirements: [],
      resources: [],
    });

    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    const hierarchy = await screen.findByLabelText('UI hierarchy');
    const logoRow = within(hierarchy).getByRole('treeitem', { name: 'Logo' }).querySelector('.ui-editor-tree-row')!;

    fireEvent.click(screen.getByRole('button', { name: 'Editor menu' }));
    expect(screen.getByText('⌘S')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toHaveTextContent('⇧⌘Z');
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(logoRow);
    fireEvent.keyDown(logoRow, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Rename UI element' })).toBeInTheDocument();
    expect(screen.getByLabelText('UI navigation hints')).toHaveTextContent('Pinch · Zoom');
  });
});
