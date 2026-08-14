import { dirname, isAbsolute, sep } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { diagnosticTracker } from 'src/services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from 'src/services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from 'src/services/lsp/manager.js'
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js'
import { checkTeamMemSecrets } from 'src/services/teamMemorySync/teamMemSecretGuard.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from 'src/skills/loadSkillsDir.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import { countLinesChanged } from 'src/utils/diff.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { errorMessage, isENOENT } from 'src/utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  getFileModificationTime,
  suggestPathUnderCwd,
  writeTextContent,
} from 'src/utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from 'src/utils/fileHistory.js'
import { logFileOperation } from 'src/utils/fileOperationAnalytics.js'
import { formatFileSize } from 'src/utils/format.js'
import {
  type LineEndingType,
  readFileSyncWithMetadata,
} from 'src/utils/fileRead.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { fetchSingleFileGitDiff, type ToolUseDiff } from 'src/utils/gitDiff.js'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
import { matchingRuleForInput } from 'src/utils/permissions/filesystem.js'
import { validateInputForSettingsFileEdit } from 'src/utils/settings/validateEditTool.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../NotebookEditTool/constants.js'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from './constants.js'
import type { FileEdit, FileEditsRequest } from './types.js'
import { resolveFileEdits } from './utils.js'

const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024

export type FileEditsValidationResult =
  | { result: true; resolvedEdits: FileEdit[] }
  | {
      result: false
      behavior: 'ask'
      message: string
      errorCode: number
      meta?: Record<string, string>
    }

export type SharedFileEditOutput = {
  filePath: string
  edits: FileEdit[]
  originalFile: string
  structuredPatch: ReturnType<typeof resolveFileEdits>['patch']
  userModified: boolean
  gitDiff?: ToolUseDiff
}

export async function validateFileEdits(
  request: FileEditsRequest,
  toolUseContext: ToolUseContext,
): Promise<FileEditsValidationResult> {
  const { file_path, edits } = request
  const fullFilePath = expandPath(file_path)
  if (edits.length === 0) {
    return {
      result: false,
      behavior: 'ask',
      message: 'At least one edit is required.',
      errorCode: 1,
    }
  }

  const appState = toolUseContext.getAppState()
  const denyRule = matchingRuleForInput(
    fullFilePath,
    appState.toolPermissionContext,
    'edit',
    'deny',
  )
  if (denyRule !== null) {
    return {
      result: false,
      behavior: 'ask',
      message: 'File is in a directory that is denied by your permission settings.',
      errorCode: 2,
    }
  }

  if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
    return { result: true, resolvedEdits: edits }
  }

  const fs = getFsImplementation()
  try {
    const fileStat = await fs.stat(fullFilePath)
    if (fileStat.isDirectory()) {
      return {
        result: false,
        behavior: 'ask',
        message: `Cannot edit '${file_path}': the specified path is an existing directory. Use Bash ls to list files in this directory, or specify a filename path to edit a specific file.`,
        errorCode: 10,
      }
    }
    if (fileStat.size > MAX_EDIT_FILE_SIZE) {
      return {
        result: false,
        behavior: 'ask',
        message: `File is too large to edit (${formatFileSize(fileStat.size)}). Maximum editable file size is ${formatFileSize(MAX_EDIT_FILE_SIZE)}.`,
        errorCode: 10,
      }
    }
  } catch (error) {
    if (!isENOENT(error)) throw error
  }

  let fileContent: string | null
  try {
    const snapshot = readFileForEdit(fullFilePath)
    fileContent = snapshot.fileExists ? snapshot.content : null
  } catch (error) {
    if (isENOENT(error)) fileContent = null
    else throw error
  }

  const createsMissingFile =
    fileContent === null && edits.length === 1 && edits[0]?.old_string === ''
  if (fileContent === null && !createsMissingFile) {
    const similarFilename = findSimilarFile(fullFilePath)
    const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
    let message = `File does not exist. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
    if (cwdSuggestion) message += ` Did you mean ${cwdSuggestion}?`
    else if (similarFilename) message += ` Did you mean ${similarFilename}?`
    return { result: false, behavior: 'ask', message, errorCode: 4 }
  }

  const file = fileContent ?? ''
  if (fileContent !== null && edits[0]?.old_string === '' && file.trim() !== '') {
    return {
      result: false,
      behavior: 'ask',
      message: 'Cannot create new file - file already exists.',
      errorCode: 3,
    }
  }
  if (fullFilePath.endsWith('.ipynb')) {
    return {
      result: false,
      behavior: 'ask',
      message: `File is a Jupyter Notebook. Use the ${NOTEBOOK_EDIT_TOOL_NAME} to edit this file.`,
      errorCode: 5,
    }
  }

  if (fileContent !== null) {
    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
    if (readTimestamp) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      if (lastWriteTime > readTimestamp.timestamp) {
        const isFullRead =
          readTimestamp.offset === undefined && readTimestamp.limit === undefined
        if (!(isFullRead && file === readTimestamp.content)) {
          return {
            result: false,
            behavior: 'ask',
            message: 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
            errorCode: 7,
          }
        }
      }
    }
  }

  let resolved: ReturnType<typeof resolveFileEdits>
  try {
    resolved = resolveFileEdits({
      filePath: fullFilePath,
      fileContents: file,
      edits,
    })
  } catch (error) {
    const message = errorMessage(error)
    return {
      result: false,
      behavior: 'ask',
      message,
      errorCode: message.startsWith('Found ') ? 9 : 8,
      meta: { isFilePathAbsolute: String(isAbsolute(file_path)) },
    }
  }

  const secretError = checkTeamMemSecrets(fullFilePath, resolved.updatedFile)
  if (secretError) {
    return {
      result: false,
      behavior: 'ask',
      message: secretError,
      errorCode: 0,
    }
  }
  const settingsError = validateInputForSettingsFileEdit(
    fullFilePath,
    file,
    () => resolved.updatedFile,
  )
  if (settingsError) {
    return { ...settingsError, behavior: 'ask' }
  }

  return { result: true, resolvedEdits: resolved.resolvedEdits }
}

export async function executeFileEdits(
  request: FileEditsRequest,
  context: ToolUseContext,
  parentMessage: AssistantMessage,
): Promise<SharedFileEditOutput> {
  const { file_path, edits } = request
  const {
    readFileState,
    userModified,
    updateFileHistoryState,
    dynamicSkillDirTriggers,
  } = context
  const fs = getFsImplementation()
  const absoluteFilePath = expandPath(file_path)

  const cwd = getCwd()
  if (!isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    const newSkillDirs = await discoverSkillDirsForPaths(
      [absoluteFilePath],
      cwd,
    )
    if (newSkillDirs.length > 0) {
      for (const dir of newSkillDirs) dynamicSkillDirTriggers?.add(dir)
      addSkillDirectories(newSkillDirs).catch(() => {})
    }
    activateConditionalSkillsForPaths([absoluteFilePath], cwd)
  }

  await diagnosticTracker.beforeFileEdited(absoluteFilePath)
  await fs.mkdir(dirname(absoluteFilePath))
  if (fileHistoryEnabled()) {
    await fileHistoryTrackEdit(
      updateFileHistoryState,
      absoluteFilePath,
      parentMessage.uuid,
    )
  }

  const {
    content: originalFileContents,
    fileExists,
    encoding,
    lineEndings,
  } = readFileForEdit(absoluteFilePath)

  if (fileExists) {
    const lastWriteTime = getFileModificationTime(absoluteFilePath)
    const lastRead = readFileState.get(absoluteFilePath)
    if (!lastRead || lastWriteTime > lastRead.timestamp) {
      const isFullRead =
        lastRead &&
        lastRead.offset === undefined &&
        lastRead.limit === undefined
      const contentUnchanged =
        isFullRead && originalFileContents === lastRead.content
      if (!contentUnchanged) throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
    }
  }

  const { resolvedEdits, patch, updatedFile } = resolveFileEdits({
    filePath: absoluteFilePath,
    fileContents: originalFileContents,
    edits,
  })

  writeTextContent(absoluteFilePath, updatedFile, encoding, lineEndings)

  const lspManager = getLspServerManager()
  if (lspManager) {
    clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
    lspManager.changeFile(absoluteFilePath, updatedFile).catch((err: Error) => {
      logForDebugging(
        `LSP: Failed to notify server of file change for ${absoluteFilePath}: ${err.message}`,
      )
      logError(err)
    })
    lspManager.saveFile(absoluteFilePath).catch((err: Error) => {
      logForDebugging(
        `LSP: Failed to notify server of file save for ${absoluteFilePath}: ${err.message}`,
      )
      logError(err)
    })
  }

  notifyVscodeFileUpdated(
    absoluteFilePath,
    originalFileContents,
    updatedFile,
  )
  readFileState.set(absoluteFilePath, {
    content: updatedFile,
    timestamp: getFileModificationTime(absoluteFilePath),
    offset: undefined,
    limit: undefined,
  })

  if (absoluteFilePath.endsWith(`${sep}CLAUDE.md`)) {
    logEvent('tengu_write_claudemd', {})
  }
  countLinesChanged(patch)
  logFileOperation({
    operation: 'edit',
    tool: 'FileEditTool',
    filePath: absoluteFilePath,
  })
  for (const edit of resolvedEdits) {
    logEvent('tengu_edit_string_lengths', {
      oldStringBytes: Buffer.byteLength(edit.old_string, 'utf8'),
      newStringBytes: Buffer.byteLength(edit.new_string, 'utf8'),
      replaceAll: edit.replace_all,
    })
  }

  let gitDiff: ToolUseDiff | undefined
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_lantern', false)
  ) {
    const startTime = Date.now()
    const diff = await fetchSingleFileGitDiff(absoluteFilePath)
    if (diff) gitDiff = diff
    logEvent('tengu_tool_use_diff_computed', {
      isEditTool: true,
      durationMs: Date.now() - startTime,
      hasDiff: !!diff,
    })
  }

  return {
    filePath: file_path,
    edits: resolvedEdits,
    originalFile: originalFileContents,
    structuredPatch: patch,
    userModified: userModified ?? false,
    ...(gitDiff && { gitDiff }),
  }
}

function readFileForEdit(absoluteFilePath: string): {
  content: string
  fileExists: boolean
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  try {
    const meta = readFileSyncWithMetadata(absoluteFilePath)
    return {
      content: meta.content,
      fileExists: true,
      encoding: meta.encoding,
      lineEndings: meta.lineEndings,
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined
    if (code === 'ENOENT') {
      return {
        content: '',
        fileExists: false,
        encoding: 'utf8',
        lineEndings: 'LF',
      }
    }
    throw error
  }
}
