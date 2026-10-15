import React from 'react';
import { ChevronRight } from 'lucide-react';
import { uiAnchor, uiPaintOrder } from '../content-coordinates';
import { resolveUiImage } from './uiAtlas';
import { uiFontKey } from '../ui-font-reference';
import type { BeeGameUiContentNode } from './types';

export type UiNodeKind =
  | 'canvas' | 'flow' | 'flow-screen' | 'container'
  | 'text' | 'image' | 'nine-slice' | 'button' | 'slider' | 'toggle' | 'dropdown' | 'tab'
  | 'shape' | 'keycap' | 'toast' | 'world-prompt' | 'capsule-segment'
  | 'particle-system' | 'other';

export function uiNodeKind(role: string): UiNodeKind {
  const value = role.replace(/[\s_-]/g, '').toLowerCase();
  if (value === 'screenroot' || value === 'hudroot' || value === 'canvas') return 'canvas';
  if (value === 'flowroot') return 'flow';
  if (value === 'flowscreen') return 'flow-screen';
  if (value === 'container' || value === 'group') return 'container';
  if (value === 'text' || value === 'label' || value === 'input') return 'text';
  if (value === 'image' || value === 'sprite' || value === 'icon' || value === 'background') return 'image';
  if (value === 'nineslicepanel' || value === 'nineslice') return 'nine-slice';
  if (value === 'button' || value === 'dropdown' || value === 'tab') return value;
  if (value === 'slider') return 'slider';
  if (value === 'toggle') return 'toggle';
  if (value === 'shape' || value === 'panel') return 'shape';
  if (value === 'keycap') return 'keycap';
  if (value === 'toast') return 'toast';
  if (value === 'worldprompt') return 'world-prompt';
  if (value === 'capsulesegment') return 'capsule-segment';
  if (value === 'emitter' || value === 'particlesystem') return 'particle-system';
  return 'other';
}

export function supportsTextNode(kind: UiNodeKind): boolean {
  return kind === 'text' || kind === 'button' || kind === 'tab' || kind === 'keycap' || kind === 'toast' || kind === 'world-prompt' || kind === 'capsule-segment';
}

export function supportsImageNode(kind: UiNodeKind): boolean {
  // A node's interaction role does not determine whether its visual can use
  // an image. Keep button behavior/text intact when changing its background.
  return isVisualNode(kind) && kind !== 'text' && kind !== 'particle-system' && kind !== 'other';
}

export function isVisualNode(kind: UiNodeKind): boolean {
  return kind !== 'flow' && kind !== 'flow-screen' && kind !== 'canvas';
}

export function isTransformNode(kind: UiNodeKind): boolean {
  return kind !== 'flow' && kind !== 'flow-screen';
}

export function isNineSliceRole(role: string): boolean {
  return uiNodeKind(role) === 'nine-slice';
}

export function uiNodeText(node: BeeGameUiContentNode): string {
  if (node.text !== undefined) return node.text;
  const label = typeof node.data?.label === 'object' && node.data.label !== null ? node.data.label as { content?: unknown } : undefined;
  return typeof node.data?.label === 'string' ? node.data.label : typeof label?.content === 'string' ? label.content : '';
}

export function nodeSize(node: BeeGameUiContentNode): [number, number] {
  if (!node.parentId) {
    const coordinate = node.data?.coordinateSystem as { width?: number; height?: number } | undefined;
    const resolution = node.data?.referenceResolution as number[] | undefined;
    return [node.layout?.size?.[0] ?? resolution?.[0] ?? coordinate?.width ?? 1280, node.layout?.size?.[1] ?? resolution?.[1] ?? coordinate?.height ?? 720];
  }
  if (node.layout?.size) return node.layout.size;
  const size = uiFontSize(node);
  const zone = node.data?.zone as { width?: number; height?: number } | undefined;
  return zone?.width !== undefined && zone.height !== undefined ? [zone.width, zone.height] : node.role === 'text' ? [Math.max(160, uiNodeText(node).length * size * 1.05), size * 1.35] : [160, 48];
}

export function uiFontSize(node: BeeGameUiContentNode): number {
  const label = node.data?.label as { fontSize?: number } | undefined;
  return typeof node.style?.fontSize === 'number' ? node.style.fontSize : typeof node.data?.fontSize === 'number' ? node.data.fontSize : label?.fontSize ?? 18;
}

export function nodeAnchor(node: BeeGameUiContentNode) {
  return uiAnchor(node.layout?.anchor);
}

export function nodePosition(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): [number, number] {
  const [x, y] = node.layout?.position ?? [0, 0];
  const parent = nodes.find(item => item.id === node.parentId);
  const [width, height] = parent ? nodeSize(parent) : [0, 0];
  const [ax, ay] = nodeAnchor(node);
  return [x + ax * width, y + ay * height];
}

export function uiPaintChildren(nodes: BeeGameUiContentNode[], rootId: string): Map<string, string[]> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const output = new Map<string, string[]>();
  for (const step of uiPaintOrder(nodes, rootId)) {
    if (step.phase !== 'background' || step.nodeId === rootId) continue;
    const node = byId.get(step.nodeId)!;
    output.set(node.parentId!, [...(output.get(node.parentId!) ?? []), node.id]);
  }
  return output;
}

export function renderUiNode(
  id: string,
  nodes: BeeGameUiContentNode[],
  children: Map<string, string[]>,
  assetUrls: Record<string, string>,
  fontFamilies: Record<string, string>,
  selectedId: string,
  select: (id: string) => void,
  hiddenIds: Set<string>,
  unpickableIds: Set<string>,
  root = false,
): React.ReactNode {
  const node = nodes.find(item => item.id === id);
  if (!node || node.enabled === false || hiddenIds.has(id)) return null;
  const style = uiNodeStyle(node, root, fontFamilies, nodes);
  const image = resolveNodeImage(node, assetUrls);
  const text = uiNodeText(node);
  const kind = uiNodeKind(node.role);
  return <div
    key={node.id}
    className={`ui-editor-node${selectedId === node.id ? ' selected' : ''}`}
    style={style}
    onPointerDown={event => { if (event.button === 0 && !unpickableIds.has(node.id)) { event.stopPropagation(); select(node.id); } }}
    data-role={node.role}
    data-node-id={node.id}
    data-selected={kind === 'tab' ? node.data?.selected === true : undefined}
  >
    {image ? <UiImagePreview node={node} src={image} /> : null}
    {kind === 'slider' ? <UiSliderPreview node={node} assetUrls={assetUrls} /> : null}
    {kind === 'toggle' ? <UiTogglePreview node={node} /> : null}
    {kind === 'particle-system' ? <UiParticlePreview node={node} assetUrls={assetUrls} /> : null}
    {kind === 'dropdown' ? <span>{Array.isArray(node.data?.options) ? String(node.data.options[Number(node.data?.selected ?? 0)] ?? '') : text}<ChevronRight size={14} className="ui-editor-dropdown-arrow" /></span> : text && kind !== 'toggle' ? <span className="ui-editor-text" style={{ justifyContent: style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : 'center', alignItems: node.style?.verticalAlign === 'top' ? 'flex-start' : node.style?.verticalAlign === 'bottom' ? 'flex-end' : 'center' }}>{text}</span> : null}
    {(children.get(node.id) ?? []).map(child => renderUiNode(child, nodes, children, assetUrls, fontFamilies, selectedId, select, hiddenIds, unpickableIds))}
  </div>;
}

export function resolveDataImage(value: unknown, assetUrls: Record<string, string>): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const reference = value as { assetRef?: unknown; member?: unknown; frame?: unknown };
  if (typeof reference.assetRef !== 'string') return undefined;
  return resolveNodeImage({ id: '', role: 'image', assetRef: reference.assetRef, data: reference }, assetUrls);
}

export function UiSliderPreview({ node, assetUrls }: { node: BeeGameUiContentNode; assetUrls: Record<string, string> }) {
  const min = typeof node.data?.min === 'number' ? node.data.min : 0;
  const max = typeof node.data?.max === 'number' ? node.data.max : 1;
  const value = typeof node.data?.value === 'number' ? node.data.value : typeof node.data?.default === 'number' ? node.data.default : min;
  const amount = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const track = resolveDataImage(node.data?.track, assetUrls);
  const fill = resolveDataImage(node.data?.fill, assetUrls);
  return <span className="ui-editor-slider-preview" aria-hidden="true">
    <i className="ui-editor-slider-track" style={track ? { backgroundImage: `url(${track})` } : undefined} />
    <i className="ui-editor-slider-fill" style={{ width: `${amount * 100}%`, ...(fill ? { backgroundImage: `url(${fill})` } : {}) }} />
    <i className="ui-editor-slider-handle" style={{ left: `${amount * 100}%` }} />
  </span>;
}

export function UiTogglePreview({ node }: { node: BeeGameUiContentNode }) {
  const initial = node.data?.value ?? node.data?.default;
  const checked = initial === true || initial === 'on';
  const followsSystem = initial === 'follow-prefers-reduced-motion';
  const label = uiNodeText(node);
  const boxColor = typeof node.style?.boxColor === 'string' ? node.style.boxColor : '#343947';
  const checkColor = typeof node.style?.checkColor === 'string' ? node.style.checkColor : '#ffffff';
  return <span className={`ui-editor-toggle-preview${checked ? ' checked' : ''}${followsSystem ? ' mixed' : ''}`} aria-hidden="true">
    <i className="ui-editor-toggle-box" style={{ background: boxColor, color: checkColor }}>{checked ? '✓' : followsSystem ? '−' : ''}</i>
    {label ? <b>{label}</b> : null}
  </span>;
}

export function UiParticlePreview({ node, assetUrls }: { node: BeeGameUiContentNode; assetUrls: Record<string, string> }) {
  const texture = resolveDataImage(node.data?.texture, assetUrls);
  const tint = typeof node.data?.tint === 'string' ? node.data.tint : '#ffffff';
  const count = Math.max(0, Math.min(200, Math.floor(typeof node.data?.count === 'number' ? node.data.count : 8)));
  const size = node.data?.particleSize;
  const range = size && typeof size === 'object' ? size as { min?: number; max?: number } : undefined;
  const minSize = typeof size === 'number' ? size : range?.min ?? 8;
  const maxSize = range?.max ?? minSize;
  const zone = node.data?.zone as { x?: number; y?: number; width?: number; height?: number } | undefined;
  const [width, height] = nodeSize(node);
  return <span className="ui-editor-particle-preview" aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} style={{
    left: (zone?.x ?? 0) + (12 + ((index * 37) % 79)) / 100 * (zone?.width ?? width),
    top: (zone?.y ?? 0) + (8 + ((index * 53) % 83)) / 100 * (zone?.height ?? height),
    width: Math.max(0, minSize + (maxSize - minSize) * ((index * 37 % 100) / 100)),
    mixBlendMode: node.data?.blend === 'additive' || node.data?.blend === 'add' ? 'screen' : node.data?.blend === 'multiply' ? 'multiply' : 'normal',
    color: tint,
    backgroundColor: tint,
    backgroundImage: texture ? `url(${texture})` : undefined,
  }} />)}</span>;
}

export function uiNodeStyle(node: BeeGameUiContentNode, root: boolean, fontFamilies: Record<string, string>, nodes: BeeGameUiContentNode[]): React.CSSProperties {
  if (root) {
    const background = typeof node.data?.background === 'object' && node.data.background !== null
      ? node.data.background as { color?: unknown }
      : undefined;
    return {
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      perspective: 1000,
      transformStyle: 'preserve-3d',
      background: typeof background?.color === 'string' ? background.color : undefined,
    };
  }
  const [x, y] = nodePosition(node, nodes);
  const [presetX, presetY] = nodeAnchor(node);
  const [scaleX, scaleY] = node.layout?.scale ?? [1, 1];
  const style = node.style ?? {};
  const data = node.data ?? {};
  const anchorData = typeof data.anchor === 'object' && data.anchor !== null
    ? data.anchor as { x?: unknown; y?: unknown }
    : undefined;
  const anchorX = typeof anchorData?.x === 'number' ? anchorData.x : presetX;
  const anchorY = typeof anchorData?.y === 'number' ? anchorData.y : presetY;
  const dataColor = typeof data.color === 'string' ? data.color : undefined;
  const dataAlpha = typeof style.opacity === 'number' ? style.opacity : typeof data.alpha === 'number' ? data.alpha : undefined;
  const background = typeof style.background === 'object' && style.background !== null ? style.background as { color?: string; opacity?: number; radius?: number } : undefined;
  const border = typeof style.border === 'object' && style.border !== null ? style.border as { width?: number; color?: string; radius?: number } : undefined;
  const align = style.align ?? data.align;
  const shape = style.shape ?? data.shape;
  const label = typeof data.label === 'object' && data.label !== null
    ? data.label as { content?: unknown; fontSize?: unknown; color?: unknown }
    : undefined;
  const resolvedFontSize = uiFontSize(node);
  const fontKey = uiFontKey(data.font);
  const fontFamily = supportsTextNode(uiNodeKind(node.role)) && fontKey ? fontFamilies[fontKey] : undefined;
  const worldSpace = data.space === 'world';
  const rotation3D = Array.isArray(data.rotation3D) ? data.rotation3D : [0, 0, (node.layout?.rotation ?? 0) * 180 / Math.PI];
  const positionZ = typeof data.positionZ === 'number' ? data.positionZ : 0;
  const scaleZ = typeof data.scaleZ === 'number' ? data.scaleZ : 1;
  const [width, height] = nodeSize(node);
  const output: React.CSSProperties = {
    position: 'absolute',
    width,
    height,
    color: typeof style.textColor === 'string' ? style.textColor : typeof style.color === 'string' ? style.color : dataColor ?? (typeof label?.color === 'string' ? label.color : undefined),
    background: Array.isArray(style.gradient) && style.gradient.every(color => typeof color === 'string') ? `linear-gradient(${style.gradient.join(',')})` : background?.color ? (typeof background.opacity === 'number' ? `color-mix(in srgb, ${background.color} ${background.opacity * 100}%, transparent)` : background.color) : typeof style.background === 'string'
      ? style.background
      : typeof style.fill === 'string'
        ? style.fill
        : node.role === 'shape' ? (typeof style.color === 'string' ? style.color : dataColor) : undefined,
    border: typeof style.border === 'string' ? `1px solid ${style.border}` : border ? `${border.width ?? 0}px solid ${border.color ?? 'transparent'}` : undefined,
    borderRadius: typeof style.cornerRadius === 'number' ? style.cornerRadius : typeof style.radius === 'number' ? style.radius : border?.radius ?? background?.radius ?? (node.role === 'keycap' ? 6 : undefined),
    fontSize: resolvedFontSize,
    fontFamily,
    fontWeight: typeof style.fontWeight === 'number' ? style.fontWeight : 400,
    letterSpacing: typeof style.letterSpacing === 'number' ? style.letterSpacing : 0,
    textTransform: 'none',
    opacity: dataAlpha,
    lineHeight: typeof style.lineHeight === 'number' ? `${style.lineHeight}px` : 1.35,
    textAlign: align === 'left' || align === 'right' || align === 'center' ? align : 'center',
    transformStyle: worldSpace ? 'preserve-3d' : undefined,
    transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
    transform: worldSpace
      ? `translateZ(${positionZ}px) rotateX(${Number(rotation3D[0]) || 0}deg) rotateY(${Number(rotation3D[1]) || 0}deg) rotateZ(${Number(rotation3D[2]) || 0}deg) scale3d(${scaleX}, ${scaleY}, ${scaleZ})`
      : `rotate(${node.layout?.rotation ?? 0}rad) scale(${scaleX}, ${scaleY})`,
  };
  if (node.role === 'shape') {
    if (shape === 'cone' || shape === 'triangle') output.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
    else if (shape === 'circle' || shape === 'ellipse') output.borderRadius = '50%';
  }
  if (node.role === 'keycap') output.boxShadow = 'inset 0 -2px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.18)';
  output.left = x;
  output.top = y;
  output.translate = `${-anchorX * 100}% ${-anchorY * 100}%`;
  return output;
}

export function uiNodeImageSource(node: BeeGameUiContentNode): { assetRef?: string; data?: Record<string, unknown> } {
  const image = typeof node.data?.image === 'object' && node.data.image !== null
    ? node.data.image as Record<string, unknown> : undefined;
  return typeof image?.assetRef === 'string'
    ? { assetRef: image.assetRef, data: { ...node.data, ...image } }
    : { assetRef: node.assetRef, data: node.data };
}

export function resolveNodeImage(node: BeeGameUiContentNode, assetUrls: Record<string, string>): string | undefined {
  const { assetRef, data } = uiNodeImageSource(node);
  return assetRef ? resolveUiImage(assetRef, data, assetUrls) : undefined;
}

export function UiImagePreview({ node, src }: { node: BeeGameUiContentNode; src: string }) {
  const image = typeof node.data?.image === 'object' && node.data.image !== null ? node.data.image as Record<string, unknown> : {};
  const type = typeof image.type === 'string' ? image.type : isNineSliceRole(node.role) ? 'sliced' : 'simple';
  const preserveAspect = image.preserveAspect === true || (!('preserveAspect' in image) && node.data?.fit === 'contain');
  if (type === 'tiled') return <span className="ui-editor-image tiled" aria-hidden="true" style={{ backgroundImage: `url(${src})` }} />;
  if (type === 'sliced') {
    const border = typeof node.data?.border === 'object' && node.data.border !== null ? node.data.border as Record<string, unknown> : {};
    const slice = (node.data?.nineSlice as { border?: number[] } | undefined)?.border;
    const left = typeof border.left === 'number' ? border.left : slice?.[0] ?? 16;
    const right = typeof border.right === 'number' ? border.right : slice?.[1] ?? 16;
    const top = typeof border.top === 'number' ? border.top : slice?.[2] ?? 16;
    const bottom = typeof border.bottom === 'number' ? border.bottom : slice?.[3] ?? 16;
    return <span className="ui-editor-image sliced" aria-hidden="true" style={{
      borderImageSource: `url(${src})`,
      borderImageSlice: `${top} ${right} ${bottom} ${left} fill`,
      borderWidth: `${top}px ${right}px ${bottom}px ${left}px`,
    }} />;
  }
  const amount = typeof image.fillAmount === 'number' ? Math.max(0, Math.min(1, image.fillAmount)) : 1;
  const method = typeof image.fillMethod === 'string' ? image.fillMethod : 'horizontal';
  const origin = image.fillOrigin === 'end' ? 'end' : 'start';
  const fillStyle: React.CSSProperties = {};
  if (type === 'filled') {
    if (method === 'horizontal') fillStyle.clipPath = origin === 'start' ? `inset(0 ${100 - amount * 100}% 0 0)` : `inset(0 0 0 ${100 - amount * 100}%)`;
    else if (method === 'vertical') fillStyle.clipPath = origin === 'start' ? `inset(0 0 ${100 - amount * 100}% 0)` : `inset(${100 - amount * 100}% 0 0 0)`;
    else {
      const sweep = method === 'radial90' ? 90 : method === 'radial180' ? 180 : 360;
      const start = origin === 'start' ? 0 : 360 - sweep;
      const mask = `conic-gradient(from ${start}deg, #000 ${amount * sweep}deg, transparent 0)`;
      fillStyle.maskImage = mask;
      fillStyle.WebkitMaskImage = mask;
    }
  }
  return <img className="ui-editor-image" src={src} alt="" draggable={false} style={{ ...fillStyle, objectFit: preserveAspect ? 'contain' : 'fill' }} />;
}
