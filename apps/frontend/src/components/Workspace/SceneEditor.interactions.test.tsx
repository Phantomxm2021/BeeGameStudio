import { fireEvent, render as renderView, screen, waitFor, within, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneEditor } from '../../../../../packages/scene-editor/src/editor';
import { makeFixture, type SceneDocument } from '../../../../../packages/scene-editor/src/model';
import { readFileSync } from 'node:fs';
const editorCss = readFileSync('../../packages/scene-editor/src/styles.css', 'utf8');

vi.mock('../../../../../packages/scene-editor/src/viewport', () => ({
  SceneViewport: ({ onDiagnostic }: { onDiagnostic: (message: string) => void }) => <button onClick={() => onDiagnostic('Local texture asset could not be decoded')}>Simulate texture error</button>,
  AssetModelPreview: () => <div>Model preview</div>,
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
// The production editor lives inside the host's Scene Editor dialog.
function render(element: ReactElement) { return renderView(<div className="scene-editor-host" role="dialog" aria-label="Scene Editor">{element}</div>); }
function openActions() { fireEvent.click(screen.getByRole('button', { name: 'Scene actions' })); }
async function command(name: string) {
  openActions();
  fireEvent.click(await screen.findByRole('menuitem', { name, exact: true }));
}
function select(name: string) { fireEvent.click(screen.getByText(name, { selector: '.node-name' })); }
describe('Scene Editor interaction regressions', () => {
  it('keeps portalled menu surfaces visible without host Tailwind utilities', async () => {
    render(<><style>{editorCss}</style><SceneEditor initialDocument={makeFixture()} /></>);
    const assertSurface = (element: Element) => {
      // jsdom does not resolve inherited var() colors; check the real matching
      // CSS declarations here and verify resolved colors in the browser fixture.
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
        .filter((rule): rule is CSSStyleRule => 'selectorText' in rule && element.matches((rule as CSSStyleRule).selectorText));
      expect(rules.some(rule => rule.style.getPropertyValue('background') === 'var(--editor-surface)')).toBe(true);
      expect(rules.some(rule => rule.style.getPropertyValue('border') === '1px solid var(--editor-border)')).toBe(true);
    };
    openActions();
    const menu = await screen.findByRole('menu', { name: 'Scene actions' });
    assertSurface(menu.closest('.scene-menu-surface')!);
    expect(getComputedStyle(menu.closest('[data-morph-popover-portal]')!).position).toBe('fixed');
    fireEvent.pointerEnter(within(menu).getByRole('menuitem', { name: 'Add light' }));
    assertSurface(await screen.findByRole('menu', { name: 'Add light' }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide gizmos' }));
    fireEvent.click(screen.getByRole('button', { name: 'View mode', exact: true }));
    assertSurface(await screen.findByRole('listbox', { name: 'View mode' }));
    fireEvent.click(screen.getByRole('option', { name: '2D', exact: true }));
    fireEvent.contextMenu(screen.getByText('Flower', { selector: '.node-name' }), { clientX: 80, clientY: 120 });
    const context = await screen.findByRole('menu', { name: 'Hierarchy actions' });
    assertSurface(context);
    expect(getComputedStyle(context.closest('[data-context-menu-portal]')!).position).toBe('fixed');
  });
  it('selects portalled view mode and coordinate space without refocusing the viewport', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    for (const [name, next] of [['View mode', '2D'], ['View mode', '3D'], ['Coordinate space', 'World'], ['Coordinate space', 'Local']]) {
      const trigger = screen.getByRole('button', { name, exact: true });
      fireEvent.click(trigger);
      const list = await screen.findByRole('listbox', { name });
      expect(screen.getByTestId('scene-editor').contains(list)).toBe(false);
      const option = within(list).getByRole('option', { name: next, exact: true });
      option.focus();
      fireEvent.pointerDown(option);
      expect(document.activeElement).toBe(option);
      fireEvent.click(option);
      await waitFor(() => expect(trigger).toHaveTextContent(next));
    }
  });
  it('opens Add light on hover and adds only the selected child', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    openActions();
    const trigger = await screen.findByRole('menuitem', { name: 'Add light' });
    fireEvent.pointerEnter(trigger);
    const submenu = await screen.findByRole('menu', { name: 'Add light' });
    expect(screen.getByRole('menu', { name: 'Scene actions' })).toBeInTheDocument();
    const point = within(submenu).getByRole('menuitem', { name: /Point/i });
    fireEvent.pointerDown(point); point.focus(); fireEvent.click(point);
    expect(screen.getAllByRole('treeitem').some(item => item.textContent?.includes('Point'))).toBe(true);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Scene actions' })).toBeNull());
  });

  it('handles Inspector undo inside the host dialog without intercepting settings drafts', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    select('Flower');
    const x = screen.getByRole('spinbutton', { name: 'Position X' });
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '3' } });
    fireEvent.blur(x);
    fireEvent.keyDown(x, { key: 'z', metaKey: true });
    await waitFor(() => expect(x).toHaveValue(1.4));
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Flower' }), { key: 'z', metaKey: true, shiftKey: true });
    expect(x).toHaveValue(3);
    await command('Scene settings');
    const name = screen.getByRole('textbox', { name: 'Scene name' });
    fireEvent.keyDown(name, { key: 'z', metaKey: true });
    expect(x).toHaveValue(3);
  });
  it('reopens Scene settings from committed values, not a discarded draft', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    await command('Scene settings');
    fireEvent.change(screen.getByRole('textbox', { name: 'Scene name' }), { target: { value: 'Discarded title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await command('Scene settings');
    expect(screen.getByRole('textbox', { name: 'Scene name' })).toHaveValue('Bee Meadow');
  });
  it('does not route menu Delete to the selected scene object', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    select('Flower');
    openActions();
    const menu = await screen.findByRole('menu', { name: 'Scene actions' });
    fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Save scene' }), { key: 'Delete' });
    expect(screen.getByText('Flower', { selector: '.node-name' })).toBeInTheDocument();
  });
  it('portals Select outside the scrolling inspector and keeps selection on arrow keys', async () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    select('Flower');
    fireEvent.click(screen.getByRole('button', { name: 'Parent', exact: true }));
    const list = await screen.findByRole('listbox', { name: 'Parent' });
    expect(list.closest('.inspector-scroll')).toBeNull();
    const option = within(list).getByRole('option', { name: 'Scene Root' });
    option.focus();
    fireEvent.keyDown(option, { key: 'ArrowDown' });
    expect(screen.getByRole('treeitem', { name: 'Flower' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(option, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Parent' })).toBeNull());
  });
  it('shows texture diagnostics instead of filtering them by wording', () => {
    render(<SceneEditor initialDocument={makeFixture()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate texture error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Local texture asset could not be decoded');
  });
  it('offers discard without saving when exiting a dirty scene', async () => {
    const onClose = vi.fn(), onSave = vi.fn();
    render(<SceneEditor initialDocument={makeFixture()} onClose={onClose} onSave={onSave} />);
    select('Flower');
    const x = screen.getByRole('spinbutton', { name: 'Position X' });
    fireEvent.focus(x); fireEvent.change(x, { target: { value: '3' } }); fireEvent.blur(x);
    await command('Close editor');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('keeps zero audio volume and shows Mesh Collider Trigger', () => {
    const doc = makeFixture();
    doc.nodes.flower.components = [
      { id: 'audio', type: 'audio-source', enabled: true, properties: { volume: 0 } },
      { id: 'mesh', type: 'mesh-collider', enabled: true, isTrigger: false, properties: {} },
    ];
    render(<SceneEditor initialDocument={doc} />);
    select('Flower');
    expect(screen.getByRole('spinbutton', { name: 'Volume' })).toHaveValue(0);
    expect(screen.getByRole('switch', { name: 'Mesh Collider trigger' })).toBeInTheDocument();
  });
  it('undoes one opacity drag in one step', async () => {
    const doc = makeFixture();
    doc.nodes.flower.components = [{ id: 'image', type: 'image', enabled: true, material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' }, properties: {} }];
    doc.nodes.flower.components.push({ id: 'rect', type: 'rect-transform', enabled: true, anchorMin: [0, 0], anchorMax: [0, 0], pivot: [.5, .5], anchoredPosition: [0, 0], sizeDelta: [1, 1], properties: {} });
    const save = vi.fn<(doc: SceneDocument) => Promise<void>>().mockResolvedValue();
    render(<SceneEditor initialDocument={doc} onSave={save} />);
    select('Flower');
    const slider = screen.getByRole('slider', { name: 'Renderer opacity' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft', repeat: true });
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '0.98');
    await command('Undo');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    await command('Redo');
    expect(slider).toHaveAttribute('aria-valuenow', '0.98');
  });
});
