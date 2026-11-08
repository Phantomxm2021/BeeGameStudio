import { readdir, unlink, realpath } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { object, boolean, string, array } from 'zod/v4'
import type { BgsClient } from './client'

const pluginName = 'bgs-game-development'
const pluginId = pluginName + '@bgs-professional'
const skillSetting = object({ path: string().optional(), name: string().optional(), enabled: boolean() })
const featureSettings = object({
  skills: object({ config: array(skillSetting).optional() }).nullable().optional(),
  features: object({ plugins: boolean().optional() }).optional(),
  plugins: object({ [pluginId]: object({ enabled: boolean().optional() }).optional() }).optional(),
  marketplaces: object({ 'bgs-professional': object({ source_type: string(), source: string() }).optional() }).optional(),
})

// Native configuration can retain paths that were moved or removed. Resolve
// existing aliases like native Skill selectors; keep missing selectors unchanged.
async function configuredPath(path: string) {
  try { return await realpath(path) }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return path
    throw error
  }
}

/** Prepare the account's native plugin before starting/resuming any Agent thread.
 * Native code owns installation, cache paths, discovery and explicit opt-outs. */
export async function configureBgsSkills(client: Pick<BgsClient, 'requestNative'>, home: string, builtins: string) {
  const configuration = await client.requestNative('config/read', { includeLayers: true })
  const userRules: Array<{path?:string;name?:string;enabled:boolean}> = []
  let pluginsEnabled = true, installationAllowed = true
  for (const layer of [...configuration.layers ?? []].reverse()) if (!layer.disabledReason) {
    const settings = featureSettings.parse(layer.config)
    pluginsEnabled = settings.features?.plugins ?? pluginsEnabled
    installationAllowed = settings.plugins?.[pluginId]?.enabled ?? installationAllowed
    if (layer.name.type === 'user') for (const rule of settings.skills?.config ?? [])
      userRules.push(rule.path ? { ...rule, path: await configuredPath(rule.path) } : rule)
  }

  const roots = new Set<string>()
  if (pluginsEnabled) {
    const source = builtins
    const existing = featureSettings.parse(configuration.config).marketplaces?.['bgs-professional']
    const sameSource = existing?.source_type === 'local' && await configuredPath(existing.source) === source
    const marketplace = sameSource
      ? { installedRoot: existing.source }
      : await client.requestNative('marketplace/add', { source })
    const request = { marketplacePath: join(marketplace.installedRoot, '.agents/plugins/marketplace.json'), pluginName }
    let { plugin } = await client.requestNative('plugin/read', request)
    // Reinstalling would re-enable a disabled plugin and replace its cache. An
    // existing installation belongs to native configuration, including on resume.
    if (!plugin.summary.installed && installationAllowed) {
      await client.requestNative('plugin/install', request)
      ;({ plugin } = await client.requestNative('plugin/read', request))
    }
    // plugin/read describes source files. Only skills/list advertises the
    // installed paths used by the Agent; grant this package's current files.
    let catalog = await client.requestNative('skills/list', { forceReload: true })
    let migrated = false
    for (const entry of catalog.data) for (const skill of entry.skills) if (skill.pluginId === pluginId) {
      // Preserve old explicit choices when native Plugin names and paths change.
      // Persist a native name selector once; newer qualified choices take priority.
      if (userRules.some(rule => rule.name === skill.name || rule.path === skill.path)) continue
      const sourcePath = join(builtins, relative(dirname(dirname(skill.path)), skill.path))
      const old = userRules.findLast(rule => rule.path === sourcePath || rule.name === skill.name.slice(pluginName.length + 1))
      if (!old) continue
      await client.requestNative('skills/config/write', { name: skill.name, enabled: old.enabled })
      migrated = true
    }
    if (migrated) catalog = await client.requestNative('skills/list', { forceReload: true })
    for (const entry of catalog.data) for (const skill of entry.skills)
      if (skill.pluginId === pluginId && skill.enabled)
        roots.add(await realpath(dirname(dirname(skill.path))))
  }
  // Retire only the former managed discovery links, not user/system Skills.
  const directory = join(home, 'skills')
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || (!entry.name.startsWith('bgs-builtin-') && !entry.name.startsWith('bgs-user-'))) continue
    await unlink(join(directory, entry.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  return { configuration, readRoots: [...roots] }
}
