import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  MAX_NATIVE_REPLACEMENT_BYTES,
  foundationDocumentDraftPartCount,
  foundationDocumentDraftGroups,
  inspectFoundationDocumentDraft,
} from './foundation-document-draft'

export type FoundationDocumentMutationInput = Readonly<{
  content?: unknown
  old_string?: unknown
  new_string?: unknown
  replace_all?: unknown
}>

export type FoundationDocumentMutationAuthority =
  | Readonly<{ behavior: 'allow' }>
  | Readonly<{ behavior: 'deny'; message: string }>

/**
 * Mechanically simulates one proposed native file mutation. Bee Game Studio
 * never writes or repairs Markdown here; it only permits a native tool call
 * when the proposed result advances exactly one durable draft checkpoint.
 */
export function authorizeFoundationDocumentDraftMutation(input: {
  path: FoundationDocumentPath
  currentMarkdown?: string
  toolName: 'Write' | 'Edit'
  mutation: FoundationDocumentMutationInput
}): FoundationDocumentMutationAuthority {
  try {
    const before = inspectFoundationDocumentDraft(
      input.path,
      input.currentMarkdown,
    )
    const afterMarkdown = proposedMarkdown(input)
    const after = inspectFoundationDocumentDraft(input.path, afterMarkdown)
    if (before.complete)
      throw new Error('foundation document is already complete')
    if (!before.started) {
      if (
        after.started &&
        after.completedGroupCount === 0 &&
        after.completedPartCount === 0
      )
        return { behavior: 'allow' }
      return deny(
        'The first native Write may advance only the title and summary checkpoint.',
      )
    }
    const groups = foundationDocumentDraftGroups(input.path)
    const currentGroup = groups[before.completedGroupCount]
    const currentPartCount = currentGroup
      ? foundationDocumentDraftPartCount(currentGroup)
      : 0
    if (after.complete) {
      if (
        before.completedGroupCount === groups.length - 1 &&
        before.completedPartCount + 1 === currentPartCount
      )
        return { behavior: 'allow' }
      return deny('A bounded draft tool call may not skip directly to completion.')
    }
    if (
      after.completedGroupCount === before.completedGroupCount &&
      after.completedPartCount === before.completedPartCount + 1
    )
      return { behavior: 'allow' }
    if (
      after.completedGroupCount === before.completedGroupCount + 1 &&
      before.completedPartCount + 1 === currentPartCount &&
      after.completedPartCount === 0
    )
      return { behavior: 'allow' }
    return deny('Native document mutation must advance exactly one draft cursor checkpoint.')
  } catch (error) {
    return deny(
      `Draft cursor checkpoint is invalid: ${
        error instanceof Error
          ? error.message
          : 'Native document mutation is invalid.'
      }`,
    )
  }
}

function proposedMarkdown(input: {
  path: FoundationDocumentPath
  currentMarkdown?: string
  toolName: 'Write' | 'Edit'
  mutation: FoundationDocumentMutationInput
}): string {
  if (input.toolName === 'Write') {
    if (input.currentMarkdown?.trim())
      throw new Error('native Write cannot overwrite an existing draft')
    if (typeof input.mutation.content !== 'string')
      throw new Error('native Write content is required')
    if (
      Buffer.byteLength(input.mutation.content, 'utf8') >
      MAX_NATIVE_REPLACEMENT_BYTES
    )
      throw new Error(
        `native Write tool argument exceeds ${MAX_NATIVE_REPLACEMENT_BYTES} bytes`,
      )
    return input.mutation.content
  }
  if (!input.currentMarkdown)
    throw new Error('native Edit requires an existing draft')
  const oldString = input.mutation.old_string
  const newString = input.mutation.new_string
  if (typeof oldString !== 'string' || typeof newString !== 'string')
    throw new Error('native Edit strings are required')
  const before = inspectFoundationDocumentDraft(
    input.path,
    input.currentMarkdown,
  )
  const expectedCursor = `<!-- beegame-draft-cursor:${before.completedGroupCount}:${before.completedPartCount} -->`
  if (oldString !== expectedCursor || input.mutation.replace_all === true)
    throw new Error(`native Edit must replace only the current cursor ${expectedCursor}`)
  if (Buffer.byteLength(newString, 'utf8') > MAX_NATIVE_REPLACEMENT_BYTES)
    throw new Error(
      `native Edit tool argument exceeds ${MAX_NATIVE_REPLACEMENT_BYTES} bytes`,
    )
  if (input.currentMarkdown.split(oldString).length !== 2)
    throw new Error('native Edit cursor must occur exactly once')
  return input.currentMarkdown.replace(oldString, newString)
}

function deny(message: string): FoundationDocumentMutationAuthority {
  return { behavior: 'deny', message }
}
