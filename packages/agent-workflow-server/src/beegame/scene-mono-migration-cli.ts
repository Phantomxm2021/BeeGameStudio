import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { migrateLegacyScene, type LegacySceneDocument } from './scene-mono-migration'

function usage(): never {
  throw new Error('Usage: bun scene-mono-migration-cli.ts <input-scene.json> <output-scene.json> --manifest <asset-manifest.json> [--force]')
}

export function readVerifiedAssetRefs(manifestPath: string): Set<string> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  resources?: Array<{ id?: unknown; status?: unknown }>
  modules?: { resources?: string[] }
  }
  const verifiedAssetRefs = new Set<string>((manifest.resources ?? [])
    .filter((resource) => resource.status === 'verified')
    .map((resource) => typeof resource.id === 'string' ? resource.id : undefined)
    .filter((id): id is string => Boolean(id)))
  for (const relativePath of manifest.modules?.resources ?? []) {
    const candidates = [
      resolve(dirname(manifestPath), relativePath),
      resolve(dirname(dirname(manifestPath)), relativePath),
    ]
    const resourcePath = candidates.find((candidate) => existsSync(candidate))
    if (!resourcePath) throw new Error(`Asset manifest resource does not exist: ${relativePath}`)
    const resource = JSON.parse(readFileSync(resourcePath, 'utf8')) as { id?: unknown; status?: unknown }
    if (resource.status === 'verified' && typeof resource.id === 'string') verifiedAssetRefs.add(resource.id)
  }
  return verifiedAssetRefs
}

if (import.meta.main) {
  const [, , inputArg, outputArg, ...flags] = process.argv
  const manifestFlag = flags.indexOf('--manifest')
  const manifestArg = manifestFlag >= 0 ? flags[manifestFlag + 1] : undefined
  if (!inputArg || !outputArg || !manifestArg) usage()

  const inputPath = resolve(inputArg)
  const outputPath = resolve(outputArg)
  const manifestPath = resolve(manifestArg)
  if (!existsSync(inputPath)) throw new Error(`Input scene does not exist: ${inputPath}`)
  if (!existsSync(manifestPath)) throw new Error(`Asset manifest does not exist: ${manifestPath}`)
  if (existsSync(outputPath) && !flags.includes('--force'))
    throw new Error(`Refusing to overwrite existing output: ${outputPath}. Pass --force explicitly.`)

  const input = JSON.parse(readFileSync(inputPath, 'utf8')) as LegacySceneDocument
  const result = migrateLegacyScene(input, { verifiedAssetRefs: readVerifiedAssetRefs(manifestPath) })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result.scene, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, report: result.report }, null, 2))
}
