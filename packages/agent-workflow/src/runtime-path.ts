import { homedir } from 'node:os'
import { resolve } from 'node:path'
export function expandPath(path: string, cwd = process.cwd()): string {
  if (path.includes('\0') || cwd.includes('\0')) throw Error('Path contains null bytes')
  const value = path.trim().normalize('NFC')
  return resolve(cwd, value === '~' ? homedir() : value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : value)
}
