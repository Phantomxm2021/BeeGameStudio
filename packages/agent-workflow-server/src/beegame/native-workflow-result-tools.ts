import {
  changeImpactSubmissionSchema,
  documentAuthorSubmissionSchema,
  documentReviewSubmissionSchema,
  questionAnswerSubmissionSchema,
} from './delivery-workflow/worker-contracts'

type BuildTool = (definition: Record<string, unknown>) => unknown

type WorkflowResultWorker =
  | 'document-author'
  | 'document-reviewer'
  | 'change-impact-analyzer'
  | 'question-answerer'

const definitions = {
  'document-author': {
    name: 'SubmitDocumentAuthorResult',
    schema: documentAuthorSubmissionSchema,
    description:
      'Submit completion after the assigned canonical documents have been written.',
    prompt:
      'Call exactly once after completing the document assignment. Submit only resolvedFindingIds. Use an empty array outside remediation. The workflow service derives written paths from completed file mutations and owns revisions.',
    message: '提交文档编写结果',
  },
  'document-reviewer': {
    name: 'SubmitDocumentReviewResult',
    schema: documentReviewSubmissionSchema,
    description:
      'Submit the document review verdict and structured findings.',
    prompt:
      'Call exactly once after reviewing the active canonical document set. Submit only verdict and findings. The workflow service owns revision, reviewed paths, checklist coverage, finding persistence, and canonical evidence. READY cannot contain blocking findings; NEEDS_REVISION requires a blocking finding.',
    message: '提交文档审阅结果',
  },
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
  return options.buildTool({
    name: definition.name,
    alwaysLoad: true,
    inputSchema: definition.schema,
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
