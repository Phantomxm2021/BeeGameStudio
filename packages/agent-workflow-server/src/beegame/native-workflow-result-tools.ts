import {
  changeImpactSubmissionSchema,
  documentRepairPlanSubmissionSchemaForGroupCount,
  documentReviewPacketSubmissionSchemaForContract,
  questionAnswerSubmissionSchema,
  resourceContentSubmissionSchema,
} from './delivery-workflow/worker-contracts'
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
  | 'resource-content-author'

const definitions = {
  'document-reviewer': {
    name: 'SubmitDocumentReviewPacket',
    schema: undefined,
    description:
      'Submit the current transactional document review packet and its structured findings.',
    prompt:
      'Submit exactly contract.currentCheckIds as one ordered checks array. Each check contains exactly conclusion, evidence, assessments and findings, without an id. Each assessment contains exactly criterion, status, evidence, derivation and conclusion and uses the criterion IDs supplied for that check. Every evidence or subject entry contains exactly referenceId; result, note, paths, anchors and subjectOwner are invalid. Each finding contains findingId, evidence, subjects, observation, blockingImpact and one authority-preserving requiredOutcome; regressionPaths is allowed only in Closure Review. In Closure, an unresolved prior finding preserves its findingId and exact requiredOutcome; a different defect inside an active check uses a new findingId, and regressionPaths is present only when the changed paths directly introduced it. The service derives check identity, check status, check findingIds and subject ownership. A rejected call accepts nothing: correct the same packet without prose or user confirmation. The workflow atomically persists every check in the packet to the single review cycle and derives the final verdict only after every required check is accepted.',
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
  'resource-content-author': {
    name: 'SubmitResourceContentResult',
    schema: resourceContentSubmissionSchema,
    description:
      'Submit completion of the canonical JSON/YAML content set or exact missing resource requirements.',
    prompt:
      'Call exactly once. completed requires the complete canonical JSON/YAML set and an empty missingRequirementIds array. needs_inventory requires exact current Manifest requirement IDs and does not authorize resource mutation.',
    message: '提交资源内容结果',
  },
} as const

const documentRepairPlanDefinition = {
  name: 'SubmitDocumentRepairPlan',
  schema: undefined,
  description:
    'Submit one ordered repair decision for every service-owned coherent finding group.',
  prompt:
    'Call exactly once with a decisions array aligned by position to contract.repairPlanTask.groups. Each decision must be the minimum internally consistent repair for that group and preserve earlier dependency outcomes. Do not repeat service-owned identities, write project files, reopen review, add unrelated design, or return prose.',
  message: '提交文档修订方案',
} as const

export function createNativeWorkflowResultTool(options: {
  buildTool: BuildTool
  workerType: WorkflowResultWorker
  documentReviewContract?: DocumentReviewSubmissionContract
  documentAuthorMode?: 'initial' | 'repair-planning' | 'remediation'
  documentRepairGroupCount?: number
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
    !options.documentRepairGroupCount
  )
    throw new Error('document repair plan group count is missing')
  const definition =
    options.workerType === 'document-author'
      ? documentRepairPlanDefinition
      : definitions[options.workerType]
  const schema =
    options.workerType === 'document-reviewer'
      ? documentReviewPacketSubmissionSchemaForContract(documentReviewContract!)
      : options.workerType === 'document-author'
        ? documentRepairPlanSubmissionSchemaForGroupCount(
            options.documentRepairGroupCount!,
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
        parseAndValidateDocumentReviewPacketSubmission({
          contract: documentReviewContract!,
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
