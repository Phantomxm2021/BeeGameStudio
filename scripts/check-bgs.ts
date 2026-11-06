import { bgsCommand } from '../packages/agent-workflow-server/src/bgs/client'
import { access, readFile, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'

const metadata = JSON.parse(await readFile(new URL('../dist/bgs-runtime/build.json', import.meta.url), 'utf8')
  .catch(() => { throw Error('BGS runtime is missing. Run bun run bgs:build first.') }))
if (metadata.platform !== process.platform || metadata.arch !== process.arch) {
  throw Error(`BGS runtime targets ${metadata.platform}/${metadata.arch}; build for ${process.platform}/${process.arch}`)
}
const command = bgsCommand()
const child = Bun.spawn(command.concat('--version'), { stdout: 'pipe', stderr: 'pipe' })
const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
if (code !== 0 || !metadata.version.startsWith('bgs ') || stdout.trim() !== metadata.version) {
  throw Error('BGS runtime version/brand mismatch. Rebuild with bun run bgs:build and check BEEGAME_BGS_PATH.')
}
const help = Bun.spawn(command.concat('--help'), { stdout: 'pipe', stderr: 'pipe' })
const [helpCode, helpText] = await Promise.all([help.exited, new Response(help.stdout).text(), new Response(help.stderr).text()])
if (helpCode !== 0 || !helpText.includes('~/.bgs/config.toml'))
  throw Error('BGS command or configuration-home packaging is missing')
const executable = await realpath(Bun.which(command[0]) ?? command[0])
const host = join(dirname(executable), process.platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host')
await access(host, constants.X_OK).catch(() => {
  throw Error('BGS code-mode host is missing or not executable: ' + host + '. Rebuild with bun run bgs:build.')
})
const hostHelp = Bun.spawn([host, '--help'], { stdout: 'pipe', stderr: 'pipe' })
const [hostCode, hostText] = await Promise.all([
  hostHelp.exited, new Response(hostHelp.stdout).text(), new Response(hostHelp.stderr).text(),
])
if (hostCode !== 0 || !hostText.includes('Usage: codex-code-mode-host') || !hostText.includes('--listen'))
  throw Error('BGS code-mode host could not start. Rebuild with bun run bgs:build.')
console.log(stdout.trim())
console.log(`Source: ${metadata.sourceCommit} (${metadata.upstreamTag}${metadata.dirty ? ', uncommitted changes' : ''})`)
