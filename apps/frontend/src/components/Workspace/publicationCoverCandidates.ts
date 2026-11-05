import { COVER_SAMPLE_WIDTH, COVER_SAMPLE_HEIGHT, coverImagesSimilar } from '@bee-game-studio/agent-workflow/cover-similarity';
import type { BeeGameDeploymentRequest } from '../../services/api';
import { beeGameAdapter } from '../../services/beeGameAdapter';

type Cover = NonNullable<BeeGameDeploymentRequest['publicationCover']>;

/** Uploaded files retain the 16:9 check; project images are cropped without changing their source. */
export function publicationCoverFromFile(file: File, labels: Record<string, string>, crop?: false): Promise<Cover>;
export function publicationCoverFromFile(file: File, labels: Record<string, string>, crop: true): Promise<Cover | undefined>;
export async function publicationCoverFromFile(file: File, labels: Record<string, string>, crop = false): Promise<Cover | undefined> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(labels.deploymentCoverFormat);
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(labels.deploymentCoverSize);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(labels.deploymentCoverReadError));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(labels.deploymentCoverReadError));
    image.src = dataUrl;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(labels.deploymentCoverReadError);
  if (crop && (image.naturalWidth < 640 || image.naturalHeight < 360 || image.naturalWidth / image.naturalHeight < 1.5 || image.naturalWidth / image.naturalHeight > 2)) return undefined;
  if (!crop && image.naturalWidth * 9 !== image.naturalHeight * 16) {
    throw new Error(labels.deploymentCoverRatio.replace('{width}', String(image.naturalWidth)).replace('{height}', String(image.naturalHeight)));
  }
  const canvas = document.createElement('canvas');
  if (crop) {
    // Match the preview and published bytes, with a centered 16:9 crop.
    canvas.width = 1280; canvas.height = 720;
  } else {
    const scale = Math.min(1, 1280 / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error(labels.deploymentCoverReadError);
  if (crop) {
    const width = Math.min(image.naturalWidth, image.naturalHeight * 16 / 9);
    const height = width * 9 / 16;
    context.drawImage(image, (image.naturalWidth - width) / 2, (image.naturalHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
  } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const encoded = /^data:(image\/(?:webp|png));base64,(.+)$/.exec(canvas.toDataURL('image/webp', 0.8));
  if (!encoded) throw new Error(labels.deploymentCoverReadError);
  const mediaType = encoded[1] as 'image/webp' | 'image/png';
  return { mediaType, filename: file.name.replace(/\.[^.]+$/, '') + (mediaType === 'image/webp' ? '.webp' : '.png'), data: encoded[2] };
}

async function coverPixels(cover: Cover, labels: Record<string, string>): Promise<Uint8ClampedArray> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(labels.deploymentCoverReadError));
    image.src = `data:${cover.mediaType};base64,${cover.data}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = COVER_SAMPLE_WIDTH; canvas.height = COVER_SAMPLE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(labels.deploymentCoverReadError);
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function loadPublicationCoverCandidates(projectId: string, labels: Record<string, string>, signal?: AbortSignal): Promise<Cover[]> {
  const manifest = await beeGameAdapter.getProjectAssets(projectId, signal);
  const seen = new Set<string>();
  const images = manifest.resources.filter(resource => resource.status !== 'failed').flatMap(resource =>
    resource.file_paths.filter(path => /\.(?:png|jpe?g|webp)$/i.test(path)).map(path => ({ resourceId: resource.id, path })),
  ).filter(({ path }) => { if (seen.has(path)) return false; seen.add(path); return true; });
  const candidates: Cover[] = [], samples: Uint8ClampedArray[] = [];
  const addCandidate = async (cover: Cover) => {
    const pixels = await coverPixels(cover, labels);
    if (samples.some(sample => coverImagesSimilar(sample, pixels))) return;
    samples.push(pixels); candidates.push(cover);
  };
  for (const { resourceId, path } of images) {
    const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resourceId, path, signal);
    signal?.throwIfAborted();
    const mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
    const candidate = await publicationCoverFromFile(new File([blob], path.split('/').at(-1)!, { type: mime }), labels, true);
    if (candidate) await addCandidate(candidate);
    if (candidates.length === 3) return candidates;
  }
  signal?.throwIfAborted();
  const { covers } = await beeGameAdapter.capturePublicationCovers(projectId);
  for (const cover of covers) {
    await addCandidate(cover);
    if (candidates.length === 3) break;
  }
  return candidates;
}
