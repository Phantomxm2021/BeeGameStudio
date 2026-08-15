import {
  changeImpactSubmissionSchema,
  questionAnswerSubmissionSchema,
} from './delivery-workflow/worker-contracts'

type BuildTool = (definition: Record<string, unknown>) => unknown

type WorkflowResultWorker = 'change-impact-analyzer' | 'question-answerer'

const definitions = {
  'change-impact-analyzer': {
    name: 'SubmitChangeImpactResult',
    schema: changeImpactSubmissionSchema,
    description: 'Submit the structured impact classification for the change.',
    prompt:
      'Call exactly once after analyzing the requested change. Submit classification, affected IDs, and rationale. The workflow service owns canonical evidence.',
    message: '提交变更影响分析',
  },
  'question-answerer': {
    name: 'SubmitQuestionAnswerResult',
    schema: questionAnswerSubmissionSchema,
    description: 'Submit the answer to the active delivery question.',
    prompt:
      'Call exactly once with the answer. The workflow service owns canonical evidence.',
    message: '提交问题回答',
  },
} as const

export function createNativeWorkflowResultTool(options: {
  buildTool: BuildTool
  workerType: WorkflowResultWorker
}): unknown {
  const definition = definitions[options.workerType]
  const schema = definition.schema
  return options.buildTool({
    name: definition.name,
    alwaysLoad: true,
    inputSchema: schema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return definition.description
    },
    async prompt() {
      return definition.prompt
    },
    async checkPermissions(input: unknown) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      return { data: { accepted: true, workerType: options.workerType } }
    },
    renderToolUseMessage() {
      return definition.message
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
