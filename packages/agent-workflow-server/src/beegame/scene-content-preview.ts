import { mkdir, readFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import sharp from 'sharp'
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

function explicitMember(node: SceneNode): string | undefined {
  const data = record(node.data)
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

function nodeSize(node: SceneNode): { width: number; height: number } {
  const data = record(node.data)
  const size = record(data?.size) ?? record(record(data?.sprite)?.logicalSize)
  return {
    width: Math.max(1, Math.round(number(size?.width, 100))),
    height: Math.max(1, Math.round(number(size?.height, 100))),
  }
}

function nodeAnchor(node: SceneNode): { x: number; y: number } {
  const anchor = record(record(node.data)?.anchor)
  return { x: number(anchor?.x, .5), y: number(anchor?.y, .5) }
}

function localPosition(node: SceneNode): { x: number; y: number } {
  const offset = record(record(node.data)?.offset)
  return {
    x: number(node.transform?.position?.[0], number(offset?.x, 0)),
    y: number(node.transform?.position?.[1], number(offset?.y, 0)),
  }
}

function visibleInDefaultState(node: SceneNode): boolean {
  if (node.enabled === false) return false
  const condition = text(record(node.data)?.visibleWhen)
  return !condition || condition === 'state != caught' || condition.endsWith('.notCollected')
}

function canvasSize(scene: SceneDocument): { width: number; height: number } {
  const config = scene.data.nodes.find(node => node.kind === 'world-config')
  const coordinates = record(record(config?.data)?.coordinateSystem)
  return {
    width: Math.max(1, Math.round(number(coordinates?.width, 1280))),
    height: Math.max(1, Math.round(number(coordinates?.height, 720))),
  }
}

function layerOrder(scene: SceneDocument): Map<string, number> {
  const config = scene.data.nodes.find(node => node.kind === 'world-config')
  const layers = record(config?.data)?.layers
  if (!Array.isArray(layers)) return new Map()
  return new Map(layers.flatMap((value, index) => {
    const layer = record(value)
    const id = text(layer?.id)
    return id ? [[id, number(layer?.order, index)] as const] : []
  }))
}

async function firstSpriteFrame(input: {
  workspacePath: string
  resource: BeeGameProjectResource
  member: string
  bytes: Buffer
  node: SceneNode
}): Promise<Buffer> {
  const tablePath = input.resource.file_paths.find(path => stem(path) === input.member && extname(path).toLowerCase() === '.json')
  if (!tablePath) return input.bytes
  try {
    const table = JSON.parse(await readFile(resolve(input.workspacePath, tablePath), 'utf8')) as RecordValue
    const frameWidth = number(table.frameWidth, 0)
    const frameHeight = number(table.frameHeight, 0)
    const framesPerFacing = Math.max(1, Math.floor(number(table.framesPerFacing, 1)))
    if (!frameWidth || !frameHeight) return input.bytes
    const facings = Array.isArray(table.facings) ? table.facings.filter(value => typeof value === 'string') : []
    const facing = text(record(input.node.data)?.initialFacing) ?? facings[0]
    const facingIndex = Math.max(0, facings.indexOf(facing))
    return sharp(input.bytes)
      .extract({ left: facingIndex * framesPerFacing * frameWidth, top: 0, width: frameWidth, height: frameHeight })
      .png()
      .toBuffer()
  } catch {
    return input.bytes
  }
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
  for (const document of audit.package.documents) {
    if (document.kind !== 'scene-2d') continue
    const size = canvasSize(document)
    const layers = layerOrder(document)
    const nodes = new Map(document.data.nodes.map(node => [node.id, node]))
    const worldPosition = (node: SceneNode): { x: number; y: number } => {
      const local = localPosition(node)
      const parent = node.parentId ? nodes.get(node.parentId) : undefined
      if (!parent) return local
      const origin = worldPosition(parent)
      return { x: origin.x + local.x, y: origin.y + local.y }
    }
    const composites: sharp.OverlayOptions[] = []
    const ordered = [...document.data.nodes].sort((left, right) => {
      const leftLayer = left.layer ? layers.get(left.layer) ?? 0 : 0
      const rightLayer = right.layer ? layers.get(right.layer) ?? 0 : 0
      return leftLayer - rightLayer || (left.zIndex ?? 0) - (right.zIndex ?? 0)
    })
    for (const node of ordered) {
      if (!node.assetRef || !visibleInDefaultState(node)) continue
      const resource = resources.get(node.assetRef)
      if (!resource || resource.status !== 'verified') continue
      const member = inferredMember(node, resource)
      const path = resourcePath(resource, member)
      if (!path || !/\.(?:png|jpe?g|webp|gif|avif)$/iu.test(path)) continue
      try {
        const sourceBytes = await readFile(resolve(workspacePath, path))
        const bytes = member
          ? await firstSpriteFrame({ workspacePath, resource, member, bytes: sourceBytes, node })
          : sourceBytes
        const dimensions = nodeSize(node)
        const anchor = nodeAnchor(node)
        const position = worldPosition(node)
        const alpha = Math.max(0, Math.min(1, number(record(node.data)?.alpha, 1)))
        const rendered = await sharp(bytes)
          .resize(dimensions.width, dimensions.height, { fit: 'fill' })
          .ensureAlpha(alpha)
          .png()
          .toBuffer()
        composites.push({
          input: rendered,
          left: Math.round(position.x - anchor.x * dimensions.width),
          top: Math.round(position.y - anchor.y * dimensions.height),
          blend: text(record(node.data)?.blend) === 'additive' ? 'screen' : 'over',
        })
      } catch {
        // A preview is advisory; deterministic package validation remains the
        // authority for malformed or missing assets.
      }
    }
    const outputPath = join(outputRoot, `${document.id}.png`)
    await sharp({ create: { width: size.width, height: size.height, channels: 4, background: '#181a20' } })
      .composite(composites)
      .png()
      .toFile(outputPath)
    outputs.push(outputPath)
  }
  return outputs
}
