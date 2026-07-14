import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import {
  parseDeliveryValidatorReport,
  type DeliveryValidatorReport,
} from './delivery-contract'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'
import { auditGameProductionReadiness } from './production-readiness-audit'
import { auditProjectDeliveryContract } from './project-delivery-contract-audit'

export type GameProductionCompletionAudit = {
  valid: boolean
  issues: string[]
  validatorReport?: DeliveryValidatorReport
}

export function auditGameProductionCompletion(
  workspacePath: string,
  messages: unknown[],
): GameProductionCompletionAudit {
  const readiness = auditGameProductionReadiness(workspacePath)
  const issues = [...readiness.issues]
  const contract = auditProjectDeliveryContract(workspacePath)
  const validatorReport = findLatestValidatorReport(messages)

  if (!validatorReport) {
    issues.push('A complete JSON result from beegame-acceptance-validator is required.')
  } else {
    if (validatorReport.status !== 'passed') {
      issues.push(`Acceptance validator status is ${validatorReport.status}, not passed.`)
    }
    const reportById = new Map(validatorReport.requirements.map(requirement => [requirement.id, requirement]))
    for (const requirement of contract.requirements.filter(requirement => requirement.scope === 'mvp')) {
      const result = reportById.get(requirement.id)
      if (!result) {
        issues.push(`Acceptance validator omitted MVP requirement: ${requirement.id}`)
        continue
      }
      if (result.status !== 'passed') {
        issues.push(`MVP requirement ${requirement.id} is ${result.status}, not passed.`)
      }
      for (const evidenceKind of requirement.evidenceRequired) {
        if (!result.evidence.some(evidence => evidence.kind === evidenceKind)) {
          issues.push(`MVP requirement ${requirement.id} is missing ${evidenceKind} evidence.`)
        }
      }
      if (requirement.evidenceRequired.includes('runtime')) {
        const allowedPlayerPaths = new Set(Object.entries(contract.playerPathRequirements)
          .filter(([, requirementIds]) => requirementIds.includes(requirement.id))
          .map(([playerPathId]) => playerPathId))
        if (!result.evidence.some(evidence => (
          evidence.kind === 'runtime' &&
          typeof evidence.source === 'string' &&
          allowedPlayerPaths.has(evidence.source)
        ))) {
          issues.push(`MVP requirement ${requirement.id} has no runtime evidence from a covering player path.`)
        }
      }
    }
    const verifiedCapabilities = new Set(validatorReport.verifiedCapabilities)
    for (const capability of contract.requiredCapabilities) {
      if (!verifiedCapabilities.has(capability)) {
        issues.push(`Acceptance validator did not verify required capability: ${capability}`)
      }
    }
    const playerPathResults = new Map(validatorReport.playerPaths.map(playerPath => [playerPath.id, playerPath]))
    for (const playerPathId of contract.playerPathIds) {
      const result = playerPathResults.get(playerPathId)
      if (!result) {
        issues.push(`Acceptance validator omitted player path: ${playerPathId}`)
        continue
      }
      if (result.status !== 'passed') {
        issues.push(`Player path ${playerPathId} is ${result.status}, not passed.`)
      }
      if (!result.evidence.some(evidence => evidence.kind === 'runtime' && evidence.source === playerPathId)) {
        issues.push(`Player path ${playerPathId} has no direct runtime evidence.`)
      }
    }
  }

  const validationReportPath = resolve(workspacePath, 'docs', 'validation-report.md')
  if (!isNonEmptyFile(validationReportPath)) {
    issues.push('docs/validation-report.md must be derived from the final validator result.')
  }
  const validationResultPath = resolve(workspacePath, 'docs', 'validation-report.json')
  if (!validatorReport || !persistedValidatorResultMatches(validationResultPath, validatorReport)) {
    issues.push('docs/validation-report.json must exactly match the final validator result.')
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    ...(validatorReport ? { validatorReport } : {}),
  }
}

function persistedValidatorResultMatches(
  path: string,
  validatorReport: DeliveryValidatorReport,
): boolean {
  try {
    const persisted = parseDeliveryValidatorReport(
      readFileSync(path, 'utf8'),
      DELIVERY_VALIDATOR_AGENT_TYPES[0],
    )
    return Boolean(persisted) && JSON.stringify(persisted) === JSON.stringify(validatorReport)
  } catch {
    return false
  }
}

export function findLatestValidatorReport(messages: unknown[]): DeliveryValidatorReport | undefined {
  const toolUseIds = new Set<string>()
  const toolResults = new Map<string, string[]>()
  let latestStructuredReport: DeliveryValidatorReport | undefined
  visitValues(messages, value => {
    if (!isRecord(value)) return
    if (value.type === 'delivery.validation' && isRecord(value.report)) {
      const report = parseDeliveryValidatorReport(
        JSON.stringify(value.report),
        DELIVERY_VALIDATOR_AGENT_TYPES[0],
      )
      if (report) latestStructuredReport = report
      return
    }
    if (value.type === 'tool_use' && value.name === 'Agent' && isRecord(value.input)) {
      if (
        value.input.subagent_type === DELIVERY_VALIDATOR_AGENT_TYPES[0] &&
        typeof value.id === 'string'
      ) toolUseIds.add(value.id)
      return
    }
    if (value.type === 'tool_result' && typeof value.tool_use_id === 'string') {
      const texts = collectText(value.content)
      if (texts.length > 0) toolResults.set(value.tool_use_id, texts)
    }
  })

  if (latestStructuredReport) return latestStructuredReport
  let latest: DeliveryValidatorReport | undefined
  for (const toolUseId of toolUseIds) {
    for (const text of toolResults.get(toolUseId) ?? []) {
      const json = readFirstJsonObject(text)
      const report = parseDeliveryValidatorReport(json, DELIVERY_VALIDATOR_AGENT_TYPES[0])
      if (report) latest = report
    }
  }
  return latest
}

export function readValidatorReportFromTaskOutput(
  taskId: string,
  outputFile: string,
): DeliveryValidatorReport | undefined {
  if (!taskId.trim() || !outputFile.trim()) return undefined
  try {
    const resolved = realpathSync(outputFile)
    if (basename(resolved) !== `${taskId}.output`) return undefined
    const file = statSync(resolved)
    if (!file.isFile() || file.size <= 0 || file.size > 8 * 1024 * 1024) return undefined
    return findLastValidatorReportInText(readFileSync(resolved, 'utf8'))
  } catch {
    return undefined
  }
}

export function findLastValidatorReportInText(value: string): DeliveryValidatorReport | undefined {
  let latest: DeliveryValidatorReport | undefined
  let offset = 0
  while (offset < value.length) {
    const object = readFirstJsonObject(value.slice(offset))
    if (!object) break
    const start = value.indexOf(object, offset)
    const report = parseDeliveryValidatorReport(object, DELIVERY_VALIDATOR_AGENT_TYPES[0])
    if (report) latest = report
    offset = start + object.length
  }
  return latest
}

function readFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }
  return undefined
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return [item]
    if (isRecord(item) && typeof item.text === 'string') return [item.text]
    return []
  })
}

function visitValues(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value)
  if (Array.isArray(value)) {
    for (const item of value) visitValues(item, visitor)
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) visitValues(item, visitor)
  }
}

function isNonEmptyFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
