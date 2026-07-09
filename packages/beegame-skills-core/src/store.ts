import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import {
  BeeGameSkillValidationError,
  type BeeGameSkillFile,
  type BeeGameSkillImportInput,
  type BeeGameUserSkill,
  type BeeGameSkillsRepository,
} from './types'

const STORE_FILE = 'user-skills.json'
const RUNTIME_SKILLS_DIR = join('.runtime', 'app', 'skills')
const MAX_ZIP_BYTES = 512 * 1024
const MAX_FILE_BYTES = 96 * 1024
const MAX_FILE_COUNT = 24

type StorePayload = {
  version: 1
  skillsByUserId: Record<string, BeeGameUserSkill[]>
}

export type LocalBeeGameSkillsStoreOptions = {
  dataDir?: string
}

export class LocalBeeGameSkillsRepository implements BeeGameSkillsRepository {
  constructor(private readonly options: LocalBeeGameSkillsStoreOptions = {}) {}

  async listUserSkills(userId: string): Promise<BeeGameUserSkill[]> {
    return listUserSkills(userId, this.options)
  }

  async listEnabledUserSkills(userId: string): Promise<BeeGameUserSkill[]> {
    return listUserSkills(userId, this.options).filter(skill => skill.enabled)
  }

  async importUserSkill(
    userId: string,
    input: BeeGameSkillImportInput,
  ): Promise<BeeGameUserSkill> {
    return importUserSkill(userId, input, this.options)
  }

  async updateUserSkillEnabled(
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<BeeGameUserSkill> {
    return updateUserSkillEnabled(userId, id, enabled, this.options)
  }

  async deleteUserSkill(userId: string, id: string): Promise<boolean> {
    return deleteUserSkill(userId, id, this.options)
  }
}

export function getDefaultBeeGameSkillsStoreDir(): string {
  return process.env.BEEGAME_SKILLS_DATA_DIR ??
    join(homedir(), '.beegame', 'skills-server')
}

export function parseSkillZipPackage(input: ArrayBuffer | Uint8Array): BeeGameSkillFile[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new BeeGameSkillValidationError('Skill package is too large')
  }
  const entries = unzipSync(bytes)
  const decoder = new TextDecoder()
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, content]) => normalizePackageFile(path, decoder.decode(content)))
    .sort((left, right) => left.path.localeCompare(right.path))
  return normalizeSkillFiles(files)
}

export function listUserSkills(
  userId: string,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill[] {
  return loadStore(options).skillsByUserId[userId] ?? []
}

export function importUserSkill(
  userId: string,
  input: BeeGameSkillImportInput,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill {
  const payload = loadStore(options)
  const current = payload.skillsByUserId[userId] ?? []
  const normalized = normalizeImportedSkill(input)
  const next = [
    normalized,
    ...current.filter(skill => skill.slug !== normalized.slug),
  ].sort((left, right) => left.name.localeCompare(right.name))
  payload.skillsByUserId[userId] = next
  saveStore(payload, options)
  return normalized
}

export function updateUserSkillEnabled(
  userId: string,
  id: string,
  enabled: boolean,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill {
  const payload = loadStore(options)
  const current = payload.skillsByUserId[userId] ?? []
  const existing = current.find(skill => skill.id === id)
  if (!existing) throw new BeeGameSkillValidationError('Skill not found')
  const updated = {
    ...existing,
    enabled,
    updatedAt: new Date().toISOString(),
  }
  payload.skillsByUserId[userId] = current.map(skill =>
    skill.id === id ? updated : skill
  )
  saveStore(payload, options)
  return updated
}

export function deleteUserSkill(
  userId: string,
  id: string,
  options: LocalBeeGameSkillsStoreOptions = {},
): boolean {
  const payload = loadStore(options)
  const current = payload.skillsByUserId[userId] ?? []
  const next = current.filter(skill => skill.id !== id)
  if (next.length === current.length) return false
  payload.skillsByUserId[userId] = next
  saveStore(payload, options)
  return true
}

export function materializeUserSkills(
  skills: BeeGameUserSkill[],
  options: LocalBeeGameSkillsStoreOptions = {},
): void {
  const skillsDir = join(
    options.dataDir ?? getDefaultBeeGameSkillsStoreDir(),
    RUNTIME_SKILLS_DIR,
  )
  mkdirSync(skillsDir, { recursive: true })
  const enabled = skills.filter(skill => skill.enabled)
  const desiredDirs = new Set(enabled.map(skill => `user-${skill.slug}`))

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('user-')) continue
    if (!desiredDirs.has(entry.name)) {
      rmSync(join(skillsDir, entry.name), { recursive: true, force: true })
    }
  }

  for (const skill of enabled) {
    const skillDir = join(skillsDir, `user-${skill.slug}`)
    rmSync(skillDir, { recursive: true, force: true })
    mkdirSync(skillDir, { recursive: true })
    for (const file of skill.files) {
      const outputPath = join(skillDir, file.path)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, `${file.content.trim()}\n`, 'utf8')
    }
  }
}

function normalizeImportedSkill(input: BeeGameSkillImportInput): BeeGameUserSkill {
  const files = normalizeSkillFiles(input.files)
  const skillFile = files.find(file => file.path === 'SKILL.md')
  if (!skillFile) throw new BeeGameSkillValidationError('Skill package must include SKILL.md')
  const metadata = parseSkillFrontmatter(skillFile.content)
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    slug: skillNameToSlug(metadata.name),
    name: metadata.name,
    description: metadata.description,
    enabled: input.enabled !== false,
    files,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeSkillFiles(files: BeeGameSkillFile[]): BeeGameSkillFile[] {
  if (!Array.isArray(files) || !files.length) {
    throw new BeeGameSkillValidationError('Skill package is empty')
  }
  if (files.length > MAX_FILE_COUNT) {
    throw new BeeGameSkillValidationError('Skill package has too many files')
  }
  const normalized = files.map(file => normalizePackageFile(file.path, file.content))
  if (!normalized.some(file => file.path === 'SKILL.md')) {
    throw new BeeGameSkillValidationError('Skill package must include SKILL.md')
  }
  return normalized
}

function normalizePackageFile(pathValue: unknown, contentValue: unknown): BeeGameSkillFile {
  const path = normalizePackagePath(pathValue)
  const content = trimString(contentValue)
  if (!content) throw new BeeGameSkillValidationError(`Skill file ${path} is empty`)
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new BeeGameSkillValidationError(`Skill file ${path} is too large`)
  }
  return { path, content }
}

function normalizePackagePath(value: unknown): string {
  const path = trimString(value)
  if (!path || path.includes('\\') || path.startsWith('/') || path.includes('\0')) {
    throw new BeeGameSkillValidationError('Skill package contains an invalid path')
  }
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new BeeGameSkillValidationError('Skill package contains an invalid path')
    }
  }
  if (path === 'SKILL.md') return path
  if (path.startsWith('references/') && path.endsWith('.md')) return path
  throw new BeeGameSkillValidationError('Skill package may only include SKILL.md and references/*.md')
}

function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') {
    throw new BeeGameSkillValidationError('SKILL.md must start with YAML frontmatter')
  }
  const metadata: Record<string, string> = {}
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (line === '---') break
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key === 'name' || key === 'description') {
      metadata[key] = stripYamlString(value)
    }
  }
  const name = normalizeSkillName(metadata.name)
  const description = trimString(metadata.description)
  if (!name) throw new BeeGameSkillValidationError('Skill frontmatter name is required')
  if (!description) throw new BeeGameSkillValidationError('Skill frontmatter description is required')
  return { name, description }
}

function normalizeSkillName(value: unknown): string {
  const name = trimString(value)
  if (!name) return ''
  const slug = skillNameToSlug(name)
  if (slug !== name) {
    throw new BeeGameSkillValidationError('Skill name must use lowercase letters, numbers, and hyphens')
  }
  return name
}

function skillNameToSlug(value: string): string {
  const trimmed = trimString(value).toLowerCase()
  let output = ''
  let previousHyphen = false
  for (const char of trimmed) {
    const isAlphaNumeric =
      (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
    if (isAlphaNumeric) {
      output += char
      previousHyphen = false
    } else if (char === '-' && output && !previousHyphen) {
      output += char
      previousHyphen = true
    } else if (char !== ' ' && char !== '_') {
      throw new BeeGameSkillValidationError('Skill name contains unsupported characters')
    } else if (output && !previousHyphen) {
      output += '-'
      previousHyphen = true
    }
  }
  return output.endsWith('-') ? output.slice(0, -1) : output
}

function loadStore(options: LocalBeeGameSkillsStoreOptions): StorePayload {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return { version: 1, skillsByUserId: {} }
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !payload.skillsByUserId) {
    throw new Error('Unsupported BeeGame skills store format')
  }
  return payload
}

function saveStore(
  payload: StorePayload,
  options: LocalBeeGameSkillsStoreOptions,
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function getStoreFilePath(options: LocalBeeGameSkillsStoreOptions): string {
  return join(options.dataDir ?? getDefaultBeeGameSkillsStoreDir(), STORE_FILE)
}

function stripYamlString(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim()
  }
  return value.trim()
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
