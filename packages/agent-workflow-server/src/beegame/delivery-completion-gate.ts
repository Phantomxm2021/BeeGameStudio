import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'

const VALIDATION_REPORT_PATH = ['docs', 'acceptance', 'validation-report.json'] as const
const ACCEPTANCE_SKILL_CAPABILITY = 'skill:beegame-game-acceptance'

export type DeliveryReportSignature = {
  mtimeMs: number
  size: number
  digest: string
}

export type DeliveryCompletionGateResult = {
  allowed: boolean
  outcome: 'passed' | 'blocked' | 'rejected'
  issues: string[]
}

const PROJECT_MUTATION_IGNORED_ANYWHERE = new Set([
  '.git',
  'node_modules',
])
const PROJECT_MUTATION_IGNORED_AT_ROOT = new Set([
  '.beegame-attachments',
  'logs',
  'transcripts',
])

export function readProjectMutationSignature(workspace: string): string {
  const root = resolve(workspace)
  const entries: string[] = []
  const visit = (directory: string): void => {
    let children: Dirent<string>[]
    try {
      children = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const child of children) {
      if (
        child.isDirectory() && (
          PROJECT_MUTATION_IGNORED_ANYWHERE.has(child.name) ||
          (directory === root && PROJECT_MUTATION_IGNORED_AT_ROOT.has(child.name))
        )
      ) continue
      const path = resolve(directory, child.name)
      if (child.isDirectory()) {
        visit(path)
        continue
      }
      if (!child.isFile() && !child.isSymbolicLink()) continue
      try {
        const stat = lstatSync(path)
        entries.push(`${relative(root, path)}\0${stat.size}\0${stat.mtimeMs}`)
      } catch {
        // A file changed while the snapshot was being collected. Omitting it
        // changes the signature and conservatively activates validation.
      }
    }
  }
  visit(root)
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

export function readDeliveryReportSignature(
  workspace: string,
): DeliveryReportSignature | undefined {
  const reportPath = resolve(workspace, ...VALIDATION_REPORT_PATH)
  if (!existsSync(reportPath)) return undefined
  const data = readFileSync(reportPath)
  const stat = statSync(reportPath)
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    digest: createHash('sha256').update(data).digest('hex'),
  }
}

export function evaluateDeliveryCompletion(input: {
  workspace: string
  messages: unknown[]
  reportBaseline?: DeliveryReportSignature
  requireTurnProvenance?: boolean
  readValidatorTranscript?: (agentId: string) => unknown[]
}): DeliveryCompletionGateResult {
  const reportPath = resolve(input.workspace, ...VALIDATION_REPORT_PATH)
  const currentSignature = readDeliveryReportSignature(input.workspace)
  const issues: string[] = []

  if (!currentSignature) {
    return rejected('A fresh native acceptance validator must write docs/acceptance/validation-report.json before delivery can stop.')
  }
  const requireTurnProvenance = input.requireTurnProvenance !== false
  let report: unknown
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (error) {
    return rejected(`The validation report is not valid JSON: ${toErrorMessage(error)}`)
  }
  if (!isRecord(report)) {
    return rejected('The validation report root must be a JSON object.')
  }

  const hasCurrentValidatorResult = requireTurnProvenance
    ? hasMatchingValidatorResult(input.messages, report)
    : false
  if (
    requireTurnProvenance &&
    sameSignature(input.reportBaseline, currentSignature) &&
    !hasCurrentValidatorResult
  ) {
    issues.push('The validation report was not refreshed during this delivery turn.')
  }

  const validatorId = stringValue(report.validatorId)
  if (validatorId !== DELIVERY_VALIDATOR_AGENT_TYPES[0]) {
    issues.push(`validatorId must equal ${DELIVERY_VALIDATOR_AGENT_TYPES[0]}.`)
  }
  if (requireTurnProvenance && !hasCurrentValidatorResult) {
    issues.push('The report is not the collected terminal JSON returned by a beegame-acceptance-validator Agent call in this turn.')
  }
  if (
    requireTurnProvenance &&
    input.readValidatorTranscript &&
    !validatorInvokedAcceptanceSkill(input.messages, input.readValidatorTranscript)
  ) {
    issues.push('The validator transcript does not contain a beegame-game-acceptance Skill invocation.')
  }

  const status = stringValue(report.status)
  if (!['passed', 'failed', 'blocked'].includes(status)) {
    issues.push('status must be passed, failed, or blocked.')
  }
  if (!stringValue(report.summary)) {
    issues.push('summary must describe the observed acceptance result.')
  }

  const capabilities = stringArray(report.verifiedCapabilities)
  if (!capabilities.includes(ACCEPTANCE_SKILL_CAPABILITY)) {
    issues.push(`verifiedCapabilities must include ${ACCEPTANCE_SKILL_CAPABILITY} from the validator run.`)
  }

  const requirements = recordArray(report.requirements)
  const playerPaths = recordArray(report.playerPaths)
  const findings = recordArray(report.findings)
  if (requirements.length === 0) issues.push('The report must include every approved MVP requirement.')
  if (playerPaths.length === 0) issues.push('The report must include every declared player path.')

  for (const requirement of requirements) {
    const id = stringValue(requirement.id) || '<missing requirement id>'
    const requirementStatus = stringValue(requirement.status)
    if (!['passed', 'failed', 'blocked', 'untested'].includes(requirementStatus)) {
      issues.push(`${id} has an invalid requirement status.`)
    }
    if (status === 'passed' && requirementStatus !== 'passed') {
      issues.push(`${id} is ${requirementStatus || 'missing status'} while the report claims passed.`)
    }
    if (recordArray(requirement.evidence).length === 0) {
      issues.push(`${id} has no observed evidence.`)
    }
  }

  for (const playerPath of playerPaths) {
    const id = stringValue(playerPath.id) || '<missing player path id>'
    const pathStatus = stringValue(playerPath.status)
    const runtimeEvidence = recordArray(playerPath.evidence).filter(evidence =>
      stringValue(evidence.kind) === 'runtime' && stringValue(evidence.source) === id,
    )
    if (!['passed', 'failed', 'blocked', 'untested'].includes(pathStatus)) {
      issues.push(`${id} has an invalid player-path status.`)
    }
    if (status === 'passed' && pathStatus !== 'passed') {
      issues.push(`${id} is ${pathStatus || 'missing status'} while the report claims passed.`)
    }
    if (pathStatus === 'passed' && runtimeEvidence.length === 0) {
      issues.push(`${id} passed without runtime evidence from the same declared player path.`)
    }
  }

  const assetAudit = auditAssetContract(input.workspace)
  if (assetAudit.present && !assetAudit.valid) {
    issues.push(...assetAudit.issues.map(issue => `Asset contract: ${issue}`))
  }

  if (status === 'failed') {
    issues.push('Acceptance failed. Repair the findings and invoke a fresh validator before stopping.')
  }
  if (status === 'blocked') {
    const concreteBlockers = findings.filter(finding =>
      stringValue(finding.status) === 'blocked' && Boolean(stringValue(finding.detail)),
    )
    if (concreteBlockers.length === 0) {
      issues.push('A blocked result must contain at least one concrete blocked finding.')
    }
  }

  if (issues.length > 0) return { allowed: false, outcome: 'rejected', issues }
  return {
    allowed: true,
    outcome: status === 'blocked' ? 'blocked' : 'passed',
    issues: [],
  }
}

export function evaluatePersistedDeliveryAcceptance(
  workspace: string,
): DeliveryCompletionGateResult {
  return evaluateDeliveryCompletion({
    workspace,
    messages: [],
    requireTurnProvenance: false,
  })
}

function hasMatchingValidatorResult(
  messages: unknown[],
  report: Record<string, unknown>,
): boolean {
  const validatorToolIds = new Set<string>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) === 'tool_use' &&
        stringValue(block.name) === 'Agent' &&
        isRecord(block.input) &&
        stringValue(block.input.subagent_type) === DELIVERY_VALIDATOR_AGENT_TYPES[0]
      ) {
        const id = stringValue(block.id)
        if (id) validatorToolIds.add(id)
      }
    }
  }
  if (validatorToolIds.size === 0) return false

  const validatorAgentIds = new Set<string>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) !== 'tool_result' ||
        !validatorToolIds.has(stringValue(block.tool_use_id))
      ) continue
      for (const candidate of collectJsonObjects(block.content)) {
        if (deepEqualJson(candidate, report)) return true
        const agentId = isRecord(candidate) ? stringValue(candidate.agentId) : ''
        if (agentId) validatorAgentIds.add(agentId)
        if (isRecord(candidate)) {
          for (const terminal of collectJsonObjects(candidate.content)) {
            if (deepEqualJson(terminal, report)) return true
          }
        }
      }
    }
  }

  if (validatorAgentIds.size === 0) return false
  const taskOutputToolIds = new Set<string>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) === 'tool_use' &&
        stringValue(block.name) === 'TaskOutput' &&
        isRecord(block.input) &&
        validatorAgentIds.has(stringValue(block.input.task_id))
      ) {
        const id = stringValue(block.id)
        if (id) taskOutputToolIds.add(id)
      }
    }
  }
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) !== 'tool_result' ||
        !taskOutputToolIds.has(stringValue(block.tool_use_id))
      ) continue
      for (const candidate of collectJsonObjects(block.content)) {
        if (deepEqualJson(candidate, report)) return true
        if (isRecord(candidate)) {
          for (const terminal of collectJsonObjects(candidate.content)) {
            if (deepEqualJson(terminal, report)) return true
          }
        }
      }
    }
  }
  return false
}

function validatorInvokedAcceptanceSkill(
  messages: unknown[],
  readTranscript: (agentId: string) => unknown[],
): boolean {
  const agentIds = collectValidatorAgentIds(messages)
  for (const agentId of agentIds) {
    for (const message of readTranscript(agentId)) {
      for (const block of messageContentBlocks(message)) {
        if (
          stringValue(block.type) === 'tool_use' &&
          stringValue(block.name) === 'Skill' &&
          isRecord(block.input) &&
          stringValue(block.input.skill) === 'beegame-game-acceptance'
        ) return true
      }
    }
  }
  return false
}

function collectValidatorAgentIds(messages: unknown[]): Set<string> {
  const validatorToolIds = new Set<string>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) === 'tool_use' &&
        stringValue(block.name) === 'Agent' &&
        isRecord(block.input) &&
        stringValue(block.input.subagent_type) === DELIVERY_VALIDATOR_AGENT_TYPES[0]
      ) {
        const id = stringValue(block.id)
        if (id) validatorToolIds.add(id)
      }
    }
  }
  const agentIds = new Set<string>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (
        stringValue(block.type) !== 'tool_result' ||
        !validatorToolIds.has(stringValue(block.tool_use_id))
      ) continue
      for (const candidate of collectJsonObjects(block.content)) {
        const agentId = isRecord(candidate) ? stringValue(candidate.agentId) : ''
        if (agentId) agentIds.add(agentId)
      }
    }
  }
  return agentIds
}

function messageContentBlocks(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !isRecord(value.message)) return []
  return recordArray(value.message.content)
}

function collectJsonObjects(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      try {
        const parsed = JSON.parse(item.trim()) as unknown
        if (isRecord(parsed)) found.push(parsed)
        visit(parsed)
      } catch {
        // Validator output is required to be one JSON object only. Prose and
        // markdown are deliberately not interpreted as evidence.
      }
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (isRecord(item)) {
      found.push(item)
      for (const child of Object.values(item)) visit(child)
    }
  }
  visit(value)
  return found
}

function deepEqualJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sameSignature(
  left: DeliveryReportSignature | undefined,
  right: DeliveryReportSignature,
): boolean {
  return Boolean(
    left &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size &&
    left.digest === right.digest,
  )
}

function rejected(issue: string): DeliveryCompletionGateResult {
  return { allowed: false, outcome: 'rejected', issues: [issue] }
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
