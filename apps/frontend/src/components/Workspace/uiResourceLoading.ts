import { uiAtlasImages } from './uiAtlas';
import { uiFontKey } from '../../../../../packages/scene-editor/src/ui-font-reference';

export type UiResource = { id: string; root_path: string; file_paths: string[] };
export const UI_IMAGE = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)$/i;
export const UI_FONT = /\.(?:woff2?|ttf|otf)$/i;
type ReadBlob = (path: string) => Promise<Blob>;

export async function loadUiFont(resource: UiResource, read: ReadBlob, member = resource.root_path) {
  const paths = resource.file_paths.filter(path => UI_FONT.test(path));
  if (!paths.length) return;
  if (!paths.includes(member)) throw Error(`Font ${resource.id} must select a registered font member; root_path is only the default, not a fallback chain`);
  const key = uiFontKey({ assetRef: resource.id, member })!;
  // Safe, unique CSS family for each resource/member, including Unicode paths.
  const family = 'BGS-' + Array.from(key, char => char.codePointAt(0)!.toString(16)).join('-');
  const face = new FontFace(family, await (await read(member)).arrayBuffer());
  try { await face.load(); }
  catch { throw Error('Font data could not be decoded by this browser'); }
  return { family, face, keys: [key, ...(member === resource.root_path ? [resource.id] : [])] };
}

export async function loadUiImage(resource: UiResource, path: string, read: ReadBlob, signal: AbortSignal, objectUrls: string[]) {
  const url = URL.createObjectURL(await read(path));
  objectUrls.push(url);
  signal.throwIfAborted();
  const image = new Image(); image.src = url; await image.decode();
  const stem = (path: string) => path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  const member = stem(path), aliases = [path];
  if (resource.file_paths.filter(file => UI_IMAGE.test(file) && stem(file) === member).length === 1) aliases.push(member);
  const entries: Array<readonly [string, string]> = aliases.map(alias => [`${resource.id}:${alias}`, url]);
  if (path === resource.root_path) entries.push([resource.id, url]);
  const sidecar = resource.file_paths.find(file => file === path.replace(/\.[^.]+$/, '.json'));
  if (sidecar) {
    const frames = await uiAtlasImages(url, JSON.parse(await (await read(sidecar)).text()), signal, objectUrls);
    for (const [frame, cropped] of Object.entries(frames)) {
      for (const alias of aliases) entries.push([`${resource.id}:${alias}#${frame}`, cropped]);
      if (path === resource.root_path) entries.push([`${resource.id}#${frame}`, cropped]);
    }
  }
  return entries;
}
