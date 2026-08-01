import {
  changeImpactSubmissionSchema,
  documentAuthorSubmissionSchema,
  documentReviewSubmissionSchemaForMode,
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
      'Call exactly once after completing the document assignment. Submit only resolvedFindingIds. Include exactly the IDs under contract.remediation.findings; when contract.remediation is absent, submit an empty array even if contract.checklistRemediation is present. The workflow service derives written paths from completed file mutations and owns revisions.',
    message: '提交文档编写结果',
  },
  'document-reviewer': {
    name: 'SubmitDocumentReviewResult',
    schema: undefined,
    description:
      'Submit the complete document review check matrix, verdict, and structured findings.',
    prompt:
      'Call exactly once after reviewing the active contract. Treat the systemDeliveryContract artifact as fixed system authority and block project artifacts that conflict with it even when they agree with each other. cross_document_consistency, technical_feasibility, content_structure_fitness and resource_content_consistency must cite an exact systemDeliveryContract JSON Pointer whenever the check is present. Submit every required check with a concise conclusion, exact evidence anchors and findingIds, then submit the verdict and structured findings. Every finding has one stable findingId, checkId, owner, exact subjects, observation, blockingReason, requiredAction and closureCondition. The workflow owns revision, reviewed paths, checklist coverage and canonical evidence. READY requires every required check to pass and no findings; NEEDS_REVISION requires a blocking check and finding.',
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
  documentReviewMode?: 'initial' | 'closure'
  documentReviewScope?: 'foundation' | 'complete'
}): unknown {
  const definition = definitions[options.workerType]
  const schema =
    options.workerType === 'document-reviewer'
      ? documentReviewSubmissionSchemaForMode(
          options.documentReviewMode ?? 'initial',
          options.documentReviewScope ?? 'foundation',
        )
      : definition.schema
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
      return options.workerType === 'document-reviewer' &&
        options.documentReviewMode === 'initial'
        ? `${definition.prompt} Initial Review findings cannot contain regressionPaths; that field exists only in Closure Review.`
        : definition.prompt
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
