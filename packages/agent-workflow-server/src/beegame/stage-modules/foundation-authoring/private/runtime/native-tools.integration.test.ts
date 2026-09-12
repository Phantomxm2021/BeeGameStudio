import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAuthorRuntime } from './runtime'
import { createAuthorToolWorkspace } from './tool-workspace'
import { createFoundationMarkdownStreamSink } from '../domain/foundation-markdown-stream'
import { canonicalFoundationAuthorityProjectionBytes, foundationProjectionRelativePath, projectFoundationAuthority } from '../domain/foundation-authority-projection'

const cli = process.env.BEEGAME_REVIEW_TEST_CLI ?? join(import.meta.dir, '../../../../../../../../dist/cli-bun.js')
const frame = (value: any) => 'event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n'

test('real Author uses Read, Bash and Write in its copy and publishes only final Markdown', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'author-native-tools-')))
  const project = join(root, 'project')
  await mkdir(join(project, 'docs'), { recursive: true })
  await writeFile(join(project, 'docs/GDD.md'), 'Existing canonical document')
  const workspace = await createAuthorToolWorkspace({ privateRootPath: root, projectPath: project, requirements: 'Make a game.' })
  const markdown = '# Tool-assisted GDD\n\n## Executive Summary\n\nVerified calculation: 5.\n'
  const calls = [
    { name: 'Read', input: { file_path: 'docs/GDD.md' } },
    { name: 'Bash', input: { command: "/usr/bin/awk 'BEGIN {print sqrt(25)}' > calculation.txt" } },
    { name: 'Write', input: { file_path: 'working-notes.md', content: 'Private author notes' } },
  ]
  const requests: any[] = []
  const abort = new AbortController()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as any
    requests.push(body)
    if (requests.length > 8) { abort.abort(); return new Response('', { status: 500 }) }
    const call = calls[requests.length - 1]
    const text = call ? 'I will inspect and verify the source first.' : markdown
    const blocks: any[] = [{ type: 'text', text }, ...(call ? [{ type: 'tool_use', id: 'tool-' + requests.length, ...call }] : [])]
    const events = [frame({ type: 'message_start', message: { id: 'message-' + requests.length, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })]
    blocks.forEach((block, index) => events.push(
      frame({ type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } }),
      frame({ type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }),
      frame({ type: 'content_block_stop', index }),
    ))
    events.push(frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }), frame({ type: 'message_stop' }))
    return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const runtime = createAuthorRuntime({ command: [process.execPath, cli], env: {
    BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'offline',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } })
  const timer = setTimeout(() => abort.abort(), 30000)
  try {
    const sink = await createFoundationMarkdownStreamSink({ workspacePath: project, runId: 'run', dispatchId: 'dispatch', targetPath: 'docs/GDD.md', maxBytes: 100000 })
    const result = await runtime.execute({ runId: 'run', dispatchId: 'dispatch', workspacePath: workspace,
      prompt: 'Author the complete Markdown document.', signal: abort.signal, onMessage: message => sink.observe(message) })
    expect(result.markdown).toBe(markdown)
    expect(result.terminal.kind).toBe('completed')
    expect(requests).toHaveLength(4)
    expect(requests[0].tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['Read', 'Bash', 'Write', 'Agent']))
    expect(await readFile(join(workspace, 'calculation.txt'), 'utf8')).toBe('5\n')
    expect(await readFile(join(workspace, 'working-notes.md'), 'utf8')).toBe('Private author notes')
    expect(await readFile(join(project, 'docs/GDD.md'), 'utf8')).toBe('Existing canonical document')
    await mkdir(join(project, '.beegame/workflow/foundation-authoring/projections'), { recursive: true })
    await writeFile(join(project, foundationProjectionRelativePath('dispatch')), canonicalFoundationAuthorityProjectionBytes(
      projectFoundationAuthority({ targetPath: 'docs/GDD.md', availableUpstreamPaths: [], documents: new Map() })))
    await sink.commit()
    const published = await readFile(join(project, 'docs/GDD.md'), 'utf8')
    expect(published).toContain(markdown)
    expect(published).not.toContain('I will inspect')
    expect(published).not.toContain('Private author notes')
  } finally { clearTimeout(timer); runtime.dispose(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 35000)
