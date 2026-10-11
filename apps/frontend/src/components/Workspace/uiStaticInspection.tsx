import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { resolveUiNodesForViewport } from '../../../../../packages/scene-editor/src/ui-responsive';
import { createUiTextMeasurer } from '../../../../../packages/scene-editor/src/ui-text-measurement';
import { initializeUiLayout } from '../../../../../packages/scene-editor/src/ui-container-layout';
import { parseSpriteSheet } from '../../../../../packages/scene-editor/src/sprite-sheet';
import { renderUiNode, uiPaintChildren, uiNodeKind, resolveNodeImage, uiNodeImageSource } from './UiContentRenderer';
import { UI_FONT, UI_IMAGE, loadUiFont, loadUiImage, type UiResource } from './uiResourceLoading';
import { uiFontKey } from '../../../../../packages/scene-editor/src/ui-font-reference';
import type { BeeGameUiContentNode } from '../../services/beeGameAdapter';

type Resource = UiResource & { status: string };
export async function loadInspectionResources(resources: Resource[]) {
  await initializeUiLayout();
  const images: Record<string, string> = {}, fonts: Record<string, string> = {}, faces: Record<string, FontFace> = {};
  const objectUrls: string[] = [], diagnostics: Array<{ resource: string; path?: string; status: 'failed' | 'unverified'; reason: string }> = [];
  const checked: Array<{ resource: string; path: string; kind: string }> = [];
  const signal = new AbortController().signal;
  const read = async (path: string) => {
    const response = await fetch('http://bgs-design.invalid/' + path.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Resource unavailable (HTTP ' + response.status + ')');
    return response.blob();
  };
  for (const resource of resources) {
    if (resource.file_paths.some(path => UI_FONT.test(path)) && !UI_FONT.test(resource.root_path))
      diagnostics.push({ resource: resource.id, status: 'unverified', reason: 'Font root_path is not a font file; no default face is selected' });
    if (resource.status !== 'verified') diagnostics.push({ resource: resource.id, status: 'unverified', reason: 'Manifest does not declare this resource verified; decoding cannot change its status' });
    for (const path of resource.file_paths) {
      try {
        if (UI_IMAGE.test(path)) {
          Object.assign(images, Object.fromEntries(await loadUiImage(resource, path, read, signal, objectUrls)));
          checked.push({ resource: resource.id, path, kind: 'image/atlas' });
        } else if (UI_FONT.test(path)) {
          const font = await loadUiFont(resource, read, path);
          if (!font) throw Error('Font unavailable');
          document.fonts.add(font.face);
          for (const key of font.keys) { fonts[key] = font.family; faces[key] = font.face; }
          checked.push({ resource: resource.id, path, kind: 'font' });
        } else if (/\.(wav|mp3|ogg|opus|aac|flac|m4a)$/i.test(path)) {
          const audio = new AudioContext();
          try { await audio.decodeAudioData(await (await read(path)).arrayBuffer()); }
          finally { await audio.close(); }
          checked.push({ resource: resource.id, path, kind: 'audio' });
        } else if (/\.json$/i.test(path)) {
          const value = JSON.parse(await (await read(path)).text());
          const pairedImage = resource.file_paths.some(file => UI_IMAGE.test(file) && file.replace(/\.[^.]+$/, '.json') === path);
          if (pairedImage && parseSpriteSheet(value)) checked.push({ resource: resource.id, path, kind: 'atlas-metadata' });
          else diagnostics.push({ resource: resource.id, path, status: 'unverified', reason: 'JSON parsed; non-atlas semantics require the corresponding content/runtime checker' });
        } else {
          await read(path);
          diagnostics.push({ resource: resource.id, path, status: 'unverified', reason: 'No browser decoder for this resource type' });
        }
      } catch (error) { diagnostics.push({ resource: resource.id, path, status: 'failed', reason: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { images, fonts, faces, checked, diagnostics,
    dispose() { objectUrls.forEach(url => URL.revokeObjectURL(url)); new Set(Object.values(faces)).forEach(face => document.fonts.delete(face)); } };
}

let disposeRendering: (() => void) | undefined;
export function clearInspectionUi() {
  disposeRendering?.();
  disposeRendering = undefined;
}

export function renderInspectionUi(data: { rootId: string; nodes: BeeGameUiContentNode[] }, viewport: { width: number; height: number },
  resources: Awaited<ReturnType<typeof loadInspectionResources>>, candidateFont = 'sans-serif') {
  clearInspectionUi();
  const canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) throw Error('Canvas is unavailable');
  const fontFamily = (node: { data?: Record<string, unknown> }) => {
    const id = uiFontKey(node.data?.font);
    return id && resources.fonts[id] ? `"${resources.fonts[id]}"` : candidateFont;
  };
  const nodes = resolveUiNodesForViewport(data.nodes, data.rootId, viewport, { measureText: createUiTextMeasurer(canvas, fontFamily) });
  const container = document.createElement('div');
  container.style.cssText = `position:relative;width:${viewport.width}px;height:${viewport.height}px;font-family:${candidateFont};color:#f4f4f5;-webkit-font-smoothing:antialiased`;
  document.body.style.margin = '0'; document.body.append(container);
  const root = createRoot(container);
  disposeRendering = () => { flushSync(() => root.unmount()); container.remove(); };
  flushSync(() => root.render(renderUiNode(data.rootId, nodes, uiPaintChildren(nodes, data.rootId), resources.images, resources.fonts, '', () => {}, new Set(), new Set(), true)));
  const rendered = [...container.querySelectorAll('[data-node-id]')].map(element => element.getAttribute('data-node-id')!);
  const unverified: Array<{ nodeId: string; reason: string }> = [];
  const rootData = data.nodes.find(node => node.id === data.rootId)?.data;
  const cameraLinks = rootData?.layoutCamera ? Array.isArray(rootData.layoutCamera) ? rootData.layoutCamera : [rootData.layoutCamera] : [];
  const worldNodes = new Set(cameraLinks.map(link => (link as { nodeId?: string }).nodeId));
  if (rootData?.layoutUnderlay) unverified.push({ nodeId: data.rootId, reason: 'The retained underlay is not composited in this single-document static view; inspect combined layers in the runtime' });
  for (const node of nodes.filter(node => rendered.includes(node.id))) {
    const kind = uiNodeKind(node.role), image = uiNodeImageSource(node);
    if (worldNodes.has(node.id)) unverified.push({ nodeId: node.id, reason: 'UI allocation only; the linked game world is not rendered by the static UI renderer' });
    if (image.assetRef && !resolveNodeImage(node, resources.images)) unverified.push({ nodeId: node.id, reason: 'Image/member/frame is not resolved' });
    if (kind === 'other' || kind === 'flow' || kind === 'flow-screen' || kind === 'particle-system' || node.data?.space === 'world')
      unverified.push({ nodeId: node.id, reason: 'World/flow/dynamic/unsupported role is not certified by this static renderer' });
    if (kind === 'dropdown') unverified.push({ nodeId: node.id, reason: 'Only the saved collapsed state is rendered; expanded geometry requires a saved state source or runtime check' });
    const font = uiFontKey(node.data?.font);
    if (node.text && !font) unverified.push({ nodeId: node.id, reason: 'Candidate font only; no delivered font binding' });
    if (font && !resources.faces[font]) unverified.push({ nodeId: node.id, reason: 'Registered font did not load' });
  }
  return { rendered, inactive: nodes.filter(node => !rendered.includes(node.id)).map(node => node.id), unverified };
}
