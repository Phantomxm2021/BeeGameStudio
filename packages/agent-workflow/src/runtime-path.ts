import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
export function sanitizePath(path: string): string {
  const clean = path.replace(/[^a-zA-Z0-9]/g, '-')
  return clean.length <= 200 ? clean : clean.slice(0, 200) + '-' + createHash('sha256').update(path).digest('hex').slice(0,16)
}
export function expandPath(path: string, cwd = process.cwd()): string {
  if (path.includes('\0') || cwd.includes('\0')) throw Error('Path contains null bytes')
  const value = path.trim().normalize('NFC')
  return resolve(cwd, value === '~' ? homedir() : value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : value)
}
