import { parseSpriteSheet, spriteSheetSelection } from '../sprite-sheet';

export function uiNodeImageSource(node: { assetRef?: string; data?: Record<string, unknown> }): { assetRef?: string; data?: Record<string, unknown> } {
  const image = typeof node.data?.image === 'object' && node.data.image !== null
    ? node.data.image as Record<string, unknown> : undefined;
  return typeof image?.assetRef === 'string'
    ? { assetRef: image.assetRef, data: { ...node.data, ...image } }
    : { assetRef: node.assetRef, data: node.data };
}

const frameName = (name: string) => name.replace(/\.(png|webp|jpe?g)$/i, '');

/** Materialize cropped sprites once, so image, tiled and nine-slice previews
 * all consume the same pixels rather than stretching the complete atlas. */
export async function uiAtlasImages(src: string, metadata: unknown, signal: AbortSignal, objectUrls: string[]): Promise<Record<string, string>> {
  const sheet = parseSpriteSheet(metadata);
  if (!sheet) return {};
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { image.src = ''; cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const cleanup = () => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error('Cannot decode sprite atlas')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    image.src = src;
  });
  const frames = 'frames' in sheet ? sheet.frames : Object.fromEntries(
    (sheet.facings?.length ? sheet.facings : sheet.states?.length ? sheet.states : ['default'])
      .map(frame => [frame, spriteSheetSelection(sheet, { frame, initialFacing: frame }).frame!]),
  );
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable for sprite atlas');
  const output: Record<string, string> = {};
  for (const [name, rect] of Object.entries(frames)) {
    if (rect.x + rect.width > image.naturalWidth || rect.y + rect.height > image.naturalHeight) throw new Error(`Atlas frame outside image: ${name}`);
    canvas.width = rect.width; canvas.height = rect.height;
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    output[name] = await encodeFrame(canvas, signal, objectUrls);
  }
  const composites = (metadata as { meta?: { nine_slice?: Record<string, Record<string, string>> } }).meta?.nine_slice ?? {};
  for (const [name, parts] of Object.entries(composites)) {
    const part = (key: string) => {
      const rect = frames[frameName(parts[key] ?? '')];
      if (!rect) throw new Error(`Nine-slice ${name}: missing part ${key}`);
      return rect;
    };
    const tl = part('tl'), tr = part('tr'), bl = part('bl'), c = part('c');
    const widths = [tl.width, c.width, tr.width], heights = [tl.height, c.height, bl.height];
    canvas.width = widths.reduce((a, b) => a + b); canvas.height = heights.reduce((a, b) => a + b);
    for (const [index, key] of ['tl', 'h', 'tr', 'v', 'c', 'v', 'bl', 'h', 'br'].entries()) {
      const col = index % 3, row = Math.floor(index / 3), rect = part(key);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height,
        widths.slice(0, col).reduce((a, b) => a + b, 0), heights.slice(0, row).reduce((a, b) => a + b, 0), widths[col], heights[row]);
    }
    output[name] = await encodeFrame(canvas, signal, objectUrls);
  }
  return output;
}

// Async encoding yields between frames (including Cancel input). Blob URLs avoid
// base64 copies; the overlay owns their lifetime, just like the original atlas.
async function encodeFrame(canvas: HTMLCanvasElement, signal: AbortSignal, objectUrls: string[]): Promise<string> {
  signal.throwIfAborted();
  const blob = await new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    canvas.toBlob(value => {
      signal.removeEventListener('abort', abort);
      if (value) resolve(value);
      else reject(new Error('Cannot encode sprite atlas frame'));
    }, 'image/png');
  });
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

export function uiImageKey(assetRef: string, data: Record<string, unknown> = {}): string {
  const base = typeof data.member === 'string' ? `${assetRef}:${data.member}` : assetRef;
  const frame = typeof data.frame === 'string' ? data.frame : data.initialFacing;
  return typeof frame === 'string' ? `${base}#${frameName(frame)}` : base;
}

export function resolveUiImage(assetRef: string, data: Record<string, unknown> | undefined, images: Record<string, string>): string | undefined {
  // A named frame requires a real rectangle; never stretch an unresolved sheet.
  return images[uiImageKey(assetRef, data)];
}

/** Match registered metadata by full sibling path; an explicit JSON root wins. */
export function editorAtlasPath(resource: { root_path: string; file_paths: string[] }, imagePath: string): string | undefined {
  const stem = imagePath.replace(/\.[^.]+$/, '');
  const candidates = [`${stem}.json`, `${stem}.atlas.json`].filter(path => resource.file_paths.includes(path));
  return candidates.includes(resource.root_path) ? resource.root_path : candidates[0];
}

/** Resource-owned selectors must not survive selecting a different image. */
export function clearImageSelection(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data }
  for (const key of ['member', 'atlasMember', 'frame', 'frameTable', 'frameParts', 'stateFrames', 'initialFacing', 'frameSize']) delete next[key]
  return next
}
