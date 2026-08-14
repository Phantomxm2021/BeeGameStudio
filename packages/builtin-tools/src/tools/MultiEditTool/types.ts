import { z } from 'zod/v4'
import { lazySchema } from 'src/utils/lazySchema.js'
import { semanticBoolean } from 'src/utils/semanticBoolean.js'
import {
  gitDiffSchema,
  hunkSchema,
} from '../FileEditTool/types.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to modify'),
    edits: z
      .array(
        z.strictObject({
          old_string: z.string().describe('The exact text to replace'),
          new_string: z
            .string()
            .describe('The text to replace it with'),
          replace_all: semanticBoolean(
            z.boolean().default(false).optional(),
          ).describe('Replace every occurrence of old_string'),
        }),
      )
      .min(1)
      .describe('Ordered exact replacements for the same file'),
  }),
)

export type MultiEditInput = z.output<ReturnType<typeof inputSchema>>

export const outputSchema = lazySchema(() =>
  z.object({
    filePath: z.string(),
    edits: z.array(
      z.object({
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean(),
      }),
    ),
    originalFile: z.string(),
    structuredPatch: z.array(hunkSchema()),
    userModified: z.boolean(),
    gitDiff: gitDiffSchema().optional(),
  }),
)

export type MultiEditOutput = z.infer<ReturnType<typeof outputSchema>>
