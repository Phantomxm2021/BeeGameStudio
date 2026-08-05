import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  BEEGAME_RESOURCE_ROOTS,
  readBeeGameAssetManifest,
  registerBeeGameAuthoredResources,
} from './asset-contracts'

export type ProvisionalResourceRequest = {
  id: string
  destinationPath: string
  format: string
  reason: string
  selectionReason: string[]
  assetKind: string
  capabilities?: string[]
  parameters?: Record<string, unknown>
}

export type ProvisionalResourceAdapter = {
  format: string
  description: string
  author(input: { assetKind: string; parameters?: Record<string, unknown> }): {
    bytes: Uint8Array | string
    descriptor: Record<string, unknown>
    technicalFacts: Record<string, string | number | boolean>
  }
}

export async function authorProvisionalResources(input: {
  workspacePath: string
  resources: ProvisionalResourceRequest[]
  adapters: readonly ProvisionalResourceAdapter[]
}) {
  const adapters = input.adapters
  if (!adapters.length)
    throw new Error('The active target did not register provisional resource adapters')
  const adapterByFormat = new Map(
    adapters.map(adapter => [adapter.format, adapter]),
  )
  if (adapterByFormat.size !== adapters.length)
    throw new Error('Provisional resource adapter formats must be unique')

  const workspaceRoot = resolve(input.workspacePath)
  const runtimeRoot = resolve(workspaceRoot, BEEGAME_RESOURCE_ROOTS.runtime)
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const establishedFormats = new Set(
    manifest.project_target?.asset_format_capabilities ?? [],
  )
  const ids = new Set<string>()
  const paths = new Set<string>()
  const authored = input.resources.map(resource => {
    if (ids.has(resource.id))
      throw new Error(`Provisional resource ids must be unique: ${resource.id}`)
    if (paths.has(resource.destinationPath))
      throw new Error(
        `Provisional resource paths must be unique: ${resource.destinationPath}`,
      )
    ids.add(resource.id)
    paths.add(resource.destinationPath)
    if (!establishedFormats.has(resource.format))
      throw new Error(
        `The canonical resource plan does not allow format: ${resource.format}`,
      )
    const adapter = adapterByFormat.get(resource.format)
    if (!adapter)
      throw new Error(
        `No provisional resource adapter is registered for format: ${resource.format}`,
      )
    const absolutePath = resolve(workspaceRoot, resource.destinationPath)
    const runtimeRelative = relative(runtimeRoot, absolutePath)
    if (
      runtimeRelative === '' ||
      runtimeRelative.startsWith('..') ||
      isAbsolute(runtimeRelative)
    )
      throw new Error(
        `Provisional resource path is outside ${BEEGAME_RESOURCE_ROOTS.runtime}: ${resource.destinationPath}`,
      )
    if (
      extname(resource.destinationPath).slice(1).toLowerCase() !==
      resource.format
    )
      throw new Error(
        `Provisional resource format does not match destination_path: ${resource.destinationPath}`,
      )
    return { resource, absolutePath, output: adapter.author(resource) }
  })

  const snapshots: Array<{ path: string; previous?: Uint8Array }> = []
  try {
    for (const item of authored) {
      snapshots.push({
        path: item.absolutePath,
        ...(existsSync(item.absolutePath)
          ? { previous: new Uint8Array(await readFile(item.absolutePath)) }
          : {}),
      })
      await mkdir(dirname(item.absolutePath), { recursive: true })
      await writeFile(item.absolutePath, item.output.bytes)
    }
    return await registerBeeGameAuthoredResources(
      input.workspacePath,
      authored.map(({ resource, output }) => ({
        id: resource.id,
        root_path: resource.destinationPath,
        file_paths: [resource.destinationPath],
        provisional: true,
        reason: resource.reason,
        selection_reason: resource.selectionReason,
        asset_kind: resource.assetKind,
        ...(resource.capabilities
          ? { capabilities: resource.capabilities }
          : {}),
        content_profile: {
          packaging: 'self-contained',
          components: [],
          provisional: {
            format: resource.format,
            ...output.descriptor,
          },
        },
        technical_facts: output.technicalFacts,
        replace_existing_provisional: true,
      })),
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

const PLACEHOLDER_COLORS = {
  cyan: [0.13, 0.82, 0.92, 1],
  amber: [0.95, 0.62, 0.12, 1],
  green: [0.22, 0.78, 0.42, 1],
  red: [0.9, 0.2, 0.24, 1],
  violet: [0.58, 0.34, 0.9, 1],
  neutral: [0.55, 0.58, 0.62, 1],
} as const

export function compactPlaceholderGltf(
  colorName: keyof typeof PLACEHOLDER_COLORS,
): string {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ])
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2,
    6, 7, 2, 7, 3, 4, 0, 3, 4, 3, 7,
  ])
  const bytes = Buffer.alloc(positions.byteLength + indices.byteLength)
  Buffer.from(positions.buffer).copy(bytes, 0)
  Buffer.from(indices.buffer).copy(bytes, positions.byteLength)
  return `${JSON.stringify({
    asset: { version: '2.0', generator: 'BeeGame provisional adapter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, extras: { provisional: true } }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: PLACEHOLDER_COLORS[colorName],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    buffers: [
      {
        byteLength: bytes.byteLength,
        uri: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: positions.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 36,
        type: 'SCALAR',
        min: [0],
        max: [7],
      },
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
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, Buffer.from(data)])),
    8 + data.byteLength,
  )
  return chunk
}

export function compactPlaceholderPng(
  colorName: keyof typeof PLACEHOLDER_COLORS,
): Buffer {
  const size = 16
  const [red, green, blue] = PLACEHOLDER_COLORS[colorName]
  const foreground = [red, green, blue, 1].map(channel =>
    Math.round(channel * 255),
  )
  const background = [32, 36, 43, 255]
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4
      raw.set(x < 7 === y < 7 ? foreground : background, offset)
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

export function compactPlaceholderWav(cueIds: readonly string[]): Buffer {
  const sampleRate = 44_100
  const samplesPerCue = Math.round(sampleRate / 2)
  const pcm = Buffer.alloc(samplesPerCue * cueIds.length * 2)
  const fadeSamples = Math.round(sampleRate * 0.02)
  for (let cueIndex = 0; cueIndex < cueIds.length; cueIndex += 1) {
    const frequency = 220 + (cueIndex % 8) * 44
    for (let index = 0; index < samplesPerCue; index += 1) {
      const fade = Math.min(
        1,
        index / fadeSamples,
        (samplesPerCue - 1 - index) / fadeSamples,
      )
      const sample = Math.round(
        Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 4_096 * fade,
      )
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
  const chunks = [
    riffChunk('fmt ', format),
    riffChunk('data', pcm),
    riffChunk('cue ', cueTable),
    riffChunk('LIST', Buffer.concat([Buffer.from('adtl', 'ascii'), ...labels])),
  ]
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(
    4 + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    4,
  )
  header.write('WAVE', 8, 4, 'ascii')
  return Buffer.concat([header, ...chunks])
}
