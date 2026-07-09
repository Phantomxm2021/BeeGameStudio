import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STORE_FILE = 'user-skills.json'
const RUNTIME_SKILLS_DIR = join('.runtime', 'app', 'skills')
const MAX_SKILL_CONTENT_BYTES = 64 * 1024
const MAX_REFERENCE_BYTES = 32 * 1024
const MAX_REFERENCE_COUNT = 12

export type BeeGameUserSkillReference = {
  path: string
  content: string
}

export type BeeGameUserSkill = {
  id: string
  slug: string
  name: string
  description: string
  enabled: boolean
  content: string
  references: BeeGameUserSkillReference[]
  createdAt: string
  updatedAt: string
}

export type BeeGameUserSkillInput = {
  id?: string
  enabled?: boolean
  content: string
  references?: BeeGameUserSkillReference[]
}

export type BeeGameUserSkillValidationResult =
  | { ok: true; skill: BeeGameUserSkill }
  | { ok: false; message: string }

export type UserSkillsStoreOptions = {
  dataDir?: string
}

type StorePayload = {
  version: 1
  skills: BeeGameUserSkill[]
}

export class UserSkillValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserSkillValidationError'
    Object.setPrototypeOf(this, UserSkillValidationError.prototype)
  }
}

export function getDefaultUserSkillsStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function listUserSkills(
  options: UserSkillsStoreOptions = {},
): BeeGameUserSkill[] {
  return loadUserSkills(options)
}

export function listEnabledUserSkills(
  options: UserSkillsStoreOptions = {},
): BeeGameUserSkill[] {
  return loadUserSkills(options).filter(skill => skill.enabled)
}

export function upsertUserSkill(
  input: BeeGameUserSkillInput,
  options: UserSkillsStoreOptions = {},
): BeeGameUserSkill {
  const skills = loadUserSkills(options)
  const existingIndex = input.id
    ? skills.findIndex(skill => skill.id === input.id)
    : -1
  const existing = existingIndex >= 0 ? skills[existingIndex] : undefined
  const normalized = normalizeUserSkillInput(input, existing)
  assertUniqueSkillSlug(normalized, skills)
  const nextSkills = existingIndex >= 0
    ? skills.map(skill => skill.id === normalized.id ? normalized : skill)
    : [...skills, normalized]
  saveUserSkills(nextSkills, options)
  return normalized
}

export function validateUserSkillInput(
  input: BeeGameUserSkillInput,
  existing?: BeeGameUserSkill,
  skills: BeeGameUserSkill[] = [],
): BeeGameUserSkillValidationResult {
  try {
    const normalized = normalizeUserSkillInput(input, existing)
    assertUniqueSkillSlug(normalized, skills)
    return { ok: true, skill: normalized }
  } catch (err) {
    if (err instanceof UserSkillValidationError) {
      return { ok: false, message: err.message }
    }
    throw err
  }
}

export function deleteUserSkill(
  id: string,
  options: UserSkillsStoreOptions = {},
): boolean {
  const skills = loadUserSkills(options)
  const nextSkills = skills.filter(skill => skill.id !== id)
  if (nextSkills.length === skills.length) return false
  saveUserSkills(nextSkills, options)
  return true
}

export function materializeUserSkills(
  skills: BeeGameUserSkill[],
  options: UserSkillsStoreOptions = {},
): void {
  const skillsDir = getRuntimeSkillsDir(options)
  mkdirSync(skillsDir, { recursive: true })
  const enabled = skills.filter(skill => skill.enabled)
  const desiredDirs = new Set(enabled.map(skill => getMaterializedSkillDirName(skill.slug)))

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('user-')) continue
    if (!desiredDirs.has(entry.name)) {
      rmSync(join(skillsDir, entry.name), { recursive: true, force: true })
    }
  }

  for (const skill of enabled) {
    const skillDir = join(skillsDir, getMaterializedSkillDirName(skill.slug))
    rmSync(skillDir, { recursive: true, force: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `${skill.content.trim()}\n`, 'utf8')
    for (const reference of skill.references) {
      const referencePath = join(skillDir, reference.path)
      mkdirSync(dirname(referencePath), { recursive: true })
      writeFileSync(referencePath, `${reference.content.trim()}\n`, 'utf8')
    }
  }
}

function loadUserSkills(options: UserSkillsStoreOptions): BeeGameUserSkill[] {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return []
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !Array.isArray(payload.skills)) {
    throw new Error('Unsupported user skills store format')
  }
  return payload.skills
    .map(skill => normalizeStoredUserSkill(skill))
    .filter(skill => skill.name && skill.description)
}

function saveUserSkills(
  skills: BeeGameUserSkill[],
  options: UserSkillsStoreOptions,
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })
  const payload: StorePayload = {
    version: 1,
    skills,
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

export function normalizeUserSkillInput(
  input: BeeGameUserSkillInput,
  existing?: BeeGameUserSkill,
): BeeGameUserSkill {
  const content = normalizeSkillContent(input.content)
  const metadata = parseSkillFrontmatter(content)
  const now = new Date().toISOString()
  return {
    id: trimString(input.id) || existing?.id || randomUUID(),
    slug: skillNameToSlug(metadata.name),
    name: metadata.name,
    description: metadata.description,
    enabled: typeof input.enabled === 'boolean'
      ? input.enabled
      : existing?.enabled ?? true,
    content,
    references: normalizeReferences(input.references ?? existing?.references ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function normalizeStoredUserSkill(input: BeeGameUserSkill): BeeGameUserSkill {
  const normalized = normalizeUserSkillInput({
    id: input.id,
    enabled: input.enabled,
    content: input.content,
    references: input.references,
  }, input)
  return {
    ...normalized,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

function assertUniqueSkillSlug(
  skill: BeeGameUserSkill,
  skills: BeeGameUserSkill[],
): void {
  const duplicate = skills.find(item =>
    item.id !== skill.id && item.slug === skill.slug
  )
  if (duplicate) {
    throw new UserSkillValidationError(`Skill name already exists: ${skill.name}`)
  }
}

function normalizeSkillContent(content: string): string {
  const normalized = trimString(content)
  if (!normalized) {
    throw new UserSkillValidationError('Skill content is required')
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_SKILL_CONTENT_BYTES) {
    throw new UserSkillValidationError('Skill content is too large')
  }
  return normalized
}

function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') {
    throw new UserSkillValidationError('Skill content must start with YAML frontmatter')
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
  if (!name) throw new UserSkillValidationError('Skill frontmatter name is required')
  if (!description) {
    throw new UserSkillValidationError('Skill frontmatter description is required')
  }
  return { name, description }
}

function normalizeSkillName(value: unknown): string {
  const name = trimString(value)
  if (!name) return ''
  const slug = skillNameToSlug(name)
  if (slug !== name) {
    throw new UserSkillValidationError('Skill name must use lowercase letters, numbers, and hyphens')
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
      throw new UserSkillValidationError('Skill name contains unsupported characters')
    } else if (output && !previousHyphen) {
      output += '-'
      previousHyphen = true
    }
  }
  return output.endsWith('-') ? output.slice(0, -1) : output
}

function normalizeReferences(
  references: BeeGameUserSkillReference[],
): BeeGameUserSkillReference[] {
  if (!Array.isArray(references)) return []
  if (references.length > MAX_REFERENCE_COUNT) {
    throw new UserSkillValidationError('Too many skill reference files')
  }
  return references.map(reference => {
    const path = normalizeReferencePath(reference.path)
    const content = trimString(reference.content)
    if (!content) {
      throw new UserSkillValidationError(`Reference ${path} content is required`)
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_REFERENCE_BYTES) {
      throw new UserSkillValidationError(`Reference ${path} is too large`)
    }
    return { path, content }
  })
}

function normalizeReferencePath(value: unknown): string {
  const path = trimString(value)
  if (!path.startsWith('references/') || !path.endsWith('.md')) {
    throw new UserSkillValidationError('Skill references must be markdown files under references/')
  }
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new UserSkillValidationError('Skill reference path is invalid')
    }
  }
  if (path.includes('\\')) {
    throw new UserSkillValidationError('Skill reference path must use forward slashes')
  }
  return path
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

function getStoreFilePath(options: UserSkillsStoreOptions): string {
  return join(options.dataDir ?? getDefaultUserSkillsStoreDir(), STORE_FILE)
}

function getRuntimeSkillsDir(options: UserSkillsStoreOptions): string {
  return join(options.dataDir ?? getDefaultUserSkillsStoreDir(), RUNTIME_SKILLS_DIR)
}

function getMaterializedSkillDirName(slug: string): string {
  return `user-${slug}`
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
