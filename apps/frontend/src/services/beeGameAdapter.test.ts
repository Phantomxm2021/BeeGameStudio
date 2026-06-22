import { beforeEach, describe, expect, it, vi } from 'vitest';

import { beeGameAdapter } from './beeGameAdapter';

describe('beeGameAdapter prompt rules', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('falls back to path-safe intake options before creating a BeeGame session', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'intake unavailable' }, 500));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    const options = await beeGameAdapter.generateIntakeOptions({ idea: '贪吃蛇' });

    expect(options).toHaveLength(3);
    expect(options[0]).toEqual(expect.objectContaining({
      id: 'classic_web',
      recommendedPlatform: 'Web',
      recommendedDimension: '2D',
    }));
    expect(JSON.stringify(options)).not.toContain('apps/frontend');
    expect(JSON.stringify(options)).not.toContain('apps/dashboard');
    expect(JSON.stringify(options)).not.toContain('packages/');
    expect(fetchMock).toHaveBeenCalledWith('/api/beegame-intake/options?ownerId=dashboard-local', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('starts a BeeGame session from a confirmed brief and rejects host source paths in the prompt', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_brief',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_brief/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_brief',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [option] = await beeGameAdapter.generateIntakeOptions({ idea: '贪吃蛇' });
    await beeGameAdapter.bootstrapProjectFromBrief({
      idea: '贪吃蛇',
      option,
      settings: {
        platform: 'Web',
        visualStyle: 'Pixel',
        dimension: '2D',
        genre: 'Arcade',
        inputs: ['Keyboard/mouse', 'Touch'],
        scope: 'Playable demo',
        notes: '节奏快一点',
      },
      root_path: '/tmp/beegame-projects',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_brief/input' &&
      init?.method === 'POST'
    ));
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as { text?: string };

    expect(body.text).toContain('Confirmed BeeGame build brief');
    expect(body.text).toContain('Platform: Web');
    expect(body.text).toContain('Inputs: Keyboard/mouse, Touch');
    expect(body.text).toContain('First produce a Playable Spec, not a generic GDD.');
    expect(body.text).toContain('Core Loop');
    expect(body.text).toContain('Fun Hook');
    expect(body.text).toContain('Risk/Reward');
    expect(body.text).toContain('First 3 Minutes');
    expect(body.text).toContain('Playability Acceptance Checklist');
    expect(body.text).toContain('Do not start implementation until the Playable Spec is internally checked against the checklist.');
    expect(body.text).toContain('Do not create, edit, or suggest using BeeGame dashboard or host application source paths.');
    expect(body.text).not.toContain('apps/frontend');
    expect(body.text).not.toContain('apps/dashboard');
    expect(body.text).not.toContain('packages');
    expect(body.text).toContain('./snake-game');
  });

  it('keeps BeeGame branding out of package names and code identifiers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_test',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_test/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_test',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_test/input' &&
      init?.method === 'POST'
    ));
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as { text?: string };

    expect(body.text).toContain('Do not apply BeeGame branding to code identifiers');
    expect(body.text).toContain('package names');
    expect(body.text).toContain('Never invent or rewrite package scopes such as @beegame/*');
    expect(body.text).toContain('use the real package name @ant/ink');
  });

  it('keeps repeated tool calls as distinct chat messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_tools',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_tools/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_tools',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_tools') {
        return jsonResponse({
          id: 'beegame_tools',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_tools/events?after=0') {
        return jsonResponse([
          {
            id: 10,
            sessionId: 'beegame_tools',
            turnId: 'turn-1',
            type: 'tool.started',
            text: 'Bash',
            payload: { type: 'tool.started', toolUseID: 'tool_a', toolName: 'Bash', input: { command: 'pwd' } },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
          {
            id: 11,
            sessionId: 'beegame_tools',
            turnId: 'turn-1',
            type: 'tool.started',
            text: 'Bash',
            payload: { type: 'tool.started', toolUseID: 'tool_b', toolName: 'Bash', input: { command: 'ls' } },
            createdAt: '2026-06-21T00:00:03.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toHaveLength(2);
    expect(polled.messages.map(message => message.message_id)).toEqual([
      'beegame-tool-beegame_tools-tool_a',
      'beegame-tool-beegame_tools-tool_b',
    ]);
    expect(polled.messages.map(message => message.tool_use_id)).toEqual([
      'tool_a',
      'tool_b',
    ]);
  });

  it('treats AskUserQuestion as a clarification message instead of an approval gate', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_question',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_question/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_question',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_question') {
        return jsonResponse({
          id: 'beegame_question',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_question/events?after=0') {
        return jsonResponse([askUserQuestionEvent()]);
      }
      if (path === '/api/beegame-sessions/beegame_question/events?after=12') {
        return jsonResponse([]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);
    const reviews = await beeGameAdapter.getPendingUserReviews(result.project.id);
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(polled.messages).toEqual([
      expect.objectContaining({
        type: 'agent_message',
        sender: 'beegame',
        content: expect.stringContaining('你想做单人模式还是双人模式？'),
        task_kind: 'clarification_question',
        requires_user_action: true,
      }),
    ]);
    expect(polled.messages[0].content).toContain('单人模式');
    expect(polled.messages[0].content).toContain('双人模式');
    expect(polled.messages.some(message => message.type === 'human_gate')).toBe(false);
    expect(reviews.items).toEqual([]);
    expect(status.approval_required).toBe(false);
    expect(status.phase).toBe('idle');
  });

  it('keeps multiple final assistant messages in the same turn instead of overwriting them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_multi',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_multi/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_multi',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_multi') {
        return jsonResponse({
          id: 'beegame_multi',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_multi/events?after=0') {
        return jsonResponse([
          assistantMessageEvent(20, 'beegame_multi', 'turn-1', '先创建项目结构。'),
          assistantMessageEvent(21, 'beegame_multi', 'turn-1', '然后修复类型错误。'),
          assistantMessageEvent(22, 'beegame_multi', 'turn-1', '最后启动预览服务器。'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages.map(message => message.content)).toEqual([
      '先创建项目结构。',
      '然后修复类型错误。',
      '最后启动预览服务器。',
    ]);
    expect(polled.messages.map(message => message.message_id)).toEqual([
      'beegame-event-20',
      'beegame-event-21',
      'beegame-event-22',
    ]);
  });

  it('hides streaming partials and shows only the final assistant message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_stream',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_stream/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_stream',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_stream') {
        return jsonResponse({
          id: 'beegame_stream',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_stream/events?after=0') {
        return jsonResponse([
          assistantPartialEvent(30, 'beegame_stream', 'turn-1', '先创建'),
          assistantPartialEvent(31, 'beegame_stream', 'turn-1', '项目。'),
          assistantMessageEvent(32, 'beegame_stream', 'turn-1', '先创建项目。'),
        ]);
      }
      if (path === '/api/beegame-sessions/beegame_stream/events?after=32') {
        return jsonResponse([]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const firstPoll = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(firstPoll.messages).toEqual([
      expect.objectContaining({
        type: 'agent_message',
        content: '先创建项目。',
        message_id: 'beegame-event-32',
      }),
    ]);
    expect(firstPoll.messages.some(message => message.type === 'token')).toBe(false);
  });

  it('keeps assistant and tool messages in BeeGame event order', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_order',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_order/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_order',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_order') {
        return jsonResponse({
          id: 'beegame_order',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_order/events?after=0') {
        return jsonResponse([
          assistantPartialEvent(40, 'beegame_order', 'turn-1', '我要读取'),
          toolStartedEvent(41, 'beegame_order', 'tool_read', 'Read', '读取文件'),
          toolCompletedEvent(42, 'beegame_order', 'tool_read', 'Read', '读取完成'),
          assistantMessageEvent(43, 'beegame_order', 'turn-1', '读取完成，接下来写文件。'),
          toolStartedEvent(44, 'beegame_order', 'tool_write', 'Write', '写入文件'),
          assistantMessageEvent(45, 'beegame_order', 'turn-1', '文件已写好。'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages.map(message => message.message_id)).toEqual([
      'beegame-tool-beegame_order-tool_read',
      'beegame-tool-beegame_order-tool_read',
      'beegame-event-43',
      'beegame-tool-beegame_order-tool_write',
      'beegame-event-45',
    ]);
    expect(polled.messages.map(message => message.type)).toEqual([
      'tool_start',
      'tool_end',
      'agent_message',
      'tool_start',
      'agent_message',
    ]);
    expect(polled.messages[0].content).toContain('Tool: Read');
    expect(polled.messages[0].content).toContain('Status: running');
    expect(polled.messages[0].content).toContain('Target: snake-game/src/main.ts');
    expect(polled.messages[1].content).toContain('Status: completed');
    expect(polled.messages[1].content).toContain('Target: snake-game/src/main.ts');
    expect(polled.messages[3].content).toContain('Target: snake-game/src/main.ts');
  });

  it('maps BeeGame result usage into token usage messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_usage/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_usage') {
        return jsonResponse({
          id: 'beegame_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_usage/events?after=0') {
        return jsonResponse([
          resultEvent(60, 'beegame_usage', 'turn-1', 100, 25),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toEqual([
      expect.objectContaining({
        type: 'usage',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
        },
      }),
    ]);
  });

  it('shows workflow blocks separately from real permission requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_gate',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_gate/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_gate',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_gate') {
        return jsonResponse({
          id: 'beegame_gate',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_gate/events?after=0') {
        return jsonResponse([
          turnStartedEvent(49, 'beegame_gate', 'turn-1'),
          workflowPhaseEvent(50, 'beegame_gate', 'turn-1', 'planning'),
          workflowBlockedEvent(
            51,
            'beegame_gate',
            'turn-1',
            'Bash',
            'Playable Spec is not ready.',
          ),
          workflowPhaseEvent(52, 'beegame_gate', 'turn-1', 'building'),
          permissionRequestedEvent(53, 'beegame_gate', 'turn-1', 'Write'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'system',
        content: 'BeeGame paused build before Bash: Playable Spec is not ready.',
      }),
      expect.objectContaining({
        type: 'human_gate',
        content: 'Write game files?',
      }),
    ]));
    expect(polled.messages.some(message => message.content === 'Designing Playable Spec')).toBe(false);
    expect(polled.messages.some(message => message.content === 'Building the game')).toBe(false);
    expect(status.phase).toBe('waiting_approval');
    expect(status.next_action).toBe('Review BeeGame permission request');
    expect(status.approval_required).toBe(true);
  });

  it('deletes the backing BeeGame session artifacts when deleting a project', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_delete/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_delete?deleteArtifacts=1' && init?.method === 'DELETE') {
        return jsonResponse({ deleted: true, deletedArtifactPaths: ['/tmp/beegame-projects/snake-game'] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: '贪吃蛇',
      root_path: '/tmp/beegame-projects',
    });

    await beeGameAdapter.deleteProject(result.project.id);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/beegame-sessions/beegame_delete?deleteArtifacts=1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function askUserQuestionEvent() {
  return {
    id: 12,
    sessionId: 'beegame_question',
    turnId: 'turn-1',
    type: 'permission.requested',
    text: 'Ask the user which game mode to build.',
    payload: {
      type: 'permission.requested',
      toolUseID: 'tool_question',
      toolName: 'AskUserQuestion',
      message: 'Ask the user which game mode to build.',
      input: {
        questions: [
          {
            header: '游戏模式',
            question: '你想做单人模式还是双人模式？',
            options: [
              { label: '单人模式', description: '更快开始，适合第一版。' },
              { label: '双人模式', description: '需要更多联网或本地对战逻辑。' },
            ],
          },
        ],
      },
    },
    createdAt: '2026-06-21T00:00:02.000Z',
  };
}

function assistantMessageEvent(id: number, sessionId: string, turnId: string, text: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'assistant.message',
    text,
    payload: { type: 'assistant.message' },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function assistantPartialEvent(id: number, sessionId: string, turnId: string, text: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'assistant.partial',
    text,
    payload: { type: 'assistant.partial' },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function turnStartedEvent(id: number, sessionId: string, turnId: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'turn.started',
    text: 'Turn started',
    payload: { type: 'turn.started' },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function toolStartedEvent(id: number, sessionId: string, toolUseID: string, toolName: string, text: string) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'tool.started',
    text,
    payload: {
      type: 'tool.started',
      toolUseID,
      toolName,
      input: toolName === 'Bash'
        ? { command: 'bun run build' }
        : { file_path: '/tmp/beegame-projects/snake-game/src/main.ts' },
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function resultEvent(id: number, sessionId: string, turnId: string, inputTokens: number, outputTokens: number) {
  return {
    id,
    sessionId,
    turnId,
    type: 'result',
    text: 'Done',
    payload: {
      type: 'result',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function permissionResolvedEvent(
  id: number,
  sessionId: string,
  turnId: string,
  toolName: string,
  decision: 'allow' | 'deny',
  autoDenied: boolean,
  reason: string,
) {
  return {
    id,
    sessionId,
    turnId,
    type: 'permission.resolved',
    text: `${toolName}: ${decision}`,
    payload: {
      type: 'permission.resolved',
      toolUseID: `tool_${id}`,
      toolName,
      decision,
      ...(autoDenied ? { autoDenied: true } : {}),
      ...(reason ? { reason } : {}),
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function workflowPhaseEvent(id: number, sessionId: string, turnId: string, phase: 'planning' | 'building' | 'completed') {
  return {
    id,
    sessionId,
    turnId,
    type: 'workflow.phase',
    text: phase,
    payload: {
      type: 'workflow.phase',
      phase,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function workflowBlockedEvent(id: number, sessionId: string, turnId: string, toolName: string, reason: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'workflow.blocked',
    text: reason,
    payload: {
      type: 'workflow.blocked',
      phase: 'planning',
      blockedToolName: toolName,
      toolUseID: `tool_${id}`,
      reason,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function permissionRequestedEvent(id: number, sessionId: string, turnId: string, toolName: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'permission.requested',
    text: `${toolName} game files?`,
    payload: {
      type: 'permission.requested',
      toolUseID: `tool_${id}`,
      toolName,
      message: `${toolName} game files?`,
      input: { file_path: 'snake-game/src/main.ts' },
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function toolCompletedEvent(id: number, sessionId: string, toolUseID: string, toolName: string, text: string) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'tool.completed',
    text,
    payload: {
      type: 'tool.completed',
      toolUseID,
      toolName,
      input: toolName === 'Bash'
        ? { command: 'bun run build' }
        : { file_path: '/tmp/beegame-projects/snake-game/src/main.ts' },
      output: text,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}
