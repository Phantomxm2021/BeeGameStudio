export type BeeGameSkillFile = {
  path: string
  content: string
}

export type BeeGameUserSkill = {
  id: string
  slug: string
  name: string
  description: string
  enabled: boolean
  files: BeeGameSkillFile[]
  createdAt: string
  updatedAt: string
}

export type BeeGameUserSkillSummary = {
  id: string
  slug: string
  name: string
  description: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type BeeGameSkillsUserContext = {
  id: string
  email?: string
  role?: string
  permissions?: string[]
}

export type BeeGameSkillsRepository = {
  listUserSkills(userId: string): Promise<BeeGameUserSkill[]>
  listEnabledUserSkills(userId: string): Promise<BeeGameUserSkill[]>
  importUserSkill(userId: string, input: BeeGameSkillImportInput): Promise<BeeGameUserSkill>
  updateUserSkillEnabled(userId: string, id: string, enabled: boolean): Promise<BeeGameUserSkill>
  deleteUserSkill(userId: string, id: string): Promise<boolean>
}

export type BeeGameSkillImportInput = {
  enabled?: boolean
  files: BeeGameSkillFile[]
}

export class BeeGameSkillValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeeGameSkillValidationError'
    Object.setPrototypeOf(this, BeeGameSkillValidationError.prototype)
  }
}

export class BeeGameSkillDuplicateError extends BeeGameSkillValidationError {
  constructor(message = 'Skill already exists') {
    super(message)
    this.name = 'BeeGameSkillDuplicateError'
    Object.setPrototypeOf(this, BeeGameSkillDuplicateError.prototype)
  }
}
