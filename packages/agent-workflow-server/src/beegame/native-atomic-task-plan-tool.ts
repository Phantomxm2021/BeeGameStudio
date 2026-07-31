import { z } from 'zod/v4'

const verificationSchema = z.object({
  kind: z.enum(['test', 'build', 'runtime', 'file', 'asset']),
  commandOrAction: z.string().min(1),
  expectedResult: z.string().min(1),
}).strict()

const plannedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  allowedPaths: z.array(z.string().min(1)).min(1),
  expectedArtifacts: z.array(z.string().min(1)).min(1).max(8),
  verification: z.array(verificationSchema).min(1).max(9),
}).strict()

const ownershipEntrySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
}).strict()

const ownershipSchema = z.object({
  resourceRequirements: z.array(ownershipEntrySchema),
  checklistItems: z.array(ownershipEntrySchema),
  resourceImports: z.array(ownershipEntrySchema),
  resourceCompositions: z.array(ownershipEntrySchema),
}).strict()

const atomicTaskPlanInputSchema = z.object({
  tasks: z.array(plannedTaskSchema).min(1),
  ownership: ownershipSchema,
}).strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

export function createNativeAtomicTaskPlanTool(options: { buildTool: BuildTool }): unknown {
  return options.buildTool({
    name: 'SubmitAtomicTaskPlan',
    alwaysLoad: true,
    inputSchema: atomicTaskPlanInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the one complete atomic implementation task graph and its ownership maps for deterministic validation and persistence by the workflow service.'
    },
    async prompt() {
      return 'Call this tool exactly once with the complete task graph. Keep each task cohesive: group related files up to 8 durable artifacts and 9 verification conditions, and split only larger feature groups along artifact boundaries. The workflow service validates the structured input and owns the canonical evidence file; do not write an evidence file yourself.'
    },
    async checkPermissions(input: z.infer<typeof atomicTaskPlanInputSchema>) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof atomicTaskPlanInputSchema>) {
      return { data: { accepted: true, taskCount: input.tasks.length } }
    },
    renderToolUseMessage() { return '提交原子任务计划' },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
    },
  })
}
