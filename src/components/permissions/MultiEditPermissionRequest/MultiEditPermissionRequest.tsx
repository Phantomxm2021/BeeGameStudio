import { basename, relative } from 'path'
import React from 'react'
import { MultiEditTool } from '@bee-game-studio/builtin-tools/tools/MultiEditTool/MultiEditTool.js'
import { Text } from '@anthropic/ink'
import { FileEditToolDiff } from 'src/components/FileEditToolDiff.js'
import { getCwd } from 'src/utils/cwd.js'
import type { z } from 'zod/v4'
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js'
import type {
  FileEdit,
  IDEDiffSupport,
} from '../FilePermissionDialog/ideDiffConfig.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'

type MultiEditInput = z.infer<typeof MultiEditTool.inputSchema>

export function multiEditDiffConfigForInput(input: MultiEditInput) {
  return {
    filePath: input.file_path,
    edits: input.edits,
    editMode: 'multiple' as const,
  }
}

const ideDiffSupport: IDEDiffSupport<MultiEditInput> = {
  getConfig: multiEditDiffConfigForInput,
  applyChanges: (input, modifiedEdits: FileEdit[]) => ({
    ...input,
    edits: modifiedEdits.map(edit => ({
      ...edit,
      replace_all: edit.replace_all ?? false,
    })),
  }),
}

export function MultiEditPermissionRequest(
  props: PermissionRequestProps,
): React.ReactNode {
  const parseInput = (input: unknown): MultiEditInput =>
    MultiEditTool.inputSchema.parse(input)
  const parsed = parseInput(props.toolUseConfirm.input)
  const edits = parsed.edits.map(edit => ({
    ...edit,
    replace_all: edit.replace_all ?? false,
  }))

  return (
    <FilePermissionDialog
      toolUseConfirm={props.toolUseConfirm}
      toolUseContext={props.toolUseContext}
      onDone={props.onDone}
      onReject={props.onReject}
      workerBadge={props.workerBadge}
      title="Edit file"
      subtitle={relative(getCwd(), parsed.file_path)}
      question={
        <Text>
          Do you want to make these edits to{' '}
          <Text bold>{basename(parsed.file_path)}</Text>?
        </Text>
      }
      content={<FileEditToolDiff file_path={parsed.file_path} edits={edits} />}
      path={parsed.file_path}
      completionType="str_replace_multi"
      parseInput={parseInput}
      ideDiffSupport={ideDiffSupport}
    />
  )
}
