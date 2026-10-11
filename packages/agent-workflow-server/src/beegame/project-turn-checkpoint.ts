import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

type Checkpoint = {
  version: 1
  clientMessageId: string
  sessionId: string
  nativeSessionId?: string
  nativeTranscriptPath?: string
  nativeTranscriptExisted: boolean
  deliveryStateExisted: boolean
  createdAt: string
  directory: string
}

const exists = async (path: string) => stat(path).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
  throw error
})

/** One pre-turn checkpoint per project. Backups of superseded work are retained separately. */
export function createProjectTurnCheckpointStore(dataRoot: string) {
  const root = resolve(dataRoot, 'project-turn-checkpoints')
  const recoveryMarker = (workspacePath: string) => join(root, 'recovery-required',
    createHash('sha256').update(resolve(workspacePath)).digest('hex') + '.json')
  async function assertRecovered(workspacePath: string): Promise<void> {
    if (await exists(recoveryMarker(await realpath(workspacePath))))
      throw new Error('Project recovery is incomplete; restore the retained backup before continuing')
  }
  const projectDirectory = (ownerId: string, workspacePath: string) => join(root,
    createHash('sha256').update(`${ownerId}\0${resolve(workspacePath)}`).digest('hex'))
  const copyTree = (source: string, destination: string) => cp(source, destination, {
    recursive: true, force: false, errorOnExist: true, mode: constants.COPYFILE_FICLONE,
    filter: path => {
      const child = relative(source, path)
      // Dependency caches are not authored content. Chat and runtime logs are
      // append-only audit records; rewinding them would corrupt live cursors.
      return !['node_modules', '.git', 'transcripts', join('.beegame', 'chat'), join('.beegame', 'logs')]
        .some(name => child === name || child.startsWith(`${name}${sep}`))
    },
  })

  async function read(ownerId: string, workspacePath: string): Promise<Checkpoint | undefined> {
    try {
      const pointer = JSON.parse(await readFile(join(projectDirectory(ownerId, workspacePath), 'latest.json'), 'utf8')) as Checkpoint
      if (pointer.version !== 1 || !pointer.directory || !pointer.clientMessageId || !pointer.sessionId)
        throw new Error('Invalid project edit checkpoint')
      const base = projectDirectory(ownerId, workspacePath)
      if (dirname(pointer.directory) !== base) throw new Error('Project edit checkpoint escaped its owner directory')
      return pointer
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  return {
    read,
    assertRecovered,
    async save(input: {
      ownerId: string
      workspacePath: string
      clientMessageId: string
      sessionId: string
      nativeSessionId?: string
      nativeTranscriptPath?: string
      deliveryStatePath: string
    }): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
      const workspace = await realpath(input.workspacePath)
      await assertRecovered(workspace)
      const base = projectDirectory(input.ownerId, workspace)
      // A checkpoint inside the project would recursively snapshot itself and alter the release revision.
      if (!relative(workspace, base).startsWith('..')) throw new Error('Project edit backup root must be outside the workspace')
      const directory = join(base, randomUUID())
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        await copyTree(workspace, join(directory, 'workspace'))
        const nativeTranscriptExisted = Boolean(input.nativeTranscriptPath && await exists(input.nativeTranscriptPath))
        if (nativeTranscriptExisted) await copyFile(input.nativeTranscriptPath!, join(directory, 'native.jsonl'))
        const deliveryStateExisted = await exists(input.deliveryStatePath)
        if (deliveryStateExisted) await copyFile(input.deliveryStatePath, join(directory, 'delivery.json'))
        const checkpoint: Checkpoint = {
          version: 1, clientMessageId: input.clientMessageId, sessionId: input.sessionId,
          ...(input.nativeSessionId ? { nativeSessionId: input.nativeSessionId } : {}),
          ...(input.nativeTranscriptPath ? { nativeTranscriptPath: input.nativeTranscriptPath } : {}),
          nativeTranscriptExisted, deliveryStateExisted, createdAt: new Date().toISOString(), directory,
        }
        await writeFile(join(base, 'latest.next.json'), JSON.stringify(checkpoint), { mode: 0o600 })
        const previous = await read(input.ownerId, workspace)
        await rename(join(base, 'latest.next.json'), join(base, 'latest.json'))
        return {
          commit: async () => {
            if (previous) await rm(previous.directory, { recursive: true, force: true }).catch(() => undefined)
          },
          rollback: async () => {
            if (previous) {
              await writeFile(join(base, 'latest.previous.json'), JSON.stringify(previous), { mode: 0o600 })
              await rename(join(base, 'latest.previous.json'), join(base, 'latest.json'))
            } else await rm(join(base, 'latest.json'), { force: true })
            await rm(directory, { recursive: true, force: true })
          },
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    },
    async restore(input: {
      ownerId: string
      workspacePath: string
      clientMessageId: string
      sessionId: string
      deliveryStatePath: string
    }): Promise<{ nativeSessionId?: string; archivePath: string }> {
      const workspace = await realpath(input.workspacePath)
      const checkpoint = await read(input.ownerId, workspace)
      if (!checkpoint || checkpoint.clientMessageId !== input.clientMessageId || checkpoint.sessionId !== input.sessionId)
        throw new Error('This message has no pre-turn checkpoint and cannot be safely edited')
      const archivePath = join(projectDirectory(input.ownerId, workspace), 'replaced', randomUUID())
      await mkdir(archivePath, { recursive: true, mode: 0o700 })
      const staged = join(dirname(workspace), `.${randomUUID()}.beegame-rewind`)
      const oldWorkspace = join(dirname(workspace), `.${randomUUID()}.beegame-original`)
      let moved = false
      try {
        if (!await exists(join(checkpoint.directory, 'workspace')) ||
            (checkpoint.nativeTranscriptExisted && !await exists(join(checkpoint.directory, 'native.jsonl'))) ||
            (checkpoint.deliveryStateExisted && !await exists(join(checkpoint.directory, 'delivery.json'))))
          throw new Error('Project edit checkpoint is incomplete; no files were changed')
        await copyTree(workspace, join(archivePath, 'workspace'))
        if (checkpoint.nativeTranscriptPath && await exists(checkpoint.nativeTranscriptPath))
          await copyFile(checkpoint.nativeTranscriptPath, join(archivePath, 'native.jsonl'))
        if (await exists(input.deliveryStatePath))
          await copyFile(input.deliveryStatePath, join(archivePath, 'delivery.json'))
        await writeFile(join(archivePath, 'metadata.json'), JSON.stringify({
          version: 1, replacedMessageId: input.clientMessageId,
          sessionId: input.sessionId, createdAt: new Date().toISOString(),
        }), { mode: 0o600 })
        await copyTree(join(checkpoint.directory, 'workspace'), staged)
        await rename(workspace, oldWorkspace)
        moved = true
        await rename(staged, workspace)
        for (const name of ['node_modules', '.git', 'transcripts', join('.beegame', 'chat'), join('.beegame', 'logs')]) {
          const preserved = join(oldWorkspace, name)
          if (await exists(preserved)) {
            await mkdir(dirname(join(workspace, name)), { recursive: true })
            await rename(preserved, join(workspace, name))
          }
        }
        if (checkpoint.nativeTranscriptPath) {
          if (checkpoint.nativeTranscriptExisted)
            await copyFile(join(checkpoint.directory, 'native.jsonl'), checkpoint.nativeTranscriptPath)
          else await rm(checkpoint.nativeTranscriptPath, { force: true })
        }
        if (checkpoint.deliveryStateExisted) {
          await mkdir(dirname(input.deliveryStatePath), { recursive: true })
          await copyFile(join(checkpoint.directory, 'delivery.json'), input.deliveryStatePath)
        } else await rm(input.deliveryStatePath, { force: true })
        await rm(oldWorkspace, { recursive: true, force: true })
        return { ...(checkpoint.nativeSessionId ? { nativeSessionId: checkpoint.nativeSessionId } : {}), archivePath }
      } catch (error) {
        if (moved && await exists(oldWorkspace)) {
          if (await exists(workspace)) {
            for (const name of ['node_modules', '.git', 'transcripts', join('.beegame', 'chat'), join('.beegame', 'logs')]) {
              const preserved = join(workspace, name)
              if (await exists(preserved) && !await exists(join(oldWorkspace, name))) {
                await mkdir(dirname(join(oldWorkspace, name)), { recursive: true })
                await rename(preserved, join(oldWorkspace, name))
              }
            }
            await rm(workspace, { recursive: true, force: true })
          }
          await rename(oldWorkspace, workspace)
        }
        if (moved && checkpoint.nativeTranscriptPath) {
          if (await exists(join(archivePath, 'native.jsonl')))
            await copyFile(join(archivePath, 'native.jsonl'), checkpoint.nativeTranscriptPath)
          else await rm(checkpoint.nativeTranscriptPath, { force: true })
        }
        if (moved) {
          if (await exists(join(archivePath, 'delivery.json'))) {
            await mkdir(dirname(input.deliveryStatePath), { recursive: true })
            await copyFile(join(archivePath, 'delivery.json'), input.deliveryStatePath)
          } else await rm(input.deliveryStatePath, { force: true })
        }
        throw error
      } finally {
        if (await exists(staged)) await rm(staged, { recursive: true, force: true })
      }
    },
    /** Undo an edit that was rejected before its replacement turn was accepted. */
    async reapplyArchive(input: {
      workspacePath: string
      archivePath: string
      nativeTranscriptPath?: string
      deliveryStatePath: string
    }): Promise<void> {
      const workspace = await realpath(input.workspacePath)
      if (!await exists(join(input.archivePath, 'workspace')))
        throw new Error('The replaced project backup is unavailable')
      const staged = join(dirname(workspace), `.${randomUUID()}.beegame-reapply`)
      const current = join(dirname(workspace), `.${randomUUID()}.beegame-current`)
      const backup = await mkdtemp(join(dirname(input.archivePath), 'reapply-state-'))
      let moved = false, nativeChanged = false, deliveryChanged = false, keepBackup = false
      let nativeExisted = false, deliveryExisted = false
      try {
        nativeExisted = Boolean(input.nativeTranscriptPath && await exists(input.nativeTranscriptPath))
        deliveryExisted = await exists(input.deliveryStatePath)
        if (nativeExisted) await copyFile(input.nativeTranscriptPath!, join(backup, 'native.jsonl'))
        if (deliveryExisted) await copyFile(input.deliveryStatePath, join(backup, 'delivery.json'))
        await copyTree(join(input.archivePath, 'workspace'), staged)
        await rename(workspace, current)
        moved = true
        await rename(staged, workspace)
        for (const name of ['node_modules', '.git', 'transcripts', join('.beegame', 'chat'), join('.beegame', 'logs')]) {
          const preserved = join(current, name)
          if (await exists(preserved)) {
            await mkdir(dirname(join(workspace, name)), { recursive: true })
            await rename(preserved, join(workspace, name))
          }
        }
        if (input.nativeTranscriptPath) {
          nativeChanged = true
          if (await exists(join(input.archivePath, 'native.jsonl')))
            await copyFile(join(input.archivePath, 'native.jsonl'), input.nativeTranscriptPath)
          else await rm(input.nativeTranscriptPath, { force: true })
        }
        deliveryChanged = true
        if (await exists(join(input.archivePath, 'delivery.json'))) {
          await mkdir(dirname(input.deliveryStatePath), { recursive: true })
          await copyFile(join(input.archivePath, 'delivery.json'), input.deliveryStatePath)
        } else await rm(input.deliveryStatePath, { force: true })
      } catch (error) {
        const failures: unknown[] = []
        const recover = async (operation: () => Promise<unknown>) => {
          try { await operation() } catch (failure) { failures.push(failure) }
        }
        if (moved) await recover(async () => {
          if (await exists(workspace)) {
            for (const name of ['node_modules', '.git', 'transcripts', join('.beegame', 'chat'), join('.beegame', 'logs')]) {
              const preserved = join(workspace, name)
              if (await exists(preserved) && !await exists(join(current, name))) {
                await mkdir(dirname(join(current, name)), { recursive: true })
                await rename(preserved, join(current, name))
              }
            }
            await rm(workspace, { recursive: true, force: true })
          }
          await rename(current, workspace)
        })
        if (nativeChanged) await recover(async () => {
          if (nativeExisted) await copyFile(join(backup, 'native.jsonl'), input.nativeTranscriptPath!)
          else await rm(input.nativeTranscriptPath!, { force: true })
        })
        if (deliveryChanged) await recover(async () => {
          if (deliveryExisted) await copyFile(join(backup, 'delivery.json'), input.deliveryStatePath)
          else await rm(input.deliveryStatePath, { force: true })
        })
        if (failures.length) {
          keepBackup = true
          const marker = recoveryMarker(workspace)
          await mkdir(dirname(marker), { recursive: true, mode: 0o700 })
          await writeFile(marker, JSON.stringify({ workspace, backup, current }), { mode: 0o600 })
          throw new AggregateError([error, ...failures], `Project recovery is incomplete; backup retained at ${backup}`)
        }
        throw error
      } finally {
        if (await exists(staged)) await rm(staged, { recursive: true, force: true })
        if (!keepBackup) await rm(backup, { recursive: true, force: true })
      }
      // Cleanup is after commit: partial deletion of a discarded backup must
      // never trigger a rollback from that now-incomplete directory.
      await rm(current, { recursive: true, force: true })
    },
  }
}
