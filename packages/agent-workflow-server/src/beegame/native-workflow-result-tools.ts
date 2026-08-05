import {
  changeImpactSubmissionSchema,
  documentRepairPlanSubmissionSchemaForContract,
  documentReviewPacketSubmissionSchemaForContract,
  documentReviewPacketWireSchema,
  questionAnswerSubmissionSchema,
} from './delivery-workflow/worker-contracts'
import type { DocumentRepairPlanSubmissionContract } from './delivery-workflow/worker-contracts'
import {
  parseAndValidateDocumentReviewPacketSubmission,
  type DocumentReviewSubmissionContract,
} from './delivery-workflow/document-review-input'

type BuildTool = (definition: Record<string, unknown>) => unknown

type WorkflowResultWorker =
  | 'document-author'
  | 'document-reviewer'
  | 'change-impact-analyzer'
  | 'question-answerer'

const definitions = {
  'document-reviewer': {
    name: 'SubmitDocumentReviewPacket',
    schema: undefined,
    description:
      'Submit the current transactional document review packet and its structured findings.',
    prompt:
      'Submit exactly contract.currentCheckIds as one ordered checks array. Design checks contain assessments and findings; the service derives their check-level status, evidence and conclusion. Non-design checks additionally contain conclusion and evidence and have an empty assessments array. Each assessment contains exactly criterion, status, evidence, one decision-dense derivation and one direct conclusion and uses the criterion IDs supplied for that check. Do not summarize documents or repeat evidence prose. Every evidence or subject entry contains exactly referenceId. Each finding contains findingId, evidence, subjects, observation, blockingImpact and one authority-preserving requiredOutcome; regressionPaths is allowed only in Closure Review. The service derives check identity, finding IDs and subject ownership. A rejected call accepts nothing: correct the same packet without prose or user confirmation.',
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

const documentRepairPlanDefinition = {
  name: 'SubmitDocumentRepairPlan',
  schema: undefined,
  description:
    'Submit one ordered group decision and its exact coordinated path decisions for every service-owned coherent finding group.',
  prompt:
    'Call exactly once with a decisions array aligned by position to contract.repairPlanTask.groups. For each group submit one groupDecision and one pathDecision for every path that must change. Cover all subjectPaths; add only candidatePaths required to keep downstream references consistent. Do not repeat service-owned identities, write project files, reopen review, add unrelated design, or return prose.',
  message: '提交文档修订方案',
} as const

export function createNativeWorkflowResultTool(options: {
  buildTool: BuildTool
  workerType: WorkflowResultWorker
  documentReviewContract?: DocumentReviewSubmissionContract
  getDocumentReviewContract?: () => DocumentReviewSubmissionContract | undefined
  documentAuthorMode?: 'initial' | 'repair-planning' | 'remediation'
  documentRepairPlanContract?: DocumentRepairPlanSubmissionContract
}): unknown {
  const documentReviewContract = options.documentReviewContract
  if (options.workerType === 'document-reviewer' && !documentReviewContract)
    throw new Error('document reviewer submission contract is missing')
  if (
    options.workerType === 'document-author' &&
    options.documentAuthorMode !== 'repair-planning'
  )
    throw new Error(
      'document author completion is owned by CommitCanonicalDocument',
    )
  if (
    options.workerType === 'document-author' &&
    options.documentAuthorMode === 'repair-planning' &&
    !options.documentRepairPlanContract
  )
    throw new Error('document repair plan contract is missing')
  const definition =
    options.workerType === 'document-author'
      ? documentRepairPlanDefinition
      : definitions[options.workerType]
  const schema =
    options.workerType === 'document-reviewer'
      ? documentReviewPacketWireSchema
      : options.workerType === 'document-author'
        ? documentRepairPlanSubmissionSchemaForContract(
            options.documentRepairPlanContract!,
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
        documentReviewContract!.mode === 'initial'
        ? `${definition.prompt} Initial Review findings cannot contain regressionPaths; that field exists only in Closure Review.`
        : definition.prompt
    },
    async checkPermissions(input: unknown) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      if (options.workerType === 'document-reviewer') {
        const activeContract =
          options.getDocumentReviewContract?.() ?? documentReviewContract
        if (!activeContract)
          throw new Error('document reviewer active contract is missing')
        parseAndValidateDocumentReviewPacketSubmission({
          contract: activeContract,
          submission: input,
        })
      }
      if (options.workerType === 'document-author') schema!.parse(input)
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
