import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
import { realpathSync } from 'node:fs'
import type { LayoutConstraints } from './ui-layout-audit'
import type * as Checker from './game-content-validation-cli'

type LayoutChecker = Pick<typeof Checker, 'runGameContentCommand' | 'formatLayoutReport' | 'formatUiLayoutTable'>
const inputSchema = z.strictObject({ detailsFor: z.string().optional() })

/** Bound by the host at startup. The model selects presentation, never check scope. */
export function createUiLayoutServer(workspace: string, constraints: LayoutConstraints, checker: LayoutChecker) {
  const root = realpathSync(workspace)
  const server = new McpServer({ name: 'bgs-ui-layout', version: '1' })
  server.registerTool('CheckUiLayouts', {
    description: 'Check all saved BGS UI layouts at authored reference/target sizes and host-required sizes, including linked Cameras and underlays. Use {} for diagnostics and coverage; detailsFor:"content/ui/hud.json" also returns that file’s node coordinate tables. Read-only; no Shell, builds, rendering or visual-design approval.',
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { 'anthropic/alwaysLoad': true },
  }, async input => {
    try {
      const { detailsFor } = inputSchema.parse(input)
      if (detailsFor !== undefined && (!detailsFor.startsWith('content/ui/') || !detailsFor.endsWith('.json') ||
          detailsFor.includes('\\') || detailsFor.split('/').some(part => !part || part === '.' || part === '..')))
        throw Error('detailsFor must be an exact content/ui/*.json source path inside this project.')
      const result = checker.runGameContentCommand(root, ['--design-layouts', ...(detailsFor ? ['--details'] : [])], constraints)
      // This fixed library operation returns the existing batch result, not CLI stdout.
      if (!('diagnostics' in result) || !Array.isArray(result.diagnostics) || !('valid' in result) || !('issues' in result))
        throw Error('UI layout checker did not return its batch result.')
      const text = [checker.formatLayoutReport(result as Parameters<LayoutChecker['formatLayoutReport']>[0])]
      if (detailsFor) {
        const measurements = 'measurements' in result && Array.isArray(result.measurements)
          ? result.measurements.filter(item => item.source === detailsFor) : []
        if (!measurements.length) {
          text.push('Cannot expand coordinates for ' + JSON.stringify(detailsFor) + ': no measured screen/HUD geometry. See input issues and coverage above.')
          return { isError: true, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
        }
        for (const item of measurements) text.push(
          '## ' + detailsFor + ' — ' + item.viewport.join(' × ') + (item.scene ? ' — ' + item.scene : ''),
          'Local position/size is parent-local; Host bounds is in host logical pixels.', checker.formatUiLayoutTable(item.nodes))
      }
      return { isError: result.valid !== true, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: 'CheckUiLayouts failed: ' + (error instanceof Error ? error.message : String(error)) }] }
    }
  })
  return server
}

if (import.meta.main) {
  // These arguments come from the host-private MCP configuration, not tool input.
  const [moduleUrl, workspace, constraints] = process.argv.slice(2)
  if (!moduleUrl || !workspace || !constraints) throw Error('Missing host UI layout binding')
  const checker = await import(moduleUrl) as LayoutChecker
  await createUiLayoutServer(workspace, JSON.parse(constraints), checker).connect(new StdioServerTransport())
}
