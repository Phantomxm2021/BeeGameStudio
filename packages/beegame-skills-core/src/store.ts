import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import {
  BeeGameSkillDuplicateError,
  BeeGameSkillValidationError,
  type BeeGameSkillFile,
  type BeeGameSkillImportInput,
  type BeeGameUserSkill,
  type BeeGameSkillsRepository,
} from './types'

const STORE_FILE = 'user-skills.json'
const SKILL_METADATA_FILE = 'skill.json'
const BUILTIN_SKILLS_DIR = 'builtinskills'
const RUNTIME_SKILLS_DIR = join('.runtime', 'app', 'skills')
const MAX_ZIP_BYTES = 10 * 1024 * 1024
const MAX_FILE_BYTES = 96 * 1024
const MAX_FILE_COUNT = 128

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
  return getSkillsStoreRootDir({})
}

export function getDefaultBeeGameBuiltinSkillsDir(): string {
  if (process.env.BEEGAME_BUILTIN_SKILLS_DIR) {
    return process.env.BEEGAME_BUILTIN_SKILLS_DIR
  }
  const workspaceBuiltinSkills = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '.beegame',
    'skills',
    BUILTIN_SKILLS_DIR,
  )
  if (existsSync(workspaceBuiltinSkills)) return workspaceBuiltinSkills
  return join(getDefaultBeeGameSkillsStoreDir(), BUILTIN_SKILLS_DIR)
}

export function materializeBuiltinSkills(
  options: LocalBeeGameSkillsStoreOptions = {},
  sourceDir = getDefaultBeeGameBuiltinSkillsDir(),
): void {
  const targetDir = join(
    options.dataDir ?? getDefaultBeeGameSkillsStoreDir(),
    RUNTIME_SKILLS_DIR,
    BUILTIN_SKILLS_DIR,
  )
  if (resolve(sourceDir) === resolve(targetDir)) return
  if (!existsSync(sourceDir)) {
    throw new BeeGameSkillValidationError(
      `BeeGame built-in skills directory is unavailable: ${sourceDir}`,
    )
  }

  const temporaryDir = `${targetDir}.${randomUUID()}.tmp`
  mkdirSync(dirname(targetDir), { recursive: true })
  try {
    cpSync(sourceDir, temporaryDir, { recursive: true })
    rmSync(targetDir, { recursive: true, force: true })
    renameSync(temporaryDir, targetDir)
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true })
  }
}

export function parseSkillZipPackage(input: ArrayBuffer | Uint8Array): BeeGameSkillFile[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new BeeGameSkillValidationError('Skill package is too large')
  }
  rejectZipSymlinks(bytes)
  let entryCount = 0
  let uncompressedBytes = 0
  const normalizedPaths = new Set<string>()
  const entries = unzipSync(bytes, {
    filter: info => {
      entryCount += 1
      uncompressedBytes += info.originalSize
      if (entryCount > MAX_FILE_COUNT || uncompressedBytes > MAX_ZIP_BYTES) {
        throw new BeeGameSkillValidationError('Skill package exceeds archive limits')
      }
      if (info.name.endsWith('/')) return false
      const normalizedPath = normalizePackagePath(info.name)
      if (normalizedPaths.has(normalizedPath)) {
        throw new BeeGameSkillValidationError('Skill package contains duplicate entries')
      }
      normalizedPaths.add(normalizedPath)
      return true
    },
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, content]) => {
      try {
        return normalizePackageFile(path, decoder.decode(content))
      } catch (error) {
        if (error instanceof BeeGameSkillValidationError) throw error
        throw new BeeGameSkillValidationError('Skill package contains non-UTF-8 text')
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return normalizeSkillFiles(files)
}

function rejectZipSymlinks(bytes: Uint8Array): void {
  const end = findZipEnd(bytes)
  if (end < 0) return
  const totalEntries = readU16(bytes, end + 10)
  let offset = readU32(bytes, end + 16)
  for (let index = 0; index < totalEntries; index += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) throw new BeeGameSkillValidationError('Invalid skill ZIP directory')
    const versionMadeBy = readU16(bytes, offset + 4)
    const externalAttributes = readU32(bytes, offset + 38)
    const unixMode = externalAttributes >>> 16
    if ((versionMadeBy >>> 8) === 3 && (unixMode & 0xf000) === 0xa000) {
      throw new BeeGameSkillValidationError('Skill package may not contain symbolic links')
    }
    offset += 46 + readU16(bytes, offset + 28) + readU16(bytes, offset + 30) + readU16(bytes, offset + 32)
  }
}

function findZipEnd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) return offset
  }
  return -1
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (readU16(bytes, offset) | (readU16(bytes, offset + 2) << 16)) >>> 0
}

export function listUserSkills(
  userId: string,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill[] {
  migrateUnscopedSkillDirs(options)
  migrateLegacyStore(options)
  return readUserSkills(userId, options)
}

export function importUserSkill(
  userId: string,
  input: BeeGameSkillImportInput,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill {
  migrateUnscopedSkillDirs(options)
  migrateLegacyStore(options)
  const current = readUserSkills(userId, options)
  const normalized = normalizeImportedSkill(input)
  if (current.some(skill => skill.slug === normalized.slug)) {
    throw new BeeGameSkillDuplicateError()
  }
  writeUserSkill(userId, normalized, options)
  return normalized
}

export function updateUserSkillEnabled(
  userId: string,
  id: string,
  enabled: boolean,
  options: LocalBeeGameSkillsStoreOptions = {},
): BeeGameUserSkill {
  migrateUnscopedSkillDirs(options)
  migrateLegacyStore(options)
  const current = readUserSkills(userId, options)
  const existing = current.find(skill => skill.id === id)
  if (!existing) throw new BeeGameSkillValidationError('Skill not found')
  const updated = {
    ...existing,
    enabled,
    updatedAt: new Date().toISOString(),
  }
  writeUserSkill(userId, updated, options)
  return updated
}

export function deleteUserSkill(
  userId: string,
  id: string,
  options: LocalBeeGameSkillsStoreOptions = {},
): boolean {
  migrateUnscopedSkillDirs(options)
  migrateLegacyStore(options)
  const existing = readUserSkills(userId, options).find(skill => skill.id === id)
  if (!existing) return false
  rmSync(getSkillDirPath(userId, existing.slug, options), { recursive: true, force: true })
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
  if (normalized.filter(file => file.path === 'SKILL.md').length !== 1) {
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

function readUserSkills(
  userId: string,
  options: LocalBeeGameSkillsStoreOptions,
): BeeGameUserSkill[] {
  const userDir = getUserDirPath(userId, options)
  if (!existsSync(userDir)) return []
  return readSkillsFromUserDir(userDir)
}

function readSkillsFromUserDir(userDir: string): BeeGameUserSkill[] {
  const skills: BeeGameUserSkill[] = []
  for (const entry of readdirSync(userDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skill = readStoredSkill(join(userDir, entry.name))
    if (skill) skills.push(skill)
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

function readStoredSkill(skillDir: string): BeeGameUserSkill | null {
  const metadataPath = join(skillDir, SKILL_METADATA_FILE)
  if (!existsSync(metadataPath)) return null
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Omit<BeeGameUserSkill, 'files'>
  return {
    ...metadata,
    files: readStoredSkillFiles(skillDir),
  }
}

function readStoredSkillFiles(skillDir: string): BeeGameSkillFile[] {
  const filesRoot = resolveSkillFilesRoot(skillDir)
  const files: BeeGameSkillFile[] = []
  const skillFilePath = join(filesRoot, 'SKILL.md')
  if (existsSync(skillFilePath)) {
    files.push({ path: 'SKILL.md', content: readFileSync(skillFilePath, 'utf8').trim() })
  }
  const referencesDir = join(filesRoot, 'references')
  if (existsSync(referencesDir)) {
    for (const entry of readdirSync(referencesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const relativePath = `references/${entry.name}`
      files.push({
        path: relativePath,
        content: readFileSync(join(referencesDir, entry.name), 'utf8').trim(),
      })
    }
  }
  return normalizeSkillFiles(files).sort((left, right) => left.path.localeCompare(right.path))
}

function writeUserSkill(
  userId: string,
  skill: BeeGameUserSkill,
  options: LocalBeeGameSkillsStoreOptions,
): void {
  const skillDir = getSkillDirPath(userId, skill.slug, options)
  rmSync(skillDir, { recursive: true, force: true })
  mkdirSync(skillDir, { recursive: true })
  writeJsonFile(join(skillDir, SKILL_METADATA_FILE), {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  })
  for (const file of normalizeSkillFiles(skill.files)) {
    const outputPath = join(skillDir, file.path)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${file.content.trim()}\n`, 'utf8')
  }
}

function resolveSkillFilesRoot(skillDir: string): string {
  if (existsSync(join(skillDir, 'SKILL.md'))) return skillDir
  const legacyFilesRoot = join(skillDir, 'files')
  if (existsSync(join(legacyFilesRoot, 'SKILL.md'))) return legacyFilesRoot
  return skillDir
}

function migrateLegacyStore(options: LocalBeeGameSkillsStoreOptions): void {
  const filePath = getLegacyStoreFilePath(options)
  const legacyFilePath = getUnscopedLegacyStoreFilePath(options)
  const sourcePath = existsSync(filePath)
    ? filePath
    : (legacyFilePath && existsSync(legacyFilePath) ? legacyFilePath : '')
  if (!sourcePath) return
  const payload = JSON.parse(readFileSync(sourcePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !payload.skillsByUserId) {
    throw new Error('Unsupported BeeGame skills store format')
  }
  for (const [userId, skills] of Object.entries(payload.skillsByUserId)) {
    const existing = new Set(readUserSkills(userId, options).map(skill => skill.slug))
    for (const skill of skills) {
      if (existing.has(skill.slug)) continue
      writeUserSkill(userId, skill, options)
      existing.add(skill.slug)
    }
  }
  renameSync(sourcePath, `${sourcePath}.legacy`)
}

function migrateUnscopedSkillDirs(options: LocalBeeGameSkillsStoreOptions): void {
  const unscopedRoot = getUnscopedStoreBaseDir(options)
  const scopedRoot = getSkillsStoreRootDir(options)
  if (unscopedRoot === scopedRoot || !existsSync(unscopedRoot)) return
  mkdirSync(scopedRoot, { recursive: true })
  for (const userEntry of readdirSync(unscopedRoot, { withFileTypes: true })) {
    if (!userEntry.isDirectory()) continue
    if (userEntry.name === basename(scopedRoot) || userEntry.name === BUILTIN_SKILLS_DIR) continue
    if (userEntry.name.startsWith('.') || userEntry.name === '.runtime') continue
    const userDir = join(unscopedRoot, userEntry.name)
    for (const skillEntry of readdirSync(userDir, { withFileTypes: true })) {
      if (!skillEntry.isDirectory()) continue
      const skillDir = join(userDir, skillEntry.name)
      const skill = readStoredSkill(skillDir)
      if (!skill) continue
      if (!existsSync(getSkillDirPath(userEntry.name, skill.slug, options))) {
        writeUserSkill(userEntry.name, skill, options)
      }
      rmSync(skillDir, { recursive: true, force: true })
    }
    if (readdirSync(userDir).length === 0) {
      rmSync(userDir, { recursive: true, force: true })
    }
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tempPath, path)
}

function getLegacyStoreFilePath(options: LocalBeeGameSkillsStoreOptions): string {
  return join(getSkillsStoreRootDir(options), STORE_FILE)
}

function getUserDirPath(userId: string, options: LocalBeeGameSkillsStoreOptions): string {
  return join(getSkillsStoreRootDir(options), safePathSegment(userId))
}

function getSkillDirPath(
  userId: string,
  skillSlug: string,
  options: LocalBeeGameSkillsStoreOptions,
): string {
  return join(getUserDirPath(userId, options), safePathSegment(skillSlug))
}

function getSkillsStoreRootDir(options: LocalBeeGameSkillsStoreOptions): string {
  const baseDir = getUnscopedStoreBaseDir(options)
  return basename(baseDir) === 'skills' ? baseDir : join(baseDir, 'skills')
}

function getUnscopedStoreBaseDir(options: LocalBeeGameSkillsStoreOptions): string {
  return options.dataDir ??
    process.env.BEEGAME_SKILLS_DATA_DIR ??
    join(process.cwd(), '.beegame', 'skills')
}

function getUnscopedLegacyStoreFilePath(options: LocalBeeGameSkillsStoreOptions): string | null {
  const baseDir = getUnscopedStoreBaseDir(options)
  const scopedDir = getSkillsStoreRootDir(options)
  return baseDir === scopedDir ? null : join(baseDir, STORE_FILE)
}

function safePathSegment(value: string): string {
  const trimmed = trimString(value)
  if (!trimmed) throw new BeeGameSkillValidationError('Path segment is required')
  let output = ''
  for (const char of trimmed) {
    const isAlphaNumeric =
      (char >= 'a' && char <= 'z') ||
      (char >= 'A' && char <= 'Z') ||
      (char >= '0' && char <= '9')
    if (isAlphaNumeric || char === '-' || char === '_') {
      output += char
    } else {
      output += '-'
    }
  }
  return output || 'unknown'
}
