import { mkdir, readFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { parseSpriteSheet, spriteSheetSelection } from '../../../scene-editor/src/sprite-sheet'
import { affine2d, compose2d, point2d, rectLayout, type Affine2D } from '../../../scene-editor/src/content-coordinates'
import { readBeeGameAssetManifestSync, type BeeGameProjectResource } from './asset-contracts'
import { auditBeeGameContentPackage, type BeeGameContentDocument } from './game-content-package'

type RecordValue = Record<string, unknown>
type SceneDocument = Extract<BeeGameContentDocument, { kind: 'scene-2d' }>
type SceneNode = SceneDocument['data']['nodes'][number]

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stem(path: string): string {
  return basename(path, extname(path))
}

function component(node: SceneNode, ...types: string[]) {
  return node.components?.find(item => types.includes(item.type))
}

function visualComponent(node: SceneNode) {
  // `image` is the canonical UI/Canvas renderer in the content contract. It
  // used to be omitted here, which meant Canvas/Image nodes were valid in the
  // package but silently disappeared from generated scene previews.
  return component(node, 'sprite-renderer', 'tilemap-renderer', 'image')
}

function visualData(node: SceneNode): RecordValue | undefined {
  return record(visualComponent(node)?.data) ?? record(node.data)
}

function rectTransformData(node: SceneNode): RecordValue | undefined {
  return record(component(node, 'rect-transform')?.data)
}

function assetRef(node: SceneNode): string | undefined {
  return visualComponent(node)?.assetRef
}

function explicitMember(node: SceneNode): string | undefined {
  const data = visualData(node)
  const texture = record(data?.texture)
  const sprite = record(data?.sprite)
  const actions = record(sprite?.actions)
  const idle = record(actions?.idle)
  return text(data?.member) ?? text(texture?.member) ?? text(idle?.member)
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/u).filter(token => token && !/^\d+$/u.test(token))
}

function inferredMember(node: SceneNode, resource: BeeGameProjectResource): string | undefined {
  const explicit = explicitMember(node)
  if (explicit) return explicit
  const visualMembers = resource.file_paths
    .filter(path => /\.(?:png|jpe?g|webp|gif|avif)$/iu.test(path))
    .map(path => stem(path))
  if (visualMembers.includes(node.id)) return node.id
  const nodeTokens = normalizedTokens(node.id).filter(token => !['bg', 'deco', 'post'].includes(token))
  let best: { member: string; score: number } | undefined
  for (const member of visualMembers) {
    const memberTokens = normalizedTokens(member).filter(token => !['sp', 'prop', 'ui', 'fx'].includes(token))
    const score = nodeTokens.filter(token => memberTokens.includes(token)).length
    if (score > 0 && (!best || score > best.score)) best = { member, score }
  }
  return best?.member
}

function resourcePath(resource: BeeGameProjectResource, member?: string): string | undefined {
  if (!member) return resource.root_path
  return resource.file_paths.find(path =>
    stem(path) === member && /\.(?:png|jpe?g|webp|gif|avif)$/iu.test(path),
  )
}

function nodeSize(node: SceneNode, nodes: Map<string, SceneNode>): { width: number; height: number } {
  const rect = sceneRect(node, nodes)
  if (rect) return { width: rect.size[0], height: rect.size[1] }
  const data = visualData(node)
  const size = (Array.isArray(data?.size) ? { width: data.size[0], height: data.size[1] } : record(data?.size))
    ?? record(record(data?.sprite)?.logicalSize)
  const width = number(size?.width, number(data?.width, 100))
  const height = number(size?.height, number(data?.height, 100))
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
  }
}

function nodeAnchor(node: SceneNode): { x: number; y: number } {
  const rawAnchor = visualData(node)?.anchor
  const anchor = Array.isArray(rawAnchor) ? { x: rawAnchor[0], y: rawAnchor[1] } : record(rawAnchor)
  const pivot = rectTransformData(node)?.pivot
  return {
    x: Array.isArray(pivot) ? number(pivot[0], .5) : number(anchor?.x, .5),
    y: Array.isArray(pivot) ? number(pivot[1], .5) : number(anchor?.y, .5),
  }
}

function pair(value: unknown, fallback: [number, number]): [number, number] {
  return Array.isArray(value) ? [number(value[0], fallback[0]), number(value[1], fallback[1])] : fallback
}

export function sceneRect(node: SceneNode, nodes: Map<string, SceneNode>, path = new Set<string>()): ReturnType<typeof rectLayout> | undefined {
  const rect = rectTransformData(node)
  if (!rect) return undefined
  if (path.has(node.id)) throw new Error('Invalid rect hierarchy')
  const parent = node.parentId ? nodes.get(node.parentId) : undefined
  const parentRect = parent && rectTransformData(parent)
  const parentSize = parent && parentRect ? sceneRect(parent, nodes, new Set(path).add(node.id))?.size ?? [0, 0] : [0, 0]
  return rectLayout(parentSize, pair(parentRect?.pivot, [0, 0]), pair(rect.anchorMin, [0, 0]), pair(rect.anchorMax, [1, 1]), pair(rect.pivot, [.5, .5]), pair(rect.anchoredPosition, [0, 0]), pair(rect.sizeDelta, [0, 0]))
}

function localScale(node: SceneNode): { x: number; y: number } {
  const scale = node.transform?.scale ?? [1, 1, 1]
  return {
    x: Number.isFinite(scale?.[0]) ? scale[0] : 1,
    y: Number.isFinite(scale?.[1]) ? scale[1] : 1,
  }
}

type PreviewPose = Affine2D

export function worldPose(node: SceneNode, nodes: Map<string, SceneNode>, cache = new Map<string, PreviewPose>()): PreviewPose {
  const cached = cache.get(node.id)
  if (cached) return cached
  const offset = sceneRect(node, nodes)?.position ?? [0, 0]
  const position = node.transform?.position ?? [0, 0, 0]
  const scale = localScale(node)
  const local = affine2d(position[0]+offset[0], position[1]+offset[1], node.transform?.rotation?.[2] ?? 0, scale.x, scale.y)
  const parent = node.parentId ? nodes.get(node.parentId) : undefined
  if (!parent) {
    cache.set(node.id, local)
    return local
  }
  const parentPose = worldPose(parent, nodes, cache)
  const pose = compose2d(parentPose, local)
  cache.set(node.id, pose)
  return pose
}

/** Rasterize the actual affine geometry, including rotation, mirroring and shear. */
export async function transformedOverlay(bytes: Buffer, pose: Affine2D, size: { width: number; height: number }, pivot: { x: number; y: number }, canvas: { width: number; height: number }, blend: sharp.Blend = 'over'): Promise<sharp.OverlayOptions | undefined> {
  if (size.width <= 0 || size.height <= 0) return undefined
  const matrix = compose2d(pose, affine2d(-pivot.x*size.width, -pivot.y*size.height))
  const corners = [[0,0], [size.width,0], [0,size.height], [size.width,size.height]].map(([x,y]) => point2d(matrix,x,y))
  const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])))), top = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1]))))
  const width = Math.min(canvas.width, Math.ceil(Math.max(...corners.map(p => p[0]))))-left
  const height = Math.min(canvas.height, Math.ceil(Math.max(...corners.map(p => p[1]))))-top
  if (width <= 0 || height <= 0 || Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]) < 1e-12) return undefined
  const m = [...matrix]; m[4] -= left; m[5] -= top
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><image width="${size.width}" height="${size.height}" preserveAspectRatio="none" transform="matrix(${m.join(' ')})" xlink:href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`
  return { input: await sharp(Buffer.from(svg)).png().toBuffer(), left, top, blend }
}

function visibleInDefaultState(node: SceneNode): boolean {
  if (node.enabled === false) return false
  const condition = text(record(node.data)?.visibleWhen)
    ?? node.components?.map(item => text(record(item.data)?.visibleWhen)).find(Boolean)
  return !condition || condition === 'state != caught' || condition.endsWith('.notCollected')
}

function canvasSize(scene: SceneDocument): { width: number; height: number } {
  const coordinates = record(scene.data.settings?.coordinateSystem)
  const camera = scene.data.cameraNodeId
    ? scene.data.nodes.find(node => node.id === scene.data.cameraNodeId)
    : scene.data.nodes.find(node => component(node, 'camera'))
  const cameraData = record(camera ? component(camera, 'camera')?.data : undefined)
  const viewport = record(cameraData?.viewport)
  return {
    width: Math.max(1, Math.round(number(coordinates?.width, number(viewport?.width, 1280)))),
    height: Math.max(1, Math.round(number(coordinates?.height, number(viewport?.height, 720)))),
  }
}

function layerOrder(scene: SceneDocument): Map<string, number> {
  const layers = scene.data.settings?.layers
  if (!Array.isArray(layers)) return new Map()
  return new Map(layers.flatMap((value, index) => {
    const layer = record(value)
    const id = text(layer?.id)
    return id ? [[id, number(layer?.order, index)] as const] : []
  }))
}

export async function firstSpriteFrame(input: {
  workspacePath: string
  resource: BeeGameProjectResource
  member: string
  bytes: Buffer
  node: SceneNode
}): Promise<Buffer> {
  const tablePath = input.resource.file_paths.find(path => stem(path) === input.member && extname(path).toLowerCase() === '.json')
  try {
    const data = visualData(input.node) ?? {}
    const table = tablePath ? parseSpriteSheet(JSON.parse(await readFile(resolve(input.workspacePath, tablePath), 'utf8'))) : undefined
    const animator = record(component(input.node, 'animator')?.data)
    const frame = spriteSheetSelection(table, { ...data, frameSize: data.frameSize ?? animator?.frameSize }).frame
    if (!frame || !frame.width || !frame.height) return input.bytes
    return sharp(input.bytes)
      .extract({ left: frame.x, top: frame.y, width: frame.width, height: frame.height })
      .png()
      .toBuffer()
  } catch (error) {
    throw new Error(`Sprite frame ${input.node.id}/${input.member}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function applyOpacity(bytes: Buffer, opacity: number): Promise<Buffer> {
  const image = sharp(bytes).toColourspace('srgb').ensureAlpha()
  if (opacity >= 1) return image.png().toBuffer()
  const { data, info } = await image.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true })
  for (let offset = info.channels - 1; offset < data.length; offset += info.channels)
    data[offset] = Math.round(data[offset]! * Math.max(0, opacity))
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer()
}

function cssColor(value: unknown, fallback = '#ffffff'): string {
  const candidate = text(value)
  return candidate && /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/iu.test(candidate)
    ? candidate
    : fallback
}

async function solidColorImage(width: number, height: number, color: string): Promise<Buffer> {
  // Image components may intentionally be untextured (e.g. a full-screen
  // caught-state fade). Keep those valid Unity-style Image nodes visible in
  // the deterministic preview instead of silently dropping them.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function particleComponent(node: SceneNode, type: 'particle-system' | 'particle-system-renderer') {
  return component(node, type)
}

function particleData(node: SceneNode): RecordValue | undefined {
  const particle = record(particleComponent(node, 'particle-system')?.data)
  const renderer = record(particleComponent(node, 'particle-system-renderer')?.data)
  if (!particle && !renderer) return undefined
  return { ...particle, ...renderer }
}

function particleAssetRef(node: SceneNode): string | undefined {
  return particleComponent(node, 'particle-system-renderer')?.assetRef
}

function particleMember(node: SceneNode): string | undefined {
  const data = particleData(node)
  return text(data?.member) ?? text(data?.textureMember)
}

function seeded(value: number, salt: number): number {
  const sample = Math.sin(value * 127.1 + salt * 311.7) * 43758.5453
  return sample - Math.floor(sample)
}

async function particleImage(bytes: Buffer, size: number, tint: string, alpha: number): Promise<Buffer> {
  const image = sharp(bytes)
    .resize(Math.max(1, Math.round(size)), Math.max(1, Math.round(size)), { fit: 'fill' })
    .ensureAlpha()
  // Tint is deliberately applied before opacity so the alpha authored by the
  // ParticleSystem remains independent from the texture's own alpha.
  const tinted = await image.tint(tint).png().toBuffer()
  return applyOpacity(tinted, alpha)
}

export async function renderSceneContentPreviews(workspacePath: string): Promise<string[]> {
  const manifest = readBeeGameAssetManifestSync(workspacePath)
  const run = JSON.parse(await readFile(resolve(workspacePath, '.beegame/workflow/run.json'), 'utf8')) as RecordValue
  const revision = record(run.revision)
  const documentRevision = text(revision?.document)
  const assetManifestRevision = text(revision?.resource)
  if (!documentRevision || !assetManifestRevision)
    throw new Error('Scene preview requires accepted document and Asset Manifest revisions.')
  const audit = auditBeeGameContentPackage(workspacePath, {
    documentRevision,
    assetManifestRevision,
    manifest,
  })
  if (!audit.valid || !audit.package)
    throw new Error(`Cannot render invalid content package: ${audit.issues.join(' ')}`)
  const resources = new Map(manifest.resources.map(resource => [resource.id, resource]))
  const outputRoot = resolve(workspacePath, 'content/previews')
  await mkdir(outputRoot, { recursive: true })
  const outputs: string[] = []
  const issues: string[] = []
  for (const document of audit.package.documents) {
    if (document.kind !== 'scene-2d') continue
    const initialIssues = issues.length
    const failed = (nodeId: string, error: unknown) => {
      issues.push(`${document.id}/${nodeId}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const size = canvasSize(document)
    const layers = layerOrder(document)
    const nodes = new Map(document.data.nodes.map(node => [node.id, node]))
    const poseCache = new Map<string, PreviewPose>()
    const composites: sharp.OverlayOptions[] = []
    const ordered = [...document.data.nodes].sort((left, right) => {
      const leftLayer = left.layer ? layers.get(left.layer) ?? 0 : 0
      const rightLayer = right.layer ? layers.get(right.layer) ?? 0 : 0
      return leftLayer - rightLayer || (left.zIndex ?? 0) - (right.zIndex ?? 0)
    })
    for (const node of ordered) {
      if (!visibleInDefaultState(node)) continue
      const pose = worldPose(node, nodes, poseCache)
      const visual = visualComponent(node)
      const particle = particleData(node)
      const particleResourceId = particleAssetRef(node)
      const resourceId = assetRef(node)

      // ParticleSystem and ParticleSystemRenderer are a component pair and do
      // not have a SpriteRenderer-style visual component.
      if (particle && particleResourceId) {
        const resource = resources.get(particleResourceId)
        const member = particleMember(node)
        const path = resource ? resourcePath(resource, member) : undefined
        if (!resource || resource.status !== 'verified' || !path) {
          failed(node.id, 'Particle resource/member is unavailable')
          continue
        }
        try {
          const sourceBytes = await readFile(resolve(workspacePath, path))
          const bytes = member
            ? await firstSpriteFrame({ workspacePath, resource, member, bytes: sourceBytes, node })
            : sourceBytes
          const count = Math.max(0, Math.min(256, Math.floor(number(particle.count, number(particle.maxParticles, 0)))))
          const zone = record(particle.zone)
          const sizeRange = record(particle.particleSize)
          const alphaRange = record(particle.alpha)
          const motion = record(particle.motion)
          const tint = cssColor(particle.tint, '#ffffff')
          const blend = text(particle.blend) === 'additive' ? 'screen' : 'over'
          for (let index = 0; index < count; index += 1) {
            const x = number(zone?.x, 0) + seeded(index, 1) * number(zone?.width, 0)
            const y = number(zone?.y, 0) + seeded(index, 2) * number(zone?.height, 0)
            const minSize = number(sizeRange?.min, 3)
            const maxSize = number(sizeRange?.max, minSize)
            const particleSize = Math.max(1, minSize + seeded(index, 3) * (maxSize - minSize))
            const minAlpha = number(alphaRange?.min, .35)
            const maxAlpha = number(alphaRange?.max, .9)
            const alpha = Math.max(0, Math.min(1, minAlpha + seeded(index, 4) * (maxAlpha - minAlpha)))
            const drift = number(motion?.amplitudePx, 0)
            const driftX = drift * Math.sin(seeded(index, 5) * Math.PI * 2)
            const driftY = drift * Math.cos(seeded(index, 6) * Math.PI * 2)
            const rendered = await particleImage(bytes, particleSize, tint, alpha)
            const overlay = await transformedOverlay(rendered, compose2d(pose, affine2d(x+driftX, y+driftY)), { width: particleSize, height: particleSize }, { x: .5, y: .5 }, size, blend)
            if (overlay) composites.push(overlay)
          }
        } catch (error) {
          failed(node.id, error)
        }
        continue
      }

      // A Canvas/Image can be a solid-color element and therefore has no
      // assetRef. Render the authored color instead of silently dropping it.
      if (visual?.type === 'image' && !resourceId) {
        const data = record(visual.data)
        const dimensions = nodeSize(node, nodes)
        const alpha = Math.max(0, Math.min(1, number(data?.alpha, number(data?.opacity, 1))))
        try {
          const rendered = await applyOpacity(await solidColorImage(Math.max(1, Math.round(dimensions.width)), Math.max(1, Math.round(dimensions.height)), cssColor(data?.color)), alpha)
          const overlay = await transformedOverlay(rendered, pose, dimensions, nodeAnchor(node), size)
          if (overlay) composites.push(overlay)
        } catch (error) {
          failed(node.id, error)
        }
        continue
      }

      if (!resourceId) continue
      const resource = resources.get(resourceId)
      if (!resource || resource.status !== 'verified') continue
      const member = inferredMember(node, resource)
      const path = resourcePath(resource, member)
      if (!path || !/\.(?:png|jpe?g|webp|gif|avif)$/iu.test(path)) continue
      try {
        const sourceBytes = await readFile(resolve(workspacePath, path))
        const bytes = member
          ? await firstSpriteFrame({ workspacePath, resource, member, bytes: sourceBytes, node })
          : sourceBytes
        const dimensions = nodeSize(node, nodes)
        const anchor = nodeAnchor(node)
        const visualValues = visualData(node)
        const alpha = Math.max(0, Math.min(1, number(visualValues?.alpha, number(visualValues?.opacity, 1))))
        const resized = await sharp(bytes)
          .resize(Math.max(1, Math.round(dimensions.width)), Math.max(1, Math.round(dimensions.height)), { fit: 'fill' })
          .ensureAlpha()
          .png()
          .toBuffer()
        // Sharp's `linear` operation does not scale the alpha channel of an
        // RGBA image. Extract and reattach alpha so scene-authored opacity is
        // reflected in the deterministic preview as it is in the editor.
        const rendered = await applyOpacity(resized, alpha)
        const overlay = await transformedOverlay(rendered, pose, dimensions, anchor, size, text(visualData(node)?.blend) === 'additive' ? 'screen' : 'over')
        if (overlay) composites.push(overlay)
      } catch (error) {
        failed(node.id, error)
      }
    }
    if (issues.length > initialIssues) continue
    const outputPath = join(outputRoot, `${document.id}.png`)
    await sharp({ create: { width: size.width, height: size.height, channels: 4, background: '#181a20' } })
      .composite(composites)
      .png()
      .toFile(outputPath)
    outputs.push(outputPath)
  }
  if (issues.length)
    throw new Error('Scene preview failed; do not change valid content to work around renderer errors. ' + issues.join('; '))
  return outputs
}
