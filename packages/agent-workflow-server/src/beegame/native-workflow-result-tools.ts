import {
  changeImpactSubmissionSchema,
  documentAuthorSubmissionSchema,
  documentRepairDecisionSubmissionSchema,
  documentReviewCheckSubmissionSchemaForMode,
  questionAnswerSubmissionSchema,
} from './delivery-workflow/worker-contracts'
import {
  validateDocumentReviewSubmission,
  normalizeDocumentReviewCheckSubmission,
  type DocumentReviewCheckSubmission,
  type DocumentReviewSubmissionContract,
} from './delivery-workflow/document-review-input'
import type { DocumentReviewFinding } from './delivery-workflow/types'

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
    name: 'SubmitDocumentReviewCheck',
    schema: undefined,
    description:
      'Submit the current document review check and its structured findings.',
    prompt:
      'Submit exactly contract.currentCheckId once. Evidence and subjects use only referenceId values supplied by contract.referenceIndex; never copy paths or anchors. A rejected call is not accepted: correct the same check without prose or user confirmation. The workflow persists this check in the single review cycle and derives the final verdict only after every required check is accepted.',
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

const documentRepairDecisionDefinition = {
  name: 'SubmitDocumentRepairDecision',
  schema: documentRepairDecisionSubmissionSchema,
  description:
    'Submit the single repair decision for the current accepted finding.',
  prompt:
    'Call exactly once. State the immutable constraints and lock one minimal decision for contract.repairDecisionTask.finding. The service owns finding identity, affected paths, ordering and ledger persistence. Do not write project files, reopen review, add unrelated design, or return prose.',
  message: '提交文档修订决策',
} as const

export function createNativeWorkflowResultTool(options: {
  buildTool: BuildTool
  workerType: WorkflowResultWorker
  documentReviewMode?: 'initial' | 'closure'
  documentReviewScope?: 'foundation' | 'complete'
  documentReviewContract?: DocumentReviewSubmissionContract
  documentAuthorMode?: 'initial' | 'repair-planning' | 'remediation'
}): unknown {
  const definition =
    options.workerType === 'document-author' &&
    options.documentAuthorMode === 'repair-planning'
      ? documentRepairDecisionDefinition
      : definitions[options.workerType]
  const schema =
    options.workerType === 'document-reviewer'
      ? documentReviewCheckSubmissionSchemaForMode(
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
      if (options.workerType === 'document-reviewer') {
        if (!options.documentReviewContract)
          throw new Error('document reviewer submission contract is missing')
        const submission = documentReviewCheckSubmissionSchemaForMode(
          options.documentReviewMode ?? 'initial',
          options.documentReviewScope ?? 'foundation',
        ).parse(input)
        const normalized = normalizeDocumentReviewCheckSubmission({
          contract: options.documentReviewContract,
          submission: submission as unknown as DocumentReviewCheckSubmission,
        })
        const issues = validateDocumentReviewSubmission({
          contract: options.documentReviewContract,
          checks: [normalized.check],
          findings: normalized.findings,
        })
        if (issues.length)
          throw new Error(
            `document review submission rejected: ${issues.join('; ')}`,
          )
      }
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
