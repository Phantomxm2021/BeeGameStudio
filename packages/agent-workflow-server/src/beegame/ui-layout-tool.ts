import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
import { realpathSync } from 'node:fs'
import type { LayoutConstraints } from './ui-layout-audit'
import type * as Checker from './game-content-validation-cli'

type LayoutChecker = Pick<typeof Checker, 'runGameContentCommand' | 'formatLayoutReport' | 'formatUiLayoutMeasurement' | 'formatSceneLayoutInspection'>
const inputSchema = z.strictObject({ detailsFor: z.string().optional() })

/** Bound by the host at startup. The model selects presentation, never check scope. */
export function createUiLayoutServer(workspace: string, constraints: LayoutConstraints, checker: LayoutChecker) {
  const root = realpathSync(workspace)
  const server = new McpServer({ name: 'bgs-ui-layout', version: '1' })
  server.registerTool('CheckSceneLayouts', {
    description: 'Check every saved BGS Scene structure and static 2D Camera-reference geometry, using registered TileSet bounds when available. Use {} for Camera/coordinate context, required visibility, observations and coverage; detailsFor:"content/scenes/level.json" adds parent/local/world/projected coordinate tables for that source without narrowing checks. Native Edit changes source transforms, cells or Camera, then recheck. Actual UI game-view framing uses CheckUiLayouts. 3D/XR geometry, collision clearance and traversal remain unverified. Read-only; no Shell, reports, builds or rendering.',
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { 'anthropic/alwaysLoad': true },
  }, async input => {
    try {
      const { detailsFor } = inputSchema.parse(input)
      if (detailsFor !== undefined && (!detailsFor.startsWith('content/scenes/') || !detailsFor.endsWith('.json') ||
          detailsFor.includes('\\') || detailsFor.split('/').some(part => !part || part === '.' || part === '..')))
        throw Error('detailsFor must be an exact content/scenes/*.json source path inside this project.')
      const result = checker.runGameContentCommand(root, ['--scene-layouts', '--details'], constraints)
      if (!('inspections' in result) || !Array.isArray(result.inspections) ||
          !('valid' in result) || typeof result.valid !== 'boolean' || !('issues' in result) || !Array.isArray(result.issues))
        throw Error('Scene layout checker did not return its batch result.')
      const text = [checker.formatLayoutReport({ valid: result.valid, issues: result.issues, diagnostics: [],
        coverage: 'coverage' in result ? result.coverage : undefined,
        inputLocation: 'inputLocation' in result ? result.inputLocation : undefined }),
        'Camera reference viewports only, not the UI game-view. Use CheckUiLayouts for linked UI allocation. Optional offscreen objects are not failures; missing geometry and 3D/XR spatial checks remain unverified. Edit source with native Edit, then recheck.']
      for (const item of result.inspections) text.push(
        '## ' + item.source + ' — ' + item.viewport.width + ' × ' + item.viewport.height,
        checker.formatSceneLayoutInspection(item as Parameters<LayoutChecker['formatSceneLayoutInspection']>[0], item.source === detailsFor))
      if (detailsFor && !result.inspections.some(item => item.source === detailsFor)) {
        text.push('Cannot expand coordinates for ' + JSON.stringify(detailsFor) + ': no measured static 2D geometry. See input issues and unverified coverage above.')
        return { isError: true, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
      }
      return { isError: result.valid !== true, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: 'CheckSceneLayouts failed: ' + (error instanceof Error ? error.message : String(error)) }] }
    }
  })
  server.registerTool('CheckUiLayouts', {
    description: 'Check all saved BGS UI layouts at authored reference/target sizes and host-required sizes, including linked Cameras and underlays. Use {} for effective variants, spatial observations, diagnostics and coverage; detailsFor:"content/ui/hud.json" also returns effective container/item constraints, position ownership and node coordinates. Edit constraints with native Edit, then recheck. Read-only; no Shell, builds, rendering or visual-design approval.',
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { 'anthropic/alwaysLoad': true },
  }, async input => {
    try {
      const { detailsFor } = inputSchema.parse(input)
      if (detailsFor !== undefined && (!detailsFor.startsWith('content/ui/') || !detailsFor.endsWith('.json') ||
          detailsFor.includes('\\') || detailsFor.split('/').some(part => !part || part === '.' || part === '..')))
        throw Error('detailsFor must be an exact content/ui/*.json source path inside this project.')
      const result = checker.runGameContentCommand(root, ['--design-layouts', '--details'], constraints)
      // This fixed library operation returns the existing batch result, not CLI stdout.
      if (!('diagnostics' in result) || !Array.isArray(result.diagnostics) || !('valid' in result) || !('issues' in result))
        throw Error('UI layout checker did not return its batch result.')
      const text = [checker.formatLayoutReport(result as Parameters<LayoutChecker['formatLayoutReport']>[0])]
      const measurements = 'measurements' in result && Array.isArray(result.measurements) ? result.measurements : []
      for (const item of measurements) text.push(
        '## ' + item.source + ' — ' + item.viewport.join(' × ') + (item.scene ? ' — ' + item.scene : ''),
        checker.formatUiLayoutMeasurement(item, item.source === detailsFor))
      if (detailsFor && !measurements.some(item => item.source === detailsFor)) {
        text.push('Cannot expand coordinates for ' + JSON.stringify(detailsFor) + ': no measured screen/HUD geometry. See input issues and coverage above.')
        return { isError: true, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
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
