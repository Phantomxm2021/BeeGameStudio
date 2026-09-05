import { randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath, type WorkerDispatchRequest } from './delivery-workflow/types'
import { foundationAuthoringSources } from './delivery-workflow/foundation-authoring-contract'
import { canonicalFoundationAuthorityProjectionBytes, foundationProjectionRelativePath, modelFoundationAuthorityProjectionBytes, projectFoundationAuthority, type FoundationAuthorityProjection } from './foundation-authority-projection'

export async function buildFoundationAuthorAuthorityBlock(request: WorkerDispatchRequest, onProjection?: (projection: FoundationAuthorityProjection) => void): Promise<string> {
  if (!isFoundationDocumentAuthoringTurn(request)) return ''
  const targetPath = request.contract.foundationDocumentPath
  if (
    typeof targetPath !== 'string' ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(
      targetPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
    )
  )
    throw new Error('initial document authority target is invalid')
  const upstreamPaths = Array.isArray(request.contract.availableUpstreamPaths)
    ? request.contract.availableUpstreamPaths
    : []
  if (
    new Set(upstreamPaths).size !== upstreamPaths.length ||
    upstreamPaths.some(
      path =>
        typeof path !== 'string' ||
        path === targetPath ||
        !CANONICAL_FOUNDATION_DOCUMENTS.includes(
          path as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
        ),
    )
  )
    throw new Error('initial document upstream authority is invalid')

  const typedTargetPath =
    targetPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
  const expectedUpstreamPaths = foundationAuthoringSources(
    typedTargetPath,
  ).map(source => source.path)
  if (
    (upstreamPaths.length !== expectedUpstreamPaths.length ||
      expectedUpstreamPaths.some(
        (path, index) => upstreamPaths[index] !== path,
      ))
  )
    throw new Error(
      'initial document upstream authority does not match its contract',
    )
  let targetExists = true
  try {
    await access(resolve(request.workspacePath, targetPath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') targetExists = false
    else throw error
  }
  await Promise.all(
    upstreamPaths.map(path => access(resolve(request.workspacePath, path))),
  )
  const dispatchId = request.dispatchId
  if (
    typeof dispatchId !== 'string' ||
    !dispatchId ||
    [...dispatchId].some(
      character =>
        !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(
          character,
        ),
    )
  )
    throw new Error(
      'initial document authority projection requires a dispatch identity',
    )
  const projectionRelativePath = foundationProjectionRelativePath(dispatchId)
  const projection = await persistFoundationAuthorityIndex({
    ...request,
    dispatchId,
  })
  onProjection?.(projection)
  return [
    upstreamPaths.length
      ? [
          'BGS projected the complete selected upstream authority below without summarization or rewriting. Use it as the upstream authority for this assignment.',
          `--- BEGIN FOUNDATION AUTHORITY ${projectionRelativePath} ---`,
          modelFoundationAuthorityProjectionBytes(projection).trimEnd(),
          `--- END FOUNDATION AUTHORITY ${projectionRelativePath} ---`,
        ].join('\n')
      : undefined,
    targetExists
      ? `An existing ${targetPath} is present, but this stream must return a complete replacement Markdown body from current authority.`
      : `The assigned target is ${targetPath}.`,
  ].filter(Boolean).join('\n\n')
}

export function isFoundationDocumentAuthoringTurn(
  request: WorkerDispatchRequest,
): boolean {
  return (
    request.workerType === 'document-author' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    ) &&
    request.contract.documentSet === 'foundation' &&
    typeof request.contract.foundationDocumentPath === 'string' &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(
      request.contract.foundationDocumentPath as never,
    )
  )
}

async function persistFoundationAuthorityIndex(
  request: WorkerDispatchRequest,
): Promise<FoundationAuthorityProjection> {
  if (!isFoundationDocumentAuthoringTurn(request))
    throw new Error(
      'foundation authority index requires a document authoring turn',
    )
  const targetPath = request.contract.foundationDocumentPath as never
  const availableUpstreamPaths = Array.isArray(
    request.contract.availableUpstreamPaths,
  )
    ? (request.contract.availableUpstreamPaths as FoundationDocumentPath[])
    : []
  const documents = new Map<
    (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
    string
  >()
  await Promise.all(
    foundationAuthoringSources(targetPath)
      .filter(source => availableUpstreamPaths.includes(source.path))
      .map(async source => {
        documents.set(
          source.path,
          await readFile(resolve(request.workspacePath, source.path), 'utf8'),
        )
      }),
  )
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths,
    documents,
  })
  const relativePath = foundationProjectionRelativePath(request.dispatchId!)
  await durableWriteProjection(
    resolve(request.workspacePath, relativePath),
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
  return projection
}

async function durableWriteProjection(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
