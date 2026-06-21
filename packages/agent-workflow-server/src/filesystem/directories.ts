import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListing = {
  path: string
  parentPath: string
  homePath: string
  entries: DirectoryEntry[]
}

export async function listDirectories(
  inputPath?: string,
): Promise<DirectoryListing> {
  const requestedPath = inputPath?.trim() || homedir()
  if (!isAbsolute(requestedPath)) {
    throw new Error('Path must be absolute')
  }

  const absolutePath = resolve(requestedPath)
  const info = await stat(absolutePath)
  if (!info.isDirectory()) {
    throw new Error('Path must be a directory')
  }

  const currentPath = await realpath(absolutePath)
  const entries = await readdir(currentPath, { withFileTypes: true })
  const directories = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({
      name: entry.name,
      path: resolve(currentPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    path: currentPath,
    parentPath: dirname(currentPath),
    homePath: homedir(),
    entries: directories,
  }
}
