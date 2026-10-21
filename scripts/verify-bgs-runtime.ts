import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bgsCommand } from '../packages/agent-workflow-server/src/bgs/client'

await import('./check-bgs')
const home = await mkdtemp(join(tmpdir(), 'bgs-brand-smoke-'))
const command = bgsCommand()
let explicitHome: string | undefined = home
const run = async (...args: string[]) => {
  // Fresh, credential-free home; these commands never submit an agent turn.
  const child = Bun.spawn([...command, ...args], { cwd: home,
    env: { PATH: process.env.PATH, HOME: home, ...(explicitHome ? { BGS_HOME: explicitHome } : {}) }, stdout: 'pipe', stderr: 'pipe' })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, text: out + err }
}
try {
  const help = await run('--help')
  if (help.code !== 0 || !help.text.includes('BGS CLI') || !help.text.includes('Usage: bgs ')) throw Error('BGS CLI branding missing')
  for (const args of [['exec', '--help'], ['sandbox', '--help'], ['app-server', '--help'], ['plugin', '--help']]) {
    const result = await run(...args)
    if (result.code !== 0 || !result.text.includes('Usage: bgs ')) throw Error(`Branded command failed: ${args.join(' ')}`)
  }
  const completion = await run('completion', 'bash')
  if (completion.code !== 0 || !completion.text.includes('_bgs')) throw Error('BGS completion is missing')
  for (const args of [['update'], ['app-server', 'daemon', 'update']]) {
    const update = await run(...args)
    if (update.code === 0 || !update.text.includes('BGS updates are managed from source')) throw Error('BGS must not self-replace with an official binary')
  }
  // Install a tiny local third-party-format plugin. No remote marketplace or model.
  const market = join(home, 'marketplace'), plugin = join(market, 'plugins', 'sample')
  await mkdir(join(market, '.agents', 'plugins'), { recursive: true })
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
  await writeFile(join(market, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'offline',
    plugins: [{ name: 'sample', source: { source: 'local', path: './plugins/sample' } }] }))
  await writeFile(join(plugin, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }))
  explicitHome = undefined
  const added = await run('-c', 'features.plugins=true', 'plugin', 'marketplace', 'add', market, '--json')
  if (added.code !== 0) throw Error('Local marketplace setup failed: ' + added.text)
  const defaultHome = join(home, '.bgs')
  if (!(await readFile(join(defaultHome, 'config.toml'), 'utf8')).includes('offline')) throw Error('Default ~/.bgs config was not written')
  explicitHome = defaultHome
  const installed = await run('-c', 'features.plugins=true', 'plugin', 'add', 'sample@offline')
  if (installed.code !== 0) throw Error('Local plugin installation failed: ' + installed.text)
  const files = await readdir(join(defaultHome, 'plugins'), { recursive: true })
  if (!files.some(path => path.endsWith('plugin.json'))) throw Error('Installed plugin was not stored under BGS_HOME/plugins')
  if (await access(join(home, '.codex')).then(() => true, () => false)) throw Error('BGS unexpectedly created an old default home')
  const removed = await run('-c', 'features.plugins=true', 'plugin', 'remove', 'sample@offline')
  if (removed.code !== 0) throw Error('Local plugin removal failed: ' + removed.text)
  console.log('BGS local smoke passed: default/explicit home, local plugin install/remove, version, help, subcommands, completion, safe update entry. No model requests.')
} finally { await rm(home, { recursive: true, force: true }) }
