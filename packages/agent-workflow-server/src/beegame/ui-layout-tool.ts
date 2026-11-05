import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
import { realpathSync } from 'node:fs'
import { designReadSchema, implementationReadSchema, bindingsReadSchema,
  readDesignHandoff, readImplementationTask, checkResourcesAndBindings } from './workflow-read-tools'

/** Bound by the host at startup. The model selects presentation, never check scope. */
export function createUiLayoutServer(workspace: string) {
  const root = realpathSync(workspace)
  const server = new McpServer({ name: 'bgs-ui-layout', version: '1' })
  const readTool = (name: string, description: string, schema: z.ZodObject,
    read: (input: unknown) => unknown | Promise<unknown>) => server.registerTool(name, {
    description, inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async input => {
    try {
      const result = await read(schema.parse(input))
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        isError: !!result && typeof result === 'object' && 'valid' in result && result.valid === false }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: name + ' failed: ' + (error instanceof Error ? error.message : String(error)) }] }
    }
  })
  readTool('ReadDesignHandoff', 'Read saved design inputs without finalizing or locking. {} returns a compact availability entry for docs/GDD.md. {read:[{document:"GDD.md"}]} lists that document’s chapter headings. {read:[{document:"GDD.md",sections:["Exact heading"]}]} returns that heading and its descendant sections with source locations; the document title reads the full file. Missing chapters remain explicit. Structure is not design approval.',
    designReadSchema, input => readDesignHandoff(root, input))
  readTool('ReadImplementationTask', 'Read optional implementation task pointers in docs/GDD.md: {} lists available IDs, dependencies, issues and GDD section navigation; {id:"exact-task-id"} returns task prose plus referenced GDD requirement/acceptance text, merging repeated sections. No new plan, completion inference, baseline lock or implementation permission. Missing sources remain explicit.',
    implementationReadSchema, input => readImplementationTask(root, input))
  readTool('CheckResourcesAndBindings', 'Check Manifest requirements and actual registered resource files, hashes, members and supported structure with {}. Returns registered-file facts, missing structural evidence and actual contract issues. Read-only; no production, registration or edits.',
    bindingsReadSchema, input => checkResourcesAndBindings(root, input))
  return server
}

if (import.meta.main) {
  // These arguments come from the host-private MCP configuration, not tool input.
  const [workspace] = process.argv.slice(2)
  if (!workspace) throw Error('Missing host project read binding')
  await createUiLayoutServer(workspace).connect(new StdioServerTransport())
}
