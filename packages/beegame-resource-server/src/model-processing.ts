import { fileURLToPath } from 'node:url'

export type ResourceInspectionFacts = Record<string, string | number | boolean>
export type ResourceModelProcessor = (file: File) => Promise<ResourceInspectionFacts>

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

  return async (file) => {
    if (file.size > maxFileBytes) throw new Error(`Model exceeds processor limit (${maxFileBytes} bytes)`)
    const child = Bun.spawn([executable, workerPath, file.name], {
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
            reject(new Error(`Model processor timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        }),
      ])
      const [stdout, stderr] = await Promise.all([output, errorOutput])
      if (exitCode !== 0) throw new Error(safeProcessorMessage(stderr) || `Model processor exited with code ${exitCode}`)
      return parseProcessorFacts(stdout)
    } finally {
      if (timer) clearTimeout(timer)
    }
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
