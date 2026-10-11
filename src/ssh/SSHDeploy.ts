import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { distRoot } from '../utils/distRoot.js'
import { logForDebugging } from 'src/utils/debug.js'

const SSH_TIMEOUT_MS = 60_000
const REMOTE_BIN_DIR = '~/.local/bin'
const REMOTE_BUILD_DIR = '~/.local/share/bee-game-studio'
const REMOTE_WRAPPER = 'bee-game-studio'

export interface DeployOptions {
  host: string
  remotePlatform: string
  remoteArch: string
  localVersion: string
  onProgress?: (msg: string) => void
}

async function runSshCommand(
  host: string,
  command: string,
  timeoutMs = SSH_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['ssh', '-o', 'ConnectTimeout=10', '--', host, command], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const timer = setTimeout(() => proc.kill(), timeoutMs)

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}

export function findLocalBuildDirectory(root = distRoot): string {
  const directory = existsSync(join(root, 'cli-bun.js')) ? root : join(root, 'dist')
  const entry = join(directory, 'cli.js')
  if (!existsSync(entry)) throw new Error('Cannot find a built BGS CLI to deploy. Run bun run build first.')
  const generation = readFileSync(entry, 'utf8').match(/^import\s+["']\.\/(build-[\w-]+)\/cli\.js["']/)?.[1]
  const build = generation ? join(directory, generation) : directory
  if (!existsSync(join(build, 'cli-bun.js'))) throw new Error('BGS build is incomplete: cli-bun.js is missing.')
  return build
}

export async function deployBinary(options: DeployOptions): Promise<string> {
  const { host, remotePlatform, remoteArch, localVersion, onProgress } = options

  if (remotePlatform !== 'linux' && remotePlatform !== 'darwin') {
    throw new Error(
      `Remote platform "${remotePlatform}" is not supported. Only linux and darwin are supported.`,
    )
  }
  if (!['x64', 'arm64'].includes(remoteArch)) throw new Error(`Unsupported remote architecture: ${remoteArch}`)

  logForDebugging(
    `[SSHDeploy] deploying to ${host} (${remotePlatform}/${remoteArch}, v${localVersion})`,
  )

  const localBuild = findLocalBuildDirectory()
  const generation = 'build-' + randomUUID()
  logForDebugging(`[SSHDeploy] local build: ${localBuild}`)

  onProgress?.('Creating remote directory...')
  const mkdirResult = await runSshCommand(host, `mkdir -p ${REMOTE_BIN_DIR} ${REMOTE_BUILD_DIR}`)
  if (mkdirResult.exitCode !== 0) {
    throw new Error(`Failed to create remote directory: ${mkdirResult.stderr}`)
  }

  onProgress?.('Uploading binary...')
  const remotePath = `${REMOTE_BUILD_DIR}/${generation}`
  const scpProc = Bun.spawn(
    ['scp', '-r', '-o', 'ConnectTimeout=10', '--', localBuild, `${host}:${remotePath}`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const scpTimer = setTimeout(() => scpProc.kill(), SSH_TIMEOUT_MS)
  let scpStderr: string
  let scpExit: number
  try {
    const output = await Promise.all([new Response(scpProc.stdout).text(), new Response(scpProc.stderr).text(), scpProc.exited])
    scpStderr = output[1]
    scpExit = output[2]
  } finally { clearTimeout(scpTimer) }

  if (scpExit !== 0) {
    throw new Error(`SCP upload failed (exit ${scpExit}): ${scpStderr.trim()}`)
  }

  // --help does not load Grep/Glob. Install and execute the remote platform's
  // search binary before publishing the wrapper, using the existing installer.
  onProgress?.('Preparing remote search tools...')
  const search = await runSshCommand(host, `bun ${remotePath}/scripts/postinstall.cjs --required && ${remotePath}/vendor/ripgrep/${remoteArch}-${remotePlatform}/rg --version`, 180_000)
  if (search.exitCode !== 0) throw new Error(`Remote ripgrep installation/verification failed; existing wrapper preserved: ${search.stderr}`)

  // Install declared external modules for the remote platform (never copy
  // local node_modules/native binaries from a different OS or architecture).
  if (existsSync(join(localBuild, 'package.json'))) {
    onProgress?.('Installing remote runtime dependencies...')
    const dependencies = await runSshCommand(host,
      `bun install --production --ignore-scripts --cwd ${remotePath}`, 180_000)
    if (dependencies.exitCode !== 0) throw new Error(`Remote runtime dependency installation failed: ${dependencies.stderr}`)
  }

  // Verify full startup before changing the stable wrapper. --version alone
  // would not catch missing external modules loaded by the CLI.
  const startup = await runSshCommand(host, `bun ${remotePath}/cli-bun.js --help`)
  if (startup.exitCode !== 0) throw new Error(`Remote BGS startup failed; existing wrapper preserved: ${startup.stderr}`)

  onProgress?.('Installing wrapper script...')
  const temporaryWrapper = `${REMOTE_BIN_DIR}/.${REMOTE_WRAPPER}-${generation}`
  const wrapperScript = [
    'set -e',
    `trap 'rm -f ${temporaryWrapper}' EXIT`,
    `cat > ${temporaryWrapper} << 'WRAPPER'`,
    '#!/bin/sh',
    `exec bun "$HOME/.local/share/bee-game-studio/${generation}/cli-bun.js" "$@"`,
    'WRAPPER',
    `chmod +x ${temporaryWrapper}`,
    `${temporaryWrapper} --version`,
    `mv -f ${temporaryWrapper} ${REMOTE_BIN_DIR}/${REMOTE_WRAPPER}`,
  ].join('\n')

  const wrapperResult = await runSshCommand(host, wrapperScript)
  if (wrapperResult.exitCode !== 0) {
    throw new Error(`Failed to install wrapper script: ${wrapperResult.stderr}`)
  }

  onProgress?.('Verifying installation...')
  const verifyResult = await runSshCommand(
    host,
    `${REMOTE_BIN_DIR}/${REMOTE_WRAPPER} --version`,
  )
  if (verifyResult.exitCode !== 0) {
    throw new Error(
      `Binary deployed but verification failed (exit ${verifyResult.exitCode}): ${verifyResult.stderr}`,
    )
  }

  logForDebugging(
    `[SSHDeploy] deployed successfully, remote version: ${verifyResult.stdout}`,
  )
  onProgress?.(`Deployed v${verifyResult.stdout}`)

  return `${REMOTE_BIN_DIR}/${REMOTE_WRAPPER}`
}
