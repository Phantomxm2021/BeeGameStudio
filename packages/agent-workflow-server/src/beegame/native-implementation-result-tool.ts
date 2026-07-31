import { z } from 'zod/v4'

const resourceReferenceSchema = z.object({
  importId: z.string().min(1),
  references: z.array(z.string().min(1)).min(1),
  runtimeEventIds: z.array(z.string().min(1)),
}).strict()

const compositionIntegrationSchema = z.object({
  compositionId: z.string().min(1),
  recipePath: z.string().min(1),
  references: z.array(z.string().min(1)).min(1),
  runtimeEventIds: z.array(z.string().min(1)),
}).strict()

const requirementSatisfactionSchema = z.object({
  requirementId: z.string().min(1),
  importIds: z.array(z.string().min(1)),
  compositionIds: z.array(z.string().min(1)),
  projectReferences: z.array(z.string().min(1)).min(1),
}).strict()

const implementationResultInputSchema = z.object({
  status: z.enum(['completed', 'failed', 'blocked']),
  changedPaths: z.array(z.string().min(1)),
  verificationObservations: z.array(z.string().min(1)),
  resourceReferences: z.array(resourceReferenceSchema).default([]),
  compositionIntegrations: z.array(compositionIntegrationSchema).default([]),
  requirementSatisfactions: z.array(requirementSatisfactionSchema).default([]),
}).strict()

type BuildTool = (definition: Record<string, unknown>) => unknown

export function createNativeImplementationResultTool(options: {
  buildTool: BuildTool
}): unknown {
  return options.buildTool({
    name: 'SubmitImplementationResult',
    alwaysLoad: true,
    inputSchema: implementationResultInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Submit the completed atomic implementation task result for deterministic workflow validation and evidence persistence.'
    },
    async prompt() {
      return 'Call this tool exactly once after implementing and verifying the active task. verificationObservations must contain one concise entry for every active task verification in the same order. The workflow service assigns indexes and statuses, defers runtime checks to final acceptance, derives verified artifacts from the active task, and validates exact coverage. The workflow service supplies task identity, revision, canonical evidence path, and enforces the active resource ID scope. Omit resourceReferences, compositionIntegrations, and requirementSatisfactions when their active ID lists are empty.'
    },
    async checkPermissions(
      input: z.infer<typeof implementationResultInputSchema>,
    ) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: z.infer<typeof implementationResultInputSchema>) {
      return {
        data: {
          accepted: true,
          status: input.status,
          verificationCount: input.verificationObservations.length,
        },
      }
    },
    renderToolUseMessage() {
      return '提交实现结果'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}
