import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bgsCommand } from './client'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const execute = promisify(execFile)

/** Reuse native metadata for the selected connection without advertising other
 * bundled models as provider capabilities. Without an advertised reviewer,
 * native approval review uses its existing parent-model fallback. */
export async function loadBgsModelCatalog(input: {
  cwd: string; env: Record<string, string>; command?: readonly string[]
}): Promise<string> {
  const [executable, ...args] = input.command ?? bgsCommand(input.env)
  if (!executable) throw Error('BGS executable is required')
  let stdout: string
  try {
    ({ stdout } = await execute(executable, [...args, 'debug', 'models', '--bundled'], {
      cwd: input.cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
      // This export needs no model credentials or connection configuration.
      env: { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: input.env.BGS_HOME },
    }))
  } catch { throw Error('BGS could not export its bundled model catalog') }
  let catalog: { models: Array<Record<string, unknown> & { slug: string }> }
  try {
    catalog = JSON.parse(stdout)
    if (!Array.isArray(catalog.models) || !catalog.models.length ||
        catalog.models.some(model => !model || typeof model.slug !== 'string' || !model.slug.trim()) ||
        new Set(catalog.models.map(model => model.slug)).size !== catalog.models.length) throw Error()
  } catch { throw Error('BGS returned an invalid bundled model catalog') }
  const model = input.env.BEEGAME_MODEL
  // An absent model uses the running CLI's native fallback. Do not copy its
  // instructions or turn unknown capabilities into an advertised catalog entry.
  const body = JSON.stringify({ ...catalog, models: catalog.models.filter(entry => entry.slug === model) })
  // The native provider-catalog reader has the same 1 MiB limit.
  if (Buffer.byteLength(body) > 1024 * 1024) throw Error('BGS model catalog exceeds the native size limit')
  return body
}
