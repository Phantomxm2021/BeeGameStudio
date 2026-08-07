import { fileURLToPath } from 'node:url'
import { renderResourceModelPreview, type ResourceModelPreviewGeometry } from './model-preview'

export type ResourceInspectionFacts = Record<string, string | number | boolean>
export type ResourceModelProcessor = (file: File) => Promise<ResourceInspectionFacts>
export type ResourceModelPreviewProcessor = (file: File) => Promise<File | undefined>

export function createSubprocessModelProcessor(options: {
  workerUrl?: URL
  timeoutMs?: number
  maxFileBytes?: number
  executable?: string
} = {}): ResourceModelProcessor {
  const workerPath = fileURLToPath(options.workerUrl ?? new URL('./model-processor-worker.ts', import.meta.url))
  const timeoutMs = options.timeoutMs ?? 120_000
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024 * 1024
  const executable = options.executable ?? process.execPath

  return async file => parseProcessorFacts(await runModelProcessorWorker(file, { executable, workerPath, timeoutMs, maxFileBytes }))
}

export function createSubprocessModelPreviewProcessor(options: {
  workerUrl?: URL
  timeoutMs?: number
  maxFileBytes?: number
  executable?: string
} = {}): ResourceModelPreviewProcessor {
  const workerPath = fileURLToPath(options.workerUrl ?? new URL('./model-processor-worker.ts', import.meta.url))
  const timeoutMs = options.timeoutMs ?? 120_000
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024 * 1024
  const executable = options.executable ?? process.execPath

  return async file => {
    const output = await runModelProcessorWorker(file, { executable, workerPath, timeoutMs, maxFileBytes, preview: true })
    const parsed = JSON.parse(output) as { geometry?: unknown }
    if (!parsed || typeof parsed !== 'object' || !isPreviewGeometry(parsed.geometry)) return undefined
    return renderResourceModelPreview(parsed.geometry)
  }
}

async function runModelProcessorWorker(
  file: File,
  options: { executable: string; workerPath: string; timeoutMs: number; maxFileBytes: number; preview?: boolean },
): Promise<string> {
  if (file.size > options.maxFileBytes) throw new Error(`Model exceeds processor limit (${options.maxFileBytes} bytes)`)
  const child = Bun.spawn([options.executable, options.workerPath, file.name, ...(options.preview ? ['--preview'] : [])], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    // The parser needs no Supabase, model-provider, or service credentials.
    // Do not leak the resource API process environment into the child.
    env: { PATH: process.env.PATH ?? '' },
  })
  const output = new Response(child.stdout).text()
  const errorOutput = new Response(child.stderr).text()
  child.stdin.write(new Uint8Array(await file.arrayBuffer()))
  child.stdin.end()

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const exitCode = await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill()
          reject(new Error(`Model processor timed out after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      }),
    ])
    const [stdout, stderr] = await Promise.all([output, errorOutput])
    if (exitCode !== 0) throw new Error(safeProcessorMessage(stderr) || `Model processor exited with code ${exitCode}`)
    return stdout
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parseProcessorFacts(value: string): ResourceInspectionFacts {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Model processor returned invalid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Model processor returned an invalid result')
  const facts: ResourceInspectionFacts = {}
  for (const [key, fact] of Object.entries(parsed)) {
    if (typeof fact !== 'string' && typeof fact !== 'number' && typeof fact !== 'boolean') throw new Error(`Model processor returned an invalid fact: ${key}`)
    if (typeof fact === 'number' && !Number.isFinite(fact)) throw new Error(`Model processor returned a non-finite fact: ${key}`)
    facts[key] = fact
  }
  return facts
}

function safeProcessorMessage(value: string): string {
  return value.trim().replaceAll('\n', ' ').slice(0, 500)
}

function isPreviewGeometry(value: unknown): value is ResourceModelPreviewGeometry {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { meshes?: unknown }).meshes)) return false
  return (value as { meshes: unknown[] }).meshes.every(mesh => {
    if (!mesh || typeof mesh !== 'object') return false
    const record = mesh as { vertices?: unknown; faces?: unknown }
    return Array.isArray(record.vertices) && record.vertices.every(point => isPoint(point))
      && Array.isArray(record.faces) && record.faces.every(face => Array.isArray(face) && face.length === 3 && face.every(index => typeof index === 'number' && Number.isInteger(index)))
  })
}

function isPoint(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
}
