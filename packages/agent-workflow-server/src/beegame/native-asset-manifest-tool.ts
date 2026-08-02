import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { deflateSync } from 'node:zlib'
import { z } from 'zod/v4'
import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
  parseCanonicalBeeGameAssetManifest,
  readBeeGameAssetManifest,
  registerBeeGameAuthoredResources,
  removeBeeGameUnboundResources,
  writeBeeGameAssetManifest,
} from './asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from './content-contracts'

const projectTargetSchema = z.object({
  platform: z.string().trim().min(1).optional(),
  runtime: z.string().trim().min(1).optional(),
  asset_format_capabilities: z.array(z.string().trim().min(1)).min(1),
}).strict()

const requirementSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  purpose: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
}).strict()

const authoredResourceSchema = z.object({
  id: z.string().trim().min(1),
  root_path: z.string().trim().min(1),
  file_paths: z.array(z.string().trim().min(1)).min(1),
  provisional: z.boolean(),
  reason: z.string().trim().min(1),
  selection_reason: z.array(z.string().trim().min(1)).min(1).max(8),
  asset_kind: z.string().trim().min(1).optional(),
  capabilities: z.array(z.string().trim().min(1)).min(1).optional(),
  content_profile: z.record(z.string(), z.unknown()).optional(),
  technical_facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict()

const encodedAuthoredResourceSchema = authoredResourceSchema.extend({
  files: z.array(z.object({
    path: z.string().trim().min(1),
    base64: z.string().min(1).base64(),
  }).strict()).min(1).max(64),
}).strict()

const provisionalResourceSchema = z.object({
  id: z.string().trim().min(1),
  destination_path: z.string().trim().min(1),
  format: z.enum(['gltf', 'png', 'wav']),
  reason: z.string().trim().min(1),
  selection_reason: z.array(z.string().trim().min(1)).min(1).max(8),
  asset_kind: z.enum(['model', 'image', 'texture', 'sprite', 'ui-document', 'audio-cue', 'audio-bank']),
  capabilities: z.array(z.string().trim().min(1)).min(1).optional(),
  color: z.enum(['cyan', 'amber', 'green', 'red', 'violet', 'neutral']).optional(),
  cue_ids: z.array(z.string().trim().min(1)).min(1).max(32).optional(),
}).strict()

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit_resource_plan'),
    project_target: projectTargetSchema,
    requirements: z.array(requirementSchema).min(1).max(256),
  }).strict(),
  z.object({
    action: z.literal('register_authored_resources'),
    resources: z.array(authoredResourceSchema).min(1).max(64),
  }).strict(),
  z.object({
    action: z.literal('author_encoded_resources'),
    resources: z.array(encodedAuthoredResourceSchema).min(1).max(64),
  }).strict(),
  z.object({
    action: z.literal('author_provisional_resources'),
    resources: z.array(provisionalResourceSchema).min(1).max(64),
  }).strict(),
  z.object({
    action: z.literal('prune_unbound_resources'),
    resource_ids: z.array(z.string().trim().min(1)).min(1).max(64),
  }).strict(),
])

type AssetManifestInput = z.infer<typeof inputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown

async function submitResourcePlan(
  workspacePath: string,
  resourceLibraryUsage: ResourceLibraryUsage,
  input: Extract<AssetManifestInput, { action: 'submit_resource_plan' }>,
) {
  const projectTarget = {
    ...input.project_target,
    resource_library_usage: resourceLibraryUsage,
    runtime_asset_root: BEEGAME_RESOURCE_ROOTS.runtime,
    content_root: BEEGAME_RESOURCE_ROOTS.content,
    generated_asset_root: BEEGAME_RESOURCE_ROOTS.generated,
  }
  const path = join(workspacePath, 'assets', 'asset-manifest.json')
  if (!existsSync(path)) {
    const manifest = parseCanonicalBeeGameAssetManifest({
      version: CURRENT_ASSET_MANIFEST_VERSION,
      project_target: projectTarget,
      requirements: input.requirements,
      resources: [],
    })
    await writeBeeGameAssetManifest(workspacePath, manifest)
    return manifest
  }
  const existing = await readBeeGameAssetManifest(workspacePath)
  if (!isDeepStrictEqual(existing.project_target, projectTarget))
    throw new Error('An established resource plan cannot change project_target in place.')
  const submitted = new Set(input.requirements.map(item => item.id))
  const omitted = existing.requirements.map(item => item.id).filter(id => !submitted.has(id))
  if (omitted.length)
    throw new Error(`Resource plan cannot silently remove requirement identities: ${omitted.join(', ')}.`)
  const manifest = parseCanonicalBeeGameAssetManifest({
    ...existing,
    requirements: input.requirements,
  })
  await writeBeeGameAssetManifest(workspacePath, manifest)
  return manifest
}

async function authorEncodedResources(
  workspacePath: string,
  resources: Array<z.infer<typeof encodedAuthoredResourceSchema>>,
) {
  const workspaceRoot = resolve(workspacePath)
  const runtimeRoot = resolve(workspaceRoot, BEEGAME_RESOURCE_ROOTS.runtime)
  const authored = resources.map(resource => {
    const declaredPaths = new Set(resource.file_paths)
    const suppliedPaths = new Set(resource.files.map(file => file.path))
    if (
      declaredPaths.size !== suppliedPaths.size ||
      [...declaredPaths].some(path => !suppliedPaths.has(path))
    )
      throw new Error(`Encoded files must exactly match file_paths for ${resource.id}.`)
    for (const file of resource.files) {
      const absolutePath = resolve(workspaceRoot, file.path)
      const projectRelative = relative(workspaceRoot, absolutePath)
      const runtimeRelative = relative(runtimeRoot, absolutePath)
      if (
        projectRelative === '' ||
        projectRelative.startsWith('..') ||
        isAbsolute(projectRelative) ||
        runtimeRelative === '' ||
        runtimeRelative.startsWith('..') ||
        isAbsolute(runtimeRelative)
      )
        throw new Error(`Encoded resource path is outside ${BEEGAME_RESOURCE_ROOTS.runtime}: ${file.path}.`)
      if (Buffer.from(file.base64, 'base64').byteLength === 0)
        throw new Error(`Encoded resource file must not be empty: ${file.path}.`)
    }
    const { files: _files, ...input } = resource
    return input
  })
  for (const resource of resources) {
    for (const file of resource.files) {
      const absolutePath = resolve(workspaceRoot, file.path)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, Buffer.from(file.base64, 'base64'))
    }
  }
  return registerBeeGameAuthoredResources(workspacePath, authored)
}

const PLACEHOLDER_COLORS = {
  cyan: [0.13, 0.82, 0.92, 1],
  amber: [0.95, 0.62, 0.12, 1],
  green: [0.22, 0.78, 0.42, 1],
  red: [0.9, 0.2, 0.24, 1],
  violet: [0.58, 0.34, 0.9, 1],
  neutral: [0.55, 0.58, 0.62, 1],
} as const

function compactPlaceholderGltf(colorName: keyof typeof PLACEHOLDER_COLORS): string {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ])
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 4, 0, 3, 4, 3, 7,
  ])
  const bytes = Buffer.alloc(positions.byteLength + indices.byteLength)
  Buffer.from(positions.buffer).copy(bytes, 0)
  Buffer.from(indices.buffer).copy(bytes, positions.byteLength)
  return `${JSON.stringify({
    asset: { version: '2.0', generator: 'BeeGame AssetManifest' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, extras: { provisional: true } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: PLACEHOLDER_COLORS[colorName], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR', min: [0], max: [7] },
    ],
  })}\n`
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength)
  return chunk
}

function compactPlaceholderPng(colorName: keyof typeof PLACEHOLDER_COLORS): Buffer {
  const size = 16
  const [red, green, blue] = PLACEHOLDER_COLORS[colorName]
  const foreground = [red, green, blue, 1].map(channel => Math.round(channel * 255))
  const background = [32, 36, 43, 255]
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4
      const pixel = (x < 7) === (y < 7) ? foreground : background
      raw.set(pixel, offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function riffChunk(type: string, data: Uint8Array): Buffer {
  const paddedLength = data.byteLength + (data.byteLength % 2)
  const chunk = Buffer.alloc(8 + paddedLength)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32LE(data.byteLength, 4)
  Buffer.from(data).copy(chunk, 8)
  return chunk
}

function compactPlaceholderWav(cueIds: readonly string[]): Buffer {
  const sampleRate = 44_100
  const samplesPerCue = Math.round(sampleRate / 2)
  const pcm = Buffer.alloc(samplesPerCue * cueIds.length * 2)
  const fadeSamples = Math.round(sampleRate * 0.02)
  for (let cueIndex = 0; cueIndex < cueIds.length; cueIndex += 1) {
    const frequency = 220 + (cueIndex % 8) * 44
    for (let index = 0; index < samplesPerCue; index += 1) {
      const fade = Math.min(1, index / fadeSamples, (samplesPerCue - 1 - index) / fadeSamples)
      const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 4_096 * fade)
      pcm.writeInt16LE(sample, (cueIndex * samplesPerCue + index) * 2)
    }
  }
  const format = Buffer.alloc(16)
  format.writeUInt16LE(1, 0)
  format.writeUInt16LE(1, 2)
  format.writeUInt32LE(sampleRate, 4)
  format.writeUInt32LE(sampleRate * 2, 8)
  format.writeUInt16LE(2, 12)
  format.writeUInt16LE(16, 14)
  const cueTable = Buffer.alloc(4 + cueIds.length * 24)
  cueTable.writeUInt32LE(cueIds.length, 0)
  cueIds.forEach((_id, index) => {
    const offset = 4 + index * 24
    cueTable.writeUInt32LE(index + 1, offset)
    cueTable.writeUInt32LE(index * samplesPerCue, offset + 4)
    cueTable.write('data', offset + 8, 4, 'ascii')
    cueTable.writeUInt32LE(0, offset + 12)
    cueTable.writeUInt32LE(0, offset + 16)
    cueTable.writeUInt32LE(index * samplesPerCue, offset + 20)
  })
  const labels = cueIds.map((id, index) => {
    const text = Buffer.from(`${id}\0`, 'utf8')
    const label = Buffer.alloc(4 + text.byteLength)
    label.writeUInt32LE(index + 1, 0)
    text.copy(label, 4)
    return riffChunk('labl', label)
  })
  const associatedData = Buffer.concat([Buffer.from('adtl', 'ascii'), ...labels])
  const chunks = [
    riffChunk('fmt ', format),
    riffChunk('data', pcm),
    riffChunk('cue ', cueTable),
    riffChunk('LIST', associatedData),
  ]
  const bodyLength = 4 + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(bodyLength, 4)
  header.write('WAVE', 8, 4, 'ascii')
  return Buffer.concat([header, ...chunks])
}

function provisionalTechnicalFacts(
  resource: z.infer<typeof provisionalResourceSchema>,
): Record<string, string | number | boolean> {
  if (resource.format === 'gltf')
    return {
      format: 'gltf',
      gltf_version: '2.0',
      bounds_width: 1,
      bounds_height: 1,
      bounds_depth: 1,
    }
  if (resource.format === 'png')
    return {
      format: 'png',
      width: 16,
      height: 16,
      color_space: 'srgb',
      alpha: true,
    }
  return {
    format: 'wav',
    sample_rate_hz: 44_100,
    channels: 1,
    bit_depth: 16,
    cue_count: resource.cue_ids?.length ?? 0,
    cue_duration_seconds: 0.5,
  }
}

async function authorProvisionalResources(
  workspacePath: string,
  resources: Array<z.infer<typeof provisionalResourceSchema>>,
  allowFormatExtension: boolean,
) {
  const workspaceRoot = resolve(workspacePath)
  const runtimeRoot = resolve(workspaceRoot, BEEGAME_RESOURCE_ROOTS.runtime)
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const establishedFormats = new Set(
    manifest.project_target?.asset_format_capabilities ?? [],
  )
  const additionalFormats = [
    ...new Set(resources.map(resource => resource.format)),
  ].filter(format => !establishedFormats.has(format))
  if (additionalFormats.length && !allowFormatExtension)
    throw new Error(
      `An established resource target does not allow: ${additionalFormats.join(', ')}. Format capabilities may be extended only by an accepted resource remediation replacement.`,
    )
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const resource of resources) {
    if (ids.has(resource.id)) throw new Error(`Provisional resource ids must be unique: ${resource.id}`)
    if (paths.has(resource.destination_path)) throw new Error(`Provisional resource paths must be unique: ${resource.destination_path}`)
    ids.add(resource.id)
    paths.add(resource.destination_path)
    const absolutePath = resolve(workspaceRoot, resource.destination_path)
    const runtimeRelative = relative(runtimeRoot, absolutePath)
    if (runtimeRelative === '' || runtimeRelative.startsWith('..') || isAbsolute(runtimeRelative))
      throw new Error(`Provisional resource path is outside ${BEEGAME_RESOURCE_ROOTS.runtime}: ${resource.destination_path}.`)
    const expectedExtension = resource.format
    if (extname(resource.destination_path).slice(1).toLowerCase() !== expectedExtension)
      throw new Error(`Provisional resource format does not match destination_path: ${resource.destination_path}.`)
    if (resource.format === 'gltf' && resource.asset_kind !== 'model')
      throw new Error(`glTF provisional resources must use asset_kind model: ${resource.id}.`)
    if (
      resource.format === 'png' &&
      !['image', 'texture', 'sprite', 'ui-document'].includes(resource.asset_kind)
    )
      throw new Error(`PNG provisional resources must use a visual asset_kind: ${resource.id}.`)
    if (
      resource.format === 'wav' &&
      !['audio-cue', 'audio-bank'].includes(resource.asset_kind)
    )
      throw new Error(`WAV provisional resources must use an audio asset_kind: ${resource.id}.`)
    if (resource.format === 'wav' && !resource.cue_ids?.length)
      throw new Error(`WAV provisional resources require cue_ids: ${resource.id}.`)
    if (resource.format !== 'wav' && resource.cue_ids)
      throw new Error(`cue_ids are only valid for WAV provisional resources: ${resource.id}.`)
  }
  const snapshots: Array<{ path: string; previous?: Uint8Array }> = []
  try {
    for (const resource of resources) {
      const absolutePath = resolve(workspaceRoot, resource.destination_path)
      snapshots.push({
        path: absolutePath,
        ...(existsSync(absolutePath)
          ? { previous: new Uint8Array(await readFile(absolutePath)) }
          : {}),
      })
      await mkdir(dirname(absolutePath), { recursive: true })
      const color = resource.color ?? 'neutral'
      const content =
        resource.format === 'gltf'
          ? compactPlaceholderGltf(color)
          : resource.format === 'png'
            ? compactPlaceholderPng(color)
            : compactPlaceholderWav(resource.cue_ids ?? [])
      await writeFile(absolutePath, content)
    }
    return await registerBeeGameAuthoredResources(
      workspacePath,
      resources.map(resource => ({
        id: resource.id,
        root_path: resource.destination_path,
        file_paths: [resource.destination_path],
        provisional: true,
        reason: resource.reason,
        selection_reason: resource.selection_reason,
        asset_kind: resource.asset_kind,
        ...(resource.capabilities
          ? { capabilities: resource.capabilities }
          : {}),
        content_profile: {
          packaging: 'self-contained',
          components: [],
          placeholder: {
            format: resource.format,
            ...(resource.format === 'wav'
              ? { cue_ids: resource.cue_ids }
              : { color: resource.color ?? 'neutral' }),
          },
        },
        technical_facts: provisionalTechnicalFacts(resource),
        replace_existing_provisional: true,
      })),
      { additionalFormatCapabilities: additionalFormats },
    )
  } catch (error) {
    await Promise.all(
      snapshots.map(async snapshot => {
        if (snapshot.previous) {
          await mkdir(dirname(snapshot.path), { recursive: true })
          await writeFile(snapshot.path, snapshot.previous)
        } else await rm(snapshot.path, { force: true })
      }),
    )
    throw error
  }
}

export function createNativeAssetManifestTool(options: {
  buildTool: BuildTool
  workspacePath: string
  resourceLibraryUsage: ResourceLibraryUsage
  allowResourceRemediationMutations?: boolean
}): unknown {
  return options.buildTool({
    name: 'AssetManifest',
    alwaysLoad: true,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return 'Create the canonical resource plan and author or register independently replaceable project resources.'
    },
    async prompt() {
      return [
        'AssetManifest is the only writer for assets/asset-manifest.json.',
        `submit_resource_plan creates canonical version 7 with requirements and resources only. The confirmed Resource Library policy is system-owned and fixed to ${options.resourceLibraryUsage}. The system also owns assets/runtime, assets/content and assets/generated as the three project roots. Do not provide or reinterpret policy or root paths.`,
        `Register downloaded material through Resource Library tools. Create missing placeholders only through author_provisional_resources; it deterministically authors and registers compact standalone glTF models, PNG visuals, or PCM WAV cue banks in one operation. Match destination extension and asset_kind to format; WAV requires the approved cue_ids and uses asset_kind audio-bank or audio-cue. Use author_encoded_resources only for independently supplied binary media. Generic file tools never write runtime_asset_root. A placeholder is provisional but uses the same stable resource identity and content references as a final asset.${options.allowResourceRemediationMutations ? ' This accepted resource remediation may add a replacement file extension while preserving every other project_target field, and may prune only unbound non-requirement inventory through prune_unbound_resources.' : ''}`,
        `Every content file uses schema ${BEEGAME_CONTENT_SCHEMA} plus id, kind, fulfills, resources and data. JSON owns resource mappings, entities, UI, audio, events, waves and numeric configuration; its allowed kinds are ${BEEGAME_JSON_CONTENT_KINDS.join(', ')}. YAML owns only world, scene, hierarchy and instance placement; its allowed kinds are ${BEEGAME_YAML_CONTENT_KINDS.join(', ')}. Do not duplicate one fact in JSON and YAML.`,
        'The manifest accepts only the declared v7 project target, requirements and resource records. Keep substitutable media out of gameplay source and keep engine-specific structures in project content or target adapters.',
      ].join(' ')
    },
    async checkPermissions(input: AssetManifestInput) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: AssetManifestInput) {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
      if (parsed.data.action === 'submit_resource_plan') {
        const manifest = await submitResourcePlan(
          options.workspacePath,
          options.resourceLibraryUsage,
          parsed.data,
        )
        return { data: { accepted: true, requirement_count: manifest.requirements.length } }
      }
      if (parsed.data.action === 'author_encoded_resources') {
        const manifest = await authorEncodedResources(
          options.workspacePath,
          parsed.data.resources,
        )
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            registered_resource_ids: parsed.data.resources.map(item => item.id),
          },
        }
      }
      if (parsed.data.action === 'author_provisional_resources') {
        const manifest = await authorProvisionalResources(
          options.workspacePath,
          parsed.data.resources,
          options.allowResourceRemediationMutations === true,
        )
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            registered_resource_ids: parsed.data.resources.map(item => item.id),
          },
        }
      }
      if (parsed.data.action === 'prune_unbound_resources') {
        if (!options.allowResourceRemediationMutations)
          throw new Error(
            'Inventory pruning is available only during an accepted resource remediation.',
          )
        const manifest = await removeBeeGameUnboundResources(
          options.workspacePath,
          parsed.data.resource_ids,
        )
        return {
          data: {
            accepted: true,
            resource_count: manifest.resources.length,
            pruned_resource_ids: parsed.data.resource_ids,
          },
        }
      }
      const manifest = await registerBeeGameAuthoredResources(options.workspacePath, parsed.data.resources)
      return {
        data: {
          accepted: true,
          resource_count: manifest.resources.length,
          registered_resource_ids: parsed.data.resources.map(item => item.id),
        },
      }
    },
    renderToolUseMessage(input: Partial<AssetManifestInput>) {
      return input.action ? `资源与内容 · ${input.action}` : '资源与内容'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}
