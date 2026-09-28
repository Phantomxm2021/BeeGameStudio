import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  nativeFileAgentEnvironment,
  runNativeFileAgent,
} from '../native-file-agent'

const cli = join(import.meta.dir, '../../../../dist/cli-bun.js')
const repoRoot = join(import.meta.dir, '../../../..')
const builtins = join(
  import.meta.dir,
  '../../../../.beegame/skills/builtinskills',
)
const frame = (value: unknown) =>
  `event: ${(value as { type: string }).type}\ndata: ${JSON.stringify(value)}\n\n`

for (const searchEnabled of ['0', '1']) {
  test(`native model request includes BGS Skills with Skill Search ${searchEnabled === '1' ? 'on' : 'off'}`, async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'bgs-skill-request-')),
    )
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const requests: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/count_tokens'))
          return Response.json({ input_tokens: 10 })
        if (!new URL(request.url).pathname.endsWith('/messages'))
          return new Response('', { status: 404 })
        const body = (await request.json()) as Record<string, unknown>
        requests.push(body)
        return new Response(
          frame({
            type: 'message_start',
            message: {
              id: 'skill-listing-fixture',
              type: 'message',
              role: 'assistant',
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          }) +
            frame({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            }) +
            frame({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Done.' },
            }) +
            frame({ type: 'content_block_stop', index: 0 }) +
            frame({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 5 },
            }) +
            frame({ type: 'message_stop' }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    try {
      await runNativeFileAgent({
        command: [process.execPath, cli],
        env: nativeFileAgentEnvironment({
          BEEGAME_CONFIG_DIR: join(root, 'config'),
          BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: builtins,
          SKILL_SEARCH_ENABLED: searchEnabled,
          BEEGAME_MODEL_TYPE: 'anthropic',
          ANTHROPIC_API_KEY: 'offline',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_TELEMETRY: '1',
          DISABLE_ERROR_REPORTING: '1',
        }),
        workspacePath: workspace,
        writablePaths: [],
        prompt: '我想做一个贪吃蛇游戏',
        logPath: join(root, 'events.jsonl'),
      })
      expect(requests).toHaveLength(1)
      const body = requests[0]!
      expect(
        (body.tools as Array<{ name: string }>).some(
          tool => tool.name === 'Skill',
        ),
      ).toBe(true)
      const sent = JSON.stringify(body.messages)
      expect(sent).toContain(
        'The following skills are available for use with the Skill tool:',
      )
      expect(sent).toContain('game-creative-director-expert')
      expect(sent).toContain('game-ui-ux-designer')
    } finally {
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}

for (const entrypoint of ['built', 'dev'] as const) {
  test(`${entrypoint} CLI lists BGS Skills without a host-injected directory`, async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'bgs-standalone-skills-')),
    )
    const requests: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/count_tokens'))
          return Response.json({ input_tokens: 10 })
        if (!new URL(request.url).pathname.endsWith('/messages'))
          return new Response('', { status: 404 })
        const body = (await request.json()) as Record<string, unknown>
        requests.push(body)
        return new Response(
          frame({
            type: 'message_start',
            message: {
              id: 'standalone-skill-fixture',
              type: 'message',
              role: 'assistant',
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          }) +
            frame({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            }) +
            frame({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Done.' },
            }) +
            frame({ type: 'content_block_stop', index: 0 }) +
            frame({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 5 },
            }) +
            frame({ type: 'message_stop' }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    try {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            key !== 'BEEGAME_NATIVE_BUILTIN_SKILLS_DIR' &&
            typeof value === 'string',
        ),
      ) as Record<string, string>
      const args = [
        '--print',
        '--verbose',
        '--output-format=stream-json',
        '--no-session-persistence',
        '我想做一个贪吃蛇游戏',
      ]
      const child = Bun.spawn(
        entrypoint === 'built'
          ? [process.execPath, cli, ...args]
          : [
              process.execPath,
              'run',
              join(repoRoot, 'scripts/dev.ts'),
              ...args,
            ],
        {
          cwd: entrypoint === 'built' ? root : repoRoot,
          env: {
            ...inherited,
            BEEGAME_CONFIG_DIR: join(root, 'config'),
            SKILL_SEARCH_ENABLED: '0',
            BEEGAME_MODEL_TYPE: 'anthropic',
            ANTHROPIC_API_KEY: 'offline',
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            DISABLE_TELEMETRY: '1',
            DISABLE_ERROR_REPORTING: '1',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exitCode, stderr).toBe(0)
      const events = stdout
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, any>)
      const init = events.find(
        event => event.type === 'system' && event.subtype === 'init',
      )
      expect(init?.skills).toContain('game-creative-director-expert')
      expect(init?.skills).toContain('game-ui-ux-designer')
      expect(init?.slash_commands).toContain('game-creative-director-expert')
      expect(JSON.stringify(requests[0]?.messages)).toContain(
        'game-creative-director-expert',
      )
    } finally {
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
}
