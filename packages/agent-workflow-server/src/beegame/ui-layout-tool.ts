import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
import { realpathSync } from 'node:fs'
import type { LayoutConstraints } from './ui-layout-audit'
import type * as Checker from './game-content-validation-cli'
import { designReadSchema, implementationReadSchema, bindingsReadSchema, verificationReadSchema,
  readDesignHandoff, readImplementationTask, checkResourcesAndBindings, readVerificationResults,
  type VerificationReadBinding } from './workflow-read-tools'

type LayoutChecker = Pick<typeof Checker, 'runGameContentCommand' | 'formatLayoutReport' | 'formatUiLayoutMeasurement' | 'formatSceneLayoutInspection' | 'inspectContentDraft'>
const inputSchema = z.strictObject({ detailsFor: z.string().optional() })
const uiInputSchema = z.strictObject({ detailsFor: z.union([z.string(), z.array(z.string()).min(1)]).optional() })

/** Bound by the host at startup. The model selects presentation, never check scope. */
export function createUiLayoutServer(workspace: string, constraints: LayoutConstraints, checker: LayoutChecker, verification?: VerificationReadBinding) {
  const root = realpathSync(workspace)
  const server = new McpServer({ name: 'bgs-ui-layout', version: '1' })
  const readTool = (name: string, description: string, schema: z.ZodObject,
    read: (input: unknown) => unknown | Promise<unknown>) => server.registerTool(name, {
    description, inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { 'anthropic/alwaysLoad': true },
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
  readTool('ReadDesignHandoff', 'Read saved design inputs without finalizing or locking. {} returns a compact availability list for all eight documents. {read:[{document:"GDD.md"}]} lists that document’s headings. {read:[{document:"GDD.md",sections:["Exact heading"]}]} returns only selected original prose and locations; independently readable sources remain available when others are missing. Structure is not design approval.',
    designReadSchema, input => readDesignHandoff(root, input))
  readTool('ReadImplementationTask', 'Read existing TECHNICAL_DESIGN tasks: {} lists IDs, dependencies and issues; {id:"exact-task-id"} returns task prose plus referenced owner requirement/acceptance text, merging repeated sections. No new plan, completion inference, baseline lock or implementation permission. Missing sources remain explicit.',
    implementationReadSchema, input => readImplementationTask(root, input))
  readTool('CheckResourcesAndBindings', 'Check actual registered resources and all saved UI/Scene resource references, files, members and atlas frames. {} returns concise results; {detailsFor:"content/ui/hud.json"} expands exact node/component bindings without narrowing checks. Action/state wiring and visual quality require runtime evidence. Read-only; no production, registration or edits.',
    bindingsReadSchema, input => checkResourcesAndBindings(root, input))
  readTool('ReadVerificationResults', 'Read retained verification without running it. {} returns current-turn file changes and newest host measurement including failed/unfinished results and freshness; details:true adds global check coverage, acceptance and retained result history. {measurementId:"exact-id"} inspects a record; {previewReceipt:".beegame/tmp/preview-test-.../execution.json"} inspects one existing preview receipt. Uses current bound turn access; never starts tests, builds, browsers, model calls or retries.',
    verificationReadSchema, input => readVerificationResults(root, input, verification))
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
    description: 'Check all saved BGS UI layouts at authored reference/target sizes and host-required sizes, including linked Cameras and underlays. Use {} for effective variants, spatial observations, diagnostics and coverage; detailsFor:"content/ui/hud.json" or an array of source paths expands only selected layouts with effective container/item constraints, position ownership, node coordinates and saved node facts (text, style, actions, bindings and other authored fields, once per source). Global diagnostics and coverage remain complete. Edit source with native Edit, then recheck. Read-only; no Shell, builds, rendering or visual-design approval.',
    inputSchema: uiInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { 'anthropic/alwaysLoad': true },
  }, async input => {
    try {
      const { detailsFor } = uiInputSchema.parse(input)
      const selected = new Set(detailsFor === undefined ? [] : typeof detailsFor === 'string' ? [detailsFor] : detailsFor)
      if ([...selected].some(path => !path.startsWith('content/ui/') || !path.endsWith('.json') ||
          path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')))
        throw Error('detailsFor must be an exact content/ui/*.json source path inside this project.')
      const result = checker.runGameContentCommand(root, ['--design-layouts', '--details'], constraints)
      // This fixed library operation returns the existing batch result, not CLI stdout.
      if (!('diagnostics' in result) || !Array.isArray(result.diagnostics) || !('valid' in result) || !('issues' in result))
        throw Error('UI layout checker did not return its batch result.')
      const text = [checker.formatLayoutReport(result as Parameters<LayoutChecker['formatLayoutReport']>[0])]
      const measurements = 'measurements' in result && Array.isArray(result.measurements) ? result.measurements : []
      for (const item of measurements) if (detailsFor === undefined || selected.has(item.source)) text.push(
        '## ' + item.source + ' — ' + item.viewport.join(' × ') + (item.scene ? ' — ' + item.scene : ''),
        checker.formatUiLayoutMeasurement(item, selected.has(item.source)))
      const measured = new Set(measurements.map(item => item.source))
      const missing = [...selected].filter(path => !measured.has(path))
      for (const path of missing)
        text.push('Cannot expand coordinates for ' + JSON.stringify(path) + ': no measured screen/HUD geometry. See input issues and coverage above.')
      if ([...selected].some(path => measured.has(path))) text.push(
        'Authored values, including responsive overrides; effective geometry is reported above. Missing fields are not filled with defaults.')
      for (const path of selected) if (measured.has(path)) text.push(
        '## Saved node facts — ' + path,
        JSON.stringify(checker.inspectContentDraft(root, path, ['--pointer', '/data/nodes'])))
      return { isError: result.valid !== true || missing.length > 0, content: [{ type: 'text' as const, text: text.join('\n\n') }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: 'CheckUiLayouts failed: ' + (error instanceof Error ? error.message : String(error)) }] }
    }
  })
  return server
}

if (import.meta.main) {
  // These arguments come from the host-private MCP configuration, not tool input.
  const [moduleUrl, workspace, constraints, capabilityFile, sessionId] = process.argv.slice(2)
  if (!moduleUrl || !workspace || !constraints) throw Error('Missing host UI layout binding')
  const checker = await import(moduleUrl) as LayoutChecker
  await createUiLayoutServer(workspace, JSON.parse(constraints), checker,
    capabilityFile && sessionId ? { capabilityFile, sessionId } : undefined).connect(new StdioServerTransport())
}
