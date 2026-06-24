import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beeGameAdapter,
  getBeeGameWorkspaceSettings,
  setBeeGameWorkspaceRoot,
} from './beeGameAdapter';

const makeLlmOption = (overrides: Record<string, unknown> = {}) => ({
  id: 'mode_from_llm',
  title: 'Mode From LLM',
  pitch: 'LLM generated pitch.',
  gameplay: 'LLM generated playable rules.',
  coreGameplayHypothesis: 'LLM generated hypothesis.',
  experienceSnapshot: 'LLM generated snapshot.',
  playerFirstMinute: 'LLM generated first minute.',
  whyFitsIdea: 'LLM generated fit.',
  playablePrototype: 'LLM generated first playable.',
  validationTarget: 'LLM generated validation target.',
  coreMechanic: 'LLM generated core mechanic.',
  firstBuild: 'LLM generated first build.',
  validationGoal: 'LLM generated validation goal.',
  risk: 'LLM generated risk.',
  fit: 'LLM generated fit.',
  firstPlayableValidation: 'LLM generated validation.',
  riskComplexity: 'LLM generated complexity.',
  recommendedPlatform: 'Web',
  recommendedDimension: '2D',
  recommendedGenre: 'Action',
  recommendedStyle: 'Minimal',
  recommendedInputs: ['Keyboard/mouse'],
  scope: 'Playable demo',
  ...overrides,
});

describe('beeGameAdapter prompt rules', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('loads projects from the BeeGame metadata API when available', async () => {
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      { id: 'project_local', name: 'Local Only', created_at: 1700000000000 },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/projects') {
        return jsonResponse([
          {
            id: 'project_sqlite',
            name: 'SQLite Project',
            root_path: '/tmp/beegame-projects/sqlite-project',
            created_at: 1710000000000,
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([
      {
        id: 'project_sqlite',
        name: 'SQLite Project',
        root_path: '/tmp/beegame-projects/sqlite-project',
        created_at: 1710000000000,
      },
    ]);
  });

  it('migrates existing local projects into the BeeGame metadata API when the remote list is empty', async () => {
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      {
        id: 'project_local',
        name: 'Local Only',
        root_path: '/tmp/beegame-projects/local-only',
        created_at: 1700000000000,
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/projects' && !init?.method) {
        return jsonResponse([]);
      }
      if (String(input) === '/api/projects' && init?.method === 'POST') {
        return jsonResponse(JSON.parse(String(init.body)));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([
      {
        id: 'project_local',
        name: 'Local Only',
        root_path: '/tmp/beegame-projects/local-only',
        created_at: 1700000000000,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('falls back to local project storage when the BeeGame metadata API is unavailable', async () => {
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      { id: 'project_local', name: 'Local Only', created_at: 1700000000000 },
    ]));
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([
      { id: 'project_local', name: 'Local Only', created_at: 1700000000000 },
    ]);
  });

  it('does not synthesize local game mode options when LLM intake fails', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'intake unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.generateIntakeOptions({ idea: 'idea requiring LLM' }))
      .rejects.toThrow('intake unavailable');
    expect(fetchMock).toHaveBeenCalledWith('/api/beegame-intake/options?ownerId=dashboard-local', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('normalizes BeeGame intake analysis with maturity and LLM-provided option fields', async () => {
    const llmOption = makeLlmOption({
      title: 'LLM Mode',
      coreGameplayHypothesis: 'LLM hypothesis',
      playerFirstMinute: 'LLM first minute',
      whyFitsIdea: 'LLM fit',
      playablePrototype: 'LLM first playable',
      validationTarget: 'LLM validation target',
      fit: 'LLM fit',
      firstPlayableValidation: 'LLM validation',
      riskComplexity: 'LLM complexity',
    });
    const fetchMock = vi.fn(async () => jsonResponse({
      maturity: 'directional',
      needsOptions: true,
      needsClarification: false,
      detectedConstraints: ['LLM constraint'],
      recommendedNextStep: 'choose_direction',
      options: [llmOption],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const intake = await beeGameAdapter.runIdeaIntake({ idea: 'LLM generated idea' });

    expect(intake).toMatchObject({
      maturity: 'directional',
      needsOptions: true,
      needsClarification: false,
      detectedConstraints: ['LLM constraint'],
      recommendedNextStep: 'choose_direction',
    });
    expect(intake.options[0]).toEqual(expect.objectContaining({
      title: 'LLM Mode',
      coreGameplayHypothesis: 'LLM hypothesis',
      playerFirstMinute: 'LLM first minute',
      whyFitsIdea: 'LLM fit',
      playablePrototype: 'LLM first playable',
      validationTarget: 'LLM validation target',
      fit: 'LLM fit',
      firstPlayableValidation: 'LLM validation',
      riskComplexity: 'LLM complexity',
    }));
  });

  it('accepts structured clarification without synthesizing local options', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      maturity: 'vague',
      needsOptions: false,
      needsClarification: true,
      clarification: {
        prompt: 'Which direction should BeeGame use?',
        options: [
          { id: 'direction_a', label: 'Direction A', description: 'Use direction A.' },
          { id: 'direction_b', label: 'Direction B', value: 'Use direction B.' },
        ],
        freeformLabel: 'Add detail',
      },
      clarificationQuestions: [],
      detectedConstraints: [],
      recommendedNextStep: 'clarify',
      options: [],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const intake = await beeGameAdapter.runIdeaIntake({ idea: 'idea requiring clarification' });

    expect(intake).toMatchObject({
      needsClarification: true,
      recommendedNextStep: 'clarify',
      options: [],
      clarification: {
        prompt: 'Which direction should BeeGame use?',
        options: [
          { id: 'direction_a', label: 'Direction A', description: 'Use direction A.' },
          { id: 'direction_b', label: 'Direction B', value: 'Use direction B.' },
        ],
        freeformLabel: 'Add detail',
      },
    });
  });

  it('creates new sessions in a project-specific workspace under the default Projects directory', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { workspacePath?: string };
        return jsonResponse({
          id: 'beegame_scoped',
          cwd: body.workspacePath,
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_scoped/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_scoped',
          cwd: '/tmp/beegame-projects/snake-web',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromBrief({
      idea: 'LLM generated idea',
      title: 'LLM Project',
      option: {
        id: 'snake_web',
        title: 'LLM Project',
        pitch: 'LLM generated pitch.',
        gameplay: '吃食物、增长、避免撞墙。',
        coreGameplayHypothesis: 'LLM generated hypothesis.',
        experienceSnapshot: '你会看到一个网格里的蛇移动、吃食物、变长并撞墙失败。',
        playerFirstMinute: '玩家用方向键移动，吃到食物并理解撞墙失败。',
        whyFitsIdea: 'LLM generated fit.',
        playablePrototype: 'LLM generated first playable.',
        validationTarget: '验证移动和失败条件。',
        coreMechanic: '路线规划和风险控制。',
        firstBuild: 'LLM generated first build.',
        validationGoal: '验证移动和失败条件。',
        risk: '低复杂度。',
        fit: '适合快速验证。',
        firstPlayableValidation: '验证移动和失败条件。',
        riskComplexity: '低复杂度。',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Arcade',
        recommendedStyle: 'Pixel',
        recommendedInputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
      },
      settings: {
        platform: 'Web',
        visualStyle: 'Pixel',
        dimension: '2D',
        genre: 'Arcade',
        inputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
      },
    });

    const startCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ));
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { workspacePath?: string };

    expect(startBody.workspacePath).toBe('/tmp/beegame-projects/llm-project');
    expect(result.project.root_path).toBe('/tmp/beegame-projects/llm-project');
    expect(result.project.name).toBe('LLM Project');
  });

  it('uses the configured workspace root for new projects without replacing it with a project path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { workspacePath?: string };
        return jsonResponse({
          id: 'beegame_custom_root',
          cwd: body.workspacePath,
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_custom_root/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_custom_root',
          cwd: '/tmp/custom-beegame-projects/arena-prototype',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    setBeeGameWorkspaceRoot('/tmp/custom-beegame-projects');

    const result = await beeGameAdapter.bootstrapProjectFromBrief({
      idea: 'arena prototype',
      title: 'Arena Prototype',
      option: makeLlmOption({ title: 'Arena Prototype' }),
      settings: {
        platform: 'Web',
        visualStyle: 'Minimal',
        dimension: '2D',
        genre: 'Action',
        inputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
      },
    });

    const startCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ));
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { workspacePath?: string };
    const settings = await getBeeGameWorkspaceSettings();

    expect(startBody.workspacePath).toBe('/tmp/custom-beegame-projects/arena-prototype');
    expect(result.project.root_path).toBe('/tmp/custom-beegame-projects/arena-prototype');
    expect(settings.workspacePath).toBe('/tmp/custom-beegame-projects');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/filesystem/default-workspace', expect.anything());
  });

  it('keeps the confirmed project title for display and uses the LLM folder name for files', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { workspacePath?: string };
        return jsonResponse({
          id: 'beegame_safe_path',
          cwd: body.workspacePath,
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_safe_path/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_safe_path',
          cwd: '/tmp/beegame-projects/movement-aim-trainer',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromBrief({
      idea: '移动与瞄准训练',
      title: '移动与瞄准训练',
      option: makeLlmOption({ title: '移动与瞄准训练', projectFolderName: 'movement-aim-trainer' }),
      settings: {
        platform: 'Web',
        visualStyle: 'Minimal',
        dimension: '2D',
        genre: 'Action',
        inputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
      },
    });

    const startCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ));
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { workspacePath?: string };
    expect(startBody.workspacePath).toBe('/tmp/beegame-projects/movement-aim-trainer');
    expect(startBody.workspacePath).not.toContain('移动与瞄准训练');
    expect(startBody.workspacePath).not.toContain('beegame-project-');
    expect(result.project.name).toBe('移动与瞄准训练');
  });

  it('migrates legacy projects bound to the Projects root before recreating a missing session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions/beegame_legacy') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { workspacePath?: string };
        return jsonResponse({
          id: 'beegame_migrated',
          cwd: body.workspacePath,
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_migrated/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_migrated',
          cwd: '/tmp/beegame-projects/snake-web',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'LLM Project',
      root_path: '/tmp/beegame-projects',
    });
    const legacyProject = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: legacyProject.id,
      sessionId: 'beegame_legacy',
      workspacePath: '/tmp/beegame-projects',
    }]));

    await beeGameAdapter.sendMessage({
      project_id: legacyProject.id,
      content: '修复蛇会自动增长的问题',
    });

    const startCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ));
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { workspacePath?: string };
    const [updatedProject] = await beeGameAdapter.getProjects();

    expect(startBody.workspacePath).toBe('/tmp/beegame-projects/llm-project');
    expect(updatedProject.root_path).toBe('/tmp/beegame-projects/llm-project');
    expect(updatedProject.name).toBe('llm-project');
  });

  it('loads chat history from a persisted transcript after the backend restarts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsnake-web') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_restart',
            turnId: 'turn-1',
            type: 'user.message',
            text: 'LLM generated user message',
            payload: { type: 'user.message' },
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          {
            id: 2,
            sessionId: 'beegame_restart',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'LLM generated assistant message.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'snake-web',
      root_path: '/tmp/beegame-projects/snake-web',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/snake-web',
    }]));

    const history = await beeGameAdapter.getChatHistory(project.id);

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        content: 'LLM generated user message',
      }),
      expect.objectContaining({
        sender: 'beegame',
        content: 'LLM generated assistant message.',
      }),
    ]));
    expect(fetchMock.mock.calls.some(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ))).toBe(false);
  });

  it('does not replace the persisted binding during read-only status sync after the backend restarts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsnake-web') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_restart',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Recovered design context.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'snake-web',
      root_path: '/tmp/beegame-projects/snake-web',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/snake-web',
    }]));

    await beeGameAdapter.getProjectStatus(project.id);
    const history = await beeGameAdapter.getChatHistory(project.id);

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'beegame',
        content: 'Recovered design context.',
      }),
    ]));
    expect(fetchMock.mock.calls.some(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ))).toBe(false);
  });

  it('does not keep a transcript-only interrupted turn running after the backend restarts', async () => {
    const transcript = [
      turnStartedEvent(1, 'beegame_restart', 'turn-1'),
      assistantMessageEvent(2, 'beegame_restart', 'turn-1', 'Running final build.'),
      bashCompletedEvent(3, 'beegame_restart', 'turn-1', 'bun run build', 'Build completed.'),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsnake-web') {
        return jsonResponse(transcript);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'snake-web',
      root_path: '/tmp/beegame-projects/snake-web',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/snake-web',
    }]));

    const status = await beeGameAdapter.getProjectStatus(project.id);
    const polled = await beeGameAdapter.pollMessages(project.id, 0);

    expect(status.phase).toBe('idle');
    expect(status.active_agents).toEqual([]);
    expect(status.next_action).toContain('Backend restarted');
    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'status',
        status: 'idle',
        content: expect.stringContaining('Backend restarted'),
      }),
    ]));
  });

  it('sends recovered transcript context when a message recreates a missing backend session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/beegame-sessions/beegame_restart') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsnake-web') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_restart',
            turnId: 'turn-1',
            type: 'user.message',
            text: 'Make a tactical puzzle game.',
            payload: { type: 'user.message' },
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          {
            id: 2,
            sessionId: 'beegame_restart',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'The approved plan is documented under docs/GDD.md and docs/TECH_DESIGN.md.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_new',
          cwd: '/tmp/beegame-projects/snake-web',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:03.000Z',
          updatedAt: '2026-06-21T00:00:03.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_new/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_new',
          cwd: '/tmp/beegame-projects/snake-web',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:03.000Z',
          updatedAt: '2026-06-21T00:00:04.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'snake-web',
      root_path: '/tmp/beegame-projects/snake-web',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/snake-web',
    }]));

    await beeGameAdapter.sendMessage({
      project_id: project.id,
      content: '继续任务',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_new/input' && init?.method === 'POST'
    ));
    const startCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ));
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { transcriptSessionId?: string };
    expect(startBody.transcriptSessionId).toBe('beegame_restart');
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string };
    expect(body.text).toContain('This session is being continued from a previous conversation that ran out of context.');
    expect(body.text).toContain('The summary below covers the earlier portion of the conversation.');
    expect(body.text).toContain('If you need specific details from before recovery');
    expect(body.text).toContain('read the project transcript at:');
    expect(body.text).toContain('transcripts/');
    expect(body.text).toContain('Execution snapshot:');
    expect(body.text).toContain('Recent tools:');
    expect(body.text).toContain('Continue the conversation from where it left off');
    expect(body.text).toContain('do not acknowledge the summary');
    expect(body.text).toContain('Do not ask what to do next when the snapshot contains an unfinished tool or failed tool');
    expect(body.text).toContain('Do not pipe validation commands through head, tail, sed, or similar filters');
    expect(body.text).toContain('Completion contract: do not treat an API end_turn, a summary message, or a build/typecheck command alone as project completion.');
    expect(body.text).toContain('choose target-appropriate validation for the selected platform and engine yourself');
    expect(body.text).toContain('Do not force a specific package manager, browser tool, engine, framework, or test runner');
    expect(body.text).toContain('Make a tactical puzzle game.');
    expect(body.text).toContain('docs/GDD.md');
    expect(body.text).toContain('继续任务');
  });

  it('sends continue input for an existing idle session with transcript context', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_paused') {
        return jsonResponse({
          id: 'beegame_paused',
          cwd: '/tmp/beegame-projects/mode-from-llm',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_paused/events?after=0') {
        return jsonResponse([
          turnStartedEvent(1, 'beegame_paused', 'turn-1'),
          assistantMessageEvent(2, 'beegame_paused', 'turn-1', 'Continue from the current project files.'),
          turnCompletedEvent(3, 'beegame_paused', 'turn-1'),
        ]);
      }
      if (path === '/api/beegame-sessions/beegame_paused/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_paused',
          cwd: '/tmp/beegame-projects/mode-from-llm',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:03.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const project = await beeGameAdapter.createProject({
      name: 'Mode From LLM',
      root_path: '/tmp/beegame-projects/mode-from-llm',
    });
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_paused',
      workspacePath: '/tmp/beegame-projects/mode-from-llm',
    }]));

    await beeGameAdapter.continueTask({ project_id: project.id });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_paused/input' && init?.method === 'POST'
    ));
    expect(inputCall).toBeTruthy();
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string };
    expect(body.text).toContain('This session is being continued from a previous conversation that ran out of context.');
    expect(body.text).toContain('Continue the conversation from where it left off');
    expect(body.text).toContain('Continue from the current project files.');
    expect(body.text).toContain('Completion contract: do not treat an API end_turn, a summary message, or a build/typecheck command alone as project completion.');
    expect(body.text).toContain('choose target-appropriate validation for the selected platform and engine yourself');
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

    const option = makeLlmOption();
    await beeGameAdapter.bootstrapProjectFromBrief({
      idea: 'LLM generated idea',
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
    expect(body.text).toContain('complete game');
    expect(body.text).toContain('art direction');
    expect(body.text).toContain('UI/UX');
    expect(body.text).toContain('placeholder asset');
    expect(body.text).toContain('replaceable');
    expect(body.text).toContain('Create useful project documents under ./docs/');
    expect(body.text).toContain('Use docs as project resources, not as chat-only summaries.');
    expect(body.text).not.toContain('Use chat only for a short progress note or summary after the files are written.');
    expect(body.text).not.toContain('Core Loop');
    expect(body.text).not.toContain('Fun Hook');
    expect(body.text).not.toContain('Risk/Reward');
    expect(body.text).not.toContain('First 3 Minutes');
    expect(body.text).not.toContain('Playability Acceptance Checklist');
    expect(body.text).toContain('BeeGame does not require machine-readable verifier files.');
    expect(body.text).toContain('You may use available subagents when the task genuinely benefits from delegation');
    expect(body.text).not.toContain('Use the runtime agent planning and review flow during implementation.');
    expect(body.text).not.toContain("Use BeeGame's own planning");
    expect(body.text).toContain('run the relevant build/test/typecheck checks for the generated project');
    expect(body.text).toContain('Completion contract: do not treat an API end_turn, a summary message, or a build/typecheck command alone as project completion.');
    expect(body.text).toContain('choose target-appropriate validation for the selected platform and engine yourself');
    expect(body.text).toContain('prove the core player loop from the brief actually works');
    expect(body.text).toContain('Use the project\'s own tooling and conventions.');
    expect(body.text).toContain('Do not force a specific package manager, browser tool, engine, framework, or test runner');
    expect(body.text).toContain('Do not create, edit, or suggest using BeeGame dashboard or host application source paths.');
    expect(body.text).not.toContain('apps/frontend');
    expect(body.text).not.toContain('apps/dashboard');
    expect(body.text).not.toContain('packages');
    expect(body.text).toContain('current working directory is already the project directory')
    expect(body.text).toContain('Do not create another top-level folder')
    expect(body.text).not.toContain('./snake-game');
    expect(body.text).not.toContain('./games/snake');
  });

  it('does not encourage subagents when the BeeGame subagent setting is disabled', async () => {
    localStorage.setItem('beegame-adapter-subagents-enabled', '0');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_brief',
          cwd: '/tmp/beegame-projects/snake-game',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_brief/input' && init?.method === 'POST') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.bootstrapProjectFromBrief({
      idea: '做一个贪吃蛇',
      title: '贪吃蛇',
      option: makeLlmOption(),
      settings: {
        platform: 'Web',
        visualStyle: 'Pixel',
        dimension: '2D',
        genre: 'Arcade',
        inputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
      },
      root_path: '/tmp/beegame-projects',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_brief/input' &&
      init?.method === 'POST'
    ));
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as { text?: string };
    expect(body.text).toContain('Plan and implement directly in this session unless the user explicitly asks for subagents.');
    expect(body.text).not.toContain('You may use available subagents when the task genuinely benefits from delegation');
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
      idea: 'LLM generated idea',
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

  it('sends follow-up messages without repeating session policy blocks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_followup/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_followup') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    await beeGameAdapter.sendMessage({
      project_id: result.project.id,
      content: '开始游戏后蛇没有吃食物也会变长，请修复。',
    });

    const inputBodies = fetchMock.mock.calls
      .filter(([path, init]) => (
        String(path) === '/api/beegame-sessions/beegame_followup/input' &&
        init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as { text?: string });
    const followUp = inputBodies[1]?.text || '';

    expect(followUp).toBe('开始游戏后蛇没有吃食物也会变长，请修复。');
    expect(followUp).not.toContain('Branding rule:');
    expect(followUp).not.toContain('Workspace rule:');
    expect(followUp).not.toContain('Response language:');
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
      idea: 'LLM generated idea',
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
      idea: 'LLM generated idea',
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
      idea: 'LLM generated idea',
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

  it('maps BeeGame turn completion to idle instead of finished project status', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_idle',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_idle/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_idle',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_idle/events?after=0') {
        return jsonResponse([
          assistantMessageEvent(30, 'beegame_idle', 'turn-1', '这一轮处理完了，可以继续反馈。'),
          turnCompletedEvent(31, 'beegame_idle', 'turn-1'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    const status = polled.messages.find(message => message.type === 'status');
    expect(status).toEqual(expect.objectContaining({ status: 'idle' }));
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'finished')).toBe(false);
  });

  it('surfaces a status alert when compact ends before resuming tool work', async () => {
    const compactEvents = [
      turnStartedEvent(40, 'beegame_compact', 'turn-1'),
      bashFailedEvent(
        41,
        'beegame_compact',
        'turn-1',
        'bun run typecheck',
        'src/main.ts(12,1): error TS2304: Cannot find name.',
      ),
      compactBoundaryEvent(42, 'beegame_compact', 'turn-1'),
      assistantMessageEvent(43, 'beegame_compact', 'turn-1', '我会继续运行 typecheck。'),
      endTurnResultEvent(44, 'beegame_compact', 'turn-1'),
      turnCompletedEvent(45, 'beegame_compact', 'turn-1'),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_compact',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_compact/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_compact',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_compact/events?after=0') {
        return jsonResponse(compactEvents);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', status: 'idle' }),
      expect.objectContaining({
        type: 'status',
        sender: 'system',
        task_kind: 'runtime_notice',
        content: expect.stringContaining('Context compaction ended the turn before tool work resumed'),
      }),
    ]));
    expect(polled.messages.some(message => message.type === 'human_gate')).toBe(false);
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'paused')).toBe(false);

    const history = await beeGameAdapter.getChatHistory(result.project.id);
    expect(history.some(message => message.sender === 'system' && message.content.includes('context compaction'))).toBe(false);
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
      idea: 'LLM generated idea',
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
      idea: 'LLM generated idea',
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

  it('formats Agent tool events as subagent cards', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_subagent',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_subagent/input' && init?.method === 'POST') {
        return jsonResponse({ ok: true });
      }
      if (path === '/api/beegame-sessions/beegame_subagent') {
        return jsonResponse({
          id: 'beegame_subagent',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_subagent/events?after=0') {
        return jsonResponse([
          {
            id: 50,
            sessionId: 'beegame_subagent',
            turnId: 'turn-1',
            type: 'tool.started',
            text: 'Agent',
            payload: {
              type: 'tool.started',
              toolUseID: 'tool_agent',
              toolName: 'Agent',
              input: {
                description: 'Review game feel',
                prompt: 'Review the prototype controls and feedback.',
                subagent_type: 'general-purpose',
              },
            },
            createdAt: '2026-06-21T00:00:50.000Z',
          },
          {
            id: 51,
            sessionId: 'beegame_subagent',
            turnId: 'turn-1',
            type: 'tool.failed',
            text: 'Agent failed',
            payload: {
              type: 'tool.failed',
              toolUseID: 'tool_agent_empty',
              toolName: 'Agent',
              input: {},
              output: '<tool_use_error>InputValidationError</tool_use_error>',
            },
            createdAt: '2026-06-21T00:00:51.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages[0]).toEqual(expect.objectContaining({
      type: 'tool_start',
      tool: 'Agent',
      content: expect.stringContaining('Subagent: Review game feel'),
    }));
    expect(polled.messages[0].content).toContain('Type: general-purpose');
    expect(polled.messages[0].content).toContain('Prompt: Review the prototype controls and feedback.');
    expect(polled.messages[1]).toEqual(expect.objectContaining({
      type: 'tool_end',
      tool: 'Agent',
      content: expect.stringContaining('Subagent: Agent'),
    }));
    expect(polled.messages[1].content).toContain('Status: failed');
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
      idea: 'LLM generated idea',
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

  it('maps runtime observation events into project context without adding chat noise', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_observe',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_observe/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_observe',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_observe') {
        return jsonResponse({
          id: 'beegame_observe',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_observe/events?after=0') {
        return jsonResponse([
          runtimeObservationEvent(70, 'beegame_observe', 'initialized'),
          resultEvent(71, 'beegame_observe', 'turn-1', 200, 50),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(polled.messages.some(message => message.content?.includes('runtime observability'))).toBe(false);
    expect(status.context).toEqual(expect.objectContaining({
      bundle_id: 'beegame-runtime-beegame_observe',
      status: 'initialized',
      selected_skills: expect.arrayContaining([
        'Context collapse',
        'History snip',
        'Token budget',
        'Monitor tool',
      ]),
      token_budget: {
        status: 'tracking',
        prompt_tokens: 200,
        completion_tokens: 50,
        total_tokens: 250,
      },
    }));
  });

  it('shows real permission requests without synthetic runtime gates', async () => {
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
          permissionRequestedEvent(53, 'beegame_gate', 'turn-1', 'Write'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'human_gate',
        content: 'Write game files?',
      }),
    ]));
    expect(polled.messages.some(message => message.type === 'agent_message')).toBe(false);
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
      if (path === '/api/beegame-sessions/beegame_delete?deleteArtifacts=1&workspacePath=%2Ftmp%2Fbeegame-projects' && init?.method === 'DELETE') {
        return jsonResponse({ deleted: true, deletedArtifactPaths: ['/tmp/beegame-projects/snake-game'] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });

    await beeGameAdapter.deleteProject(result.project.id);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/beegame-sessions/beegame_delete?deleteArtifacts=1&workspacePath=%2Ftmp%2Fbeegame-projects',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
  });

  it('treats an already-missing BeeGame session workspace as deleted locally', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete_missing',
          cwd: '/tmp/beegame-projects/classic-match3-levels',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_delete_missing/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete_missing',
          cwd: '/tmp/beegame-projects/classic-match3-levels',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (
        path === '/api/beegame-sessions/beegame_delete_missing?deleteArtifacts=1&workspacePath=%2Ftmp%2Fbeegame-projects%2Fclassic-match3-levels' &&
        init?.method === 'DELETE'
      ) {
        return jsonResponse({
          error: "ENOENT: no such file or directory, lstat '/tmp/beegame-projects/classic-match3-levels'",
        }, 404);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
      confirmedBrief: {
        title: 'Classic Match3 Levels',
        projectFolderName: 'classic-match3-levels',
      },
    } as any);

    await expect(beeGameAdapter.deleteProject(result.project.id)).resolves.toEqual({ ok: true });
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
    createdAt: `2026-06-21T00:00:${String(id % 60).padStart(2, '0')}.000Z`,
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
    createdAt: `2026-06-21T00:00:${String(id % 60).padStart(2, '0')}.000Z`,
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
    createdAt: `2026-06-21T00:00:${String(id % 60).padStart(2, '0')}.000Z`,
  };
}

function toolStartedEvent(id: number, sessionId: string, toolUseID: string, toolName: string, text: string, turnId = 'turn-1') {
  return {
    id,
    sessionId,
    turnId,
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

function endTurnResultEvent(id: number, sessionId: string, turnId: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'result',
    text: 'Done',
    payload: {
      type: 'result',
      stop_reason: 'end_turn',
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function compactBoundaryEvent(id: number, sessionId: string, turnId: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'system.status',
    text: 'system',
    payload: {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 87354,
      },
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function bashCompletedEvent(id: number, sessionId: string, turnId: string, command: string, output: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'tool.completed',
    text: output,
    payload: {
      type: 'tool.completed',
      toolUseID: `tool_${id}`,
      toolName: 'Bash',
      input: { command },
      output,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function bashFailedEvent(id: number, sessionId: string, turnId: string, command: string, output: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'tool.failed',
    text: output,
    payload: {
      type: 'tool.failed',
      toolUseID: `tool_${id}`,
      toolName: 'Bash',
      input: { command },
      output,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function runtimeObservationEvent(id: number, sessionId: string, status: string) {
  return {
    id,
    sessionId,
    type: 'runtime.observation',
    text: 'BeeGame runtime observability updated',
    payload: {
      type: 'runtime.observation',
      status,
      phase: 'planning',
      features: [
        { id: 'CONTEXT_COLLAPSE', label: 'Context collapse', stage: 'phase_1', status: 'available' },
        { id: 'HISTORY_SNIP', label: 'History snip', stage: 'phase_1', status: 'available' },
        { id: 'TOKEN_BUDGET', label: 'Token budget', stage: 'phase_1', status: 'available' },
        { id: 'MONITOR_TOOL', label: 'Monitor tool', stage: 'phase_1', status: 'available' },
      ],
      counters: {
        eventCount: 12,
        toolUseCount: 2,
        turnIndex: 1,
      },
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}


function turnCompletedEvent(id: number, sessionId: string, turnId: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'turn.completed',
    text: 'BeeGame turn completed',
    payload: { type: 'turn.completed' },
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
