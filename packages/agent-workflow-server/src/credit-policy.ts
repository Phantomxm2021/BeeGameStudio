export type BeeGameCreditTaskType =
  | 'idea_intake'
  | 'full_build'
  | 'edit_turn'
  | 'continue_turn'
  | 'asset_integration'
  | 'large_build'
  | 'agent_turn'

export type BeeGameCreditTaskPolicy = {
  taskType: BeeGameCreditTaskType
  reservedCredits: number
  displayName: string
  description: string
}

const DEFAULT_TASK_POLICIES: Record<BeeGameCreditTaskType, BeeGameCreditTaskPolicy> = {
  idea_intake: {
    taskType: 'idea_intake',
    reservedCredits: 3,
    displayName: 'Idea intake',
    description: 'Generate game mode options from an initial idea.',
  },
  full_build: {
    taskType: 'full_build',
    reservedCredits: 200,
    displayName: 'Full game build',
    description: 'Start a new confirmed game build.',
  },
  edit_turn: {
    taskType: 'edit_turn',
    reservedCredits: 50,
    displayName: 'Game edit',
    description: 'Modify or debug an existing game project.',
  },
  continue_turn: {
    taskType: 'continue_turn',
    reservedCredits: 100,
    displayName: 'Continue task',
    description: 'Continue an existing agent task or failed check.',
  },
  asset_integration: {
    taskType: 'asset_integration',
    reservedCredits: 50,
    displayName: 'Asset integration',
    description: 'Ask the agent to integrate uploaded project assets.',
  },
  large_build: {
    taskType: 'large_build',
    reservedCredits: 500,
    displayName: 'Large build',
    description: 'Run a larger or more complex build request.',
  },
  agent_turn: {
    taskType: 'agent_turn',
    reservedCredits: 100,
    displayName: 'Agent turn',
    description: 'Run a general BeeGame agent turn.',
  },
}

export type BeeGameCreditQuote = BeeGameCreditTaskPolicy & {
  balanceCredits: number
  canStart: boolean
  message: string
}

export function getCreditTaskPolicy(
  value: unknown,
): BeeGameCreditTaskPolicy {
  const taskType = normalizeCreditTaskType(value)
  const base = DEFAULT_TASK_POLICIES[taskType]
  return {
    ...base,
    reservedCredits: getReservedCreditsOverride(taskType, base.reservedCredits),
  }
}

export function quoteCreditTask(input: {
  taskType: unknown
  balanceCredits: number
}): BeeGameCreditQuote {
  const policy = getCreditTaskPolicy(input.taskType)
  const canStart = input.balanceCredits >= policy.reservedCredits
  return {
    ...policy,
    balanceCredits: input.balanceCredits,
    canStart,
    message: canStart
      ? `This request will reserve ${policy.reservedCredits} credits. Unused credits will be refunded.`
      : `This request requires ${policy.reservedCredits} credits, but only ${input.balanceCredits} credits are available.`,
  }
}

export function normalizeCreditTaskType(
  value: unknown,
): BeeGameCreditTaskType {
  if (value === 'idea_intake' ||
    value === 'full_build' ||
    value === 'edit_turn' ||
    value === 'continue_turn' ||
    value === 'asset_integration' ||
    value === 'large_build' ||
    value === 'agent_turn') {
    return value
  }
  return 'agent_turn'
}

function getReservedCreditsOverride(
  taskType: BeeGameCreditTaskType,
  fallback: number,
): number {
  const envKey = `BEEGAME_RESERVED_CREDITS_${taskType.toUpperCase()}`
  const raw = Number.parseInt(process.env[envKey] ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}
