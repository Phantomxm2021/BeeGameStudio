import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Read retained dependencies without executing the model or requiring fresh inputs. */
export function readCalculationInputs(workspace: string, outputPath: string): string[] {
  const root = realpathSync(workspace), target = resolve(root, outputPath)
  if (isAbsolute(outputPath) || !inside(root, target) || realpathSync(target) !== target)
    throw Error('Result must be a non-symlink file inside the workspace')
  const body = readFileSync(target, 'utf8')
  const match = /\n<!-- bgs-calculation-v1:([A-Za-z0-9+/=]+) -->\n?$/.exec(body)
  if (!match) throw Error('No retained input record; freshness is unverified')
  const record = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  if (createHash('sha256').update(body.slice(0, match.index)).digest('hex') !== record.outputDigest) throw Error('Calculation output changed')
  if (!Array.isArray(record.sources) || !record.sources.length) throw Error('Input record has no sources')
  return record.sources.map((entry: unknown) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw Error('Invalid retained input path')
    const [path, source] = entry, target = resolve(root, path)
    if (!source || !/^[a-f0-9]{64}$/.test(source.digest) ||
        !['exact-bytes', 'design-body-without-version', 'scene-design-v1'].includes(source.scope)) throw Error('Invalid retained input identity')
    if (isAbsolute(path) || !inside(root, target) || relative(root, target).split(sep).join('/') !== path)
      throw Error('Invalid retained input path')
    // Missing inputs still identify an affected dependency; never authorize a symlink.
    try { if (realpathSync(target) !== target) throw Error('Retained input must not be a symlink: ' + path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return path
  })
}

export const BALANCE_CALCULATOR_PATH = '.beegame/delivery/calculate-balance.mjs'
