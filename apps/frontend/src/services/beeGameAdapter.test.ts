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
    expect(body.text).toContain('BeeGame dashboard recovered this project after a backend restart');
    expect(body.text).toContain('Make a tactical puzzle game.');
    expect(body.text).toContain('docs/GDD.md');
    expect(body.text).toContain('继续任务');
  });

  it('sends continue input for an existing paused session without backend restart recovery', async () => {
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
          {
            id: 1,
            type: 'workflow.blocked',
            text: 'BeeGame paused build before implementation.',
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          {
            id: 2,
            type: 'system.status',
            text: 'BeeGame workflow paused',
            payload: {
              type: 'workflow.paused',
              reason: 'BeeGame paused build before implementation.',
            },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
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
    expect(body.text).toContain('BeeGame dashboard is resuming this project from the latest paused state');
    expect(body.text).toContain('BeeGame paused build before implementation.');
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
    expect(body.text).toContain('First produce a mandatory BeeGame design pack as project files before implementation.');
    expect(body.text).toContain('docs/PLAYABLE_SPEC.md');
    expect(body.text).toContain('source-of-truth playable spec');
    expect(body.text).toContain('docs/GDD.md');
    expect(body.text).toContain('docs/TECH_DESIGN.md');
    expect(body.text).toContain('docs/ART_AUDIO_DIRECTION.md');
    expect(body.text).toContain('docs/RESOURCE_PLACEHOLDERS.md');
    expect(body.text).toContain('docs/LEVEL_TUNING.md');
    expect(body.text).toContain('docs/PLAYABILITY_ACCEPTANCE.md');
    expect(body.text).toContain('Use chat only for a short progress note or summary after the files are written.');
    expect(body.text).toContain('Core Loop');
    expect(body.text).toContain('Fun Hook');
    expect(body.text).toContain('Risk/Reward');
    expect(body.text).toContain('First 3 Minutes');
    expect(body.text).toContain('Playability Acceptance Checklist');
    expect(body.text).toContain('Do not start implementation until the Playable Spec is internally checked against the checklist.');
    expect(body.text).toContain('PLAYABILITY_CHECKS_PASSED: yes');
    expect(body.text).toContain('Do not create, edit, or suggest using BeeGame dashboard or host application source paths.');
    expect(body.text).not.toContain('apps/frontend');
    expect(body.text).not.toContain('apps/dashboard');
    expect(body.text).not.toContain('packages');
    expect(body.text).toContain('current working directory is already the project directory')
    expect(body.text).toContain('Do not create another top-level folder')
    expect(body.text).not.toContain('./snake-game');
    expect(body.text).not.toContain('./games/snake');
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

  it('maps BeeGame playability verification requirements into build report checks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_verify',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_verify/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_verify',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_verify') {
        return jsonResponse({
          id: 'beegame_verify',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_verify/events?after=0') {
        return jsonResponse([
          verificationRequiredEvent(80, 'beegame_verify'),
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

    expect(polled.messages).toEqual([]);
    expect(status.build_report).toEqual(expect.objectContaining({
      status: 'verification_required',
      report_path: 'BEEGAME_PLAYABILITY_REVIEW.md',
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'Clarity within 30 seconds',
          status: 'required',
        }),
        expect.objectContaining({
          name: 'First interesting decision within 60 seconds',
          status: 'required',
        }),
      ]),
    }));
  });

  it('exposes verifier-passed BeeGame build reports from structured evidence events', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_verified',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_verified/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_verified',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_verified/events?after=0') {
        return jsonResponse([
          verificationRequiredEvent(80, 'beegame_verified'),
          verificationPassedEvent(81, 'beegame_verified'),
          turnCompletedEvent(82, 'beegame_verified', 'turn-1'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(status.phase).toBe('finished');
    expect(status.build_report).toEqual(expect.objectContaining({
      status: 'completed',
      report_path: 'BEEGAME_PLAYABILITY_REVIEW.md',
      generated_paths: expect.arrayContaining([
        'traceability_matrix.json',
        'playable_loop_review.md',
        'BEEGAME_PLAYABILITY_REVIEW.md',
      ]),
      summary: expect.stringContaining('structured BeeGame verifier'),
    }));
  });

  it('maps BeeGame workflow pipeline events into dashboard phase info', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_pipeline',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_pipeline/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_pipeline',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_pipeline') {
        return jsonResponse({
          id: 'beegame_pipeline',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_pipeline/events?after=0') {
        return jsonResponse([
          workflowPipelineEvent(90, 'beegame_pipeline', 'gdd', [
            { id: 'idea_intake', status: 'completed' },
            { id: 'gdd', status: 'active' },
            { id: 'implementation', status: 'pending' },
          ]),
          workflowPipelineEvent(91, 'beegame_pipeline', 'implementation', [
            { id: 'idea_intake', status: 'completed' },
            { id: 'gdd', status: 'completed' },
            { id: 'implementation', status: 'active' },
          ]),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const phases = await beeGameAdapter.getWorkflowPhases(result.project.id);

    expect(phases).toEqual({
      current_phase: 3,
      phase_name: 'implementation',
      history: [
        { phase: 0, name: 'idea_intake', timestamp: Date.parse('2026-06-21T00:00:31.000Z') },
        { phase: 2, name: 'gdd', timestamp: Date.parse('2026-06-21T00:00:31.000Z') },
        { phase: 3, name: 'implementation', timestamp: Date.parse('2026-06-21T00:00:31.000Z') },
      ],
    });
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
    expect(polled.messages.some(message => message.content === 'Designing Playable Spec')).toBe(false);
    expect(polled.messages.some(message => message.content === 'Building the game')).toBe(false);
    expect(status.phase).toBe('waiting_approval');
    expect(status.next_action).toBe('Review BeeGame permission request');
    expect(status.approval_required).toBe(true);
  });

  it('surfaces workflow blocks as project status alerts instead of chat messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_blocked',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_blocked/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_blocked',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_blocked/events?after=0') {
        return jsonResponse([
          turnStartedEvent(61, 'beegame_blocked', 'turn-1'),
          workflowBlockedEvent(
            62,
            'beegame_blocked',
            'turn-1',
            'tool',
            'BeeGame required design pack is incomplete before implementation: docs/PLAYABLE_SPEC.md',
          ),
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
        type: 'status',
        status: 'paused',
      }),
    ]));
    expect(polled.messages.some(message => message.type === 'agent_message')).toBe(false);
    expect(status.phase).toBe('paused');
    expect(status.blocked).toBe(true);
    expect(status.blocked_reason).toContain('docs/PLAYABLE_SPEC.md');
    expect(status.next_action).toContain('docs/PLAYABLE_SPEC.md');
  });

  it('keeps workflow paused visible after the pipeline reports failed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_paused_after_failed',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:04.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_paused_after_failed/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_paused_after_failed',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_paused_after_failed/events?after=0') {
        return jsonResponse([
          turnStartedEvent(91, 'beegame_paused_after_failed', 'turn-1'),
          workflowBlockedEvent(
            92,
            'beegame_paused_after_failed',
            'turn-1',
            'tool',
            'BeeGame traceability matrix is incomplete: traceability_matrix.json is missing',
            { phase: 'building', recoveryKind: 'playable_loop_review_required' },
          ),
          workflowFailedEvent(93, 'beegame_paused_after_failed', 'turn-1', 'BeeGame build did not complete'),
          workflowPausedEvent(
            94,
            'beegame_paused_after_failed',
            'turn-1',
            'BeeGame traceability matrix is incomplete: traceability_matrix.json is missing',
          ),
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
        type: 'status',
        status: 'paused',
        content: expect.stringContaining('traceability_matrix.json'),
      }),
    ]));
    expect(status.phase).toBe('paused');
    expect(status.blocked).toBe(true);
    expect(status.blocked_reason).toContain('traceability_matrix.json');
  });

  it('retires stale workflow blocks when the same turn continues running tools', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_resumed_after_block',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:07.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_resumed_after_block/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_resumed_after_block',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:07.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_resumed_after_block/events?after=0') {
        return jsonResponse([
          turnStartedEvent(71, 'beegame_resumed_after_block', 'turn-1'),
          workflowBlockedEvent(
            72,
            'beegame_resumed_after_block',
            'turn-1',
            'Bash',
            'Playable Spec is not ready.',
          ),
          toolStartedEvent(73, 'beegame_resumed_after_block', 'tool_bash_retry', 'Bash', 'Bash'),
          toolCompletedEvent(74, 'beegame_resumed_after_block', 'tool_bash_retry', 'Bash', 'Bash completed'),
          toolStartedEvent(75, 'beegame_resumed_after_block', 'tool_edit', 'Edit', 'Edit'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(status.phase).toBe('running');
    expect(status.blocked).toBe(false);
    expect(status.next_action).toBe('Running Edit');
  });

  it('shows running when a new turn starts after an earlier workflow pause', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs?ownerId=dashboard-local') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_continue_after_pause',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:10.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_continue_after_pause/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_continue_after_pause',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:10.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_continue_after_pause/events?after=0') {
        return jsonResponse([
          turnStartedEvent(81, 'beegame_continue_after_pause', 'turn-1'),
          workflowBlockedEvent(
            82,
            'beegame_continue_after_pause',
            'turn-1',
            'tool',
            'BeeGame playable loop review is incomplete: playable_loop_review.json contains invalid JSON',
            { phase: 'building', recoveryKind: 'playable_loop_review_required' },
          ),
          workflowPausedEvent(
            83,
            'beegame_continue_after_pause',
            'turn-1',
            'BeeGame playable loop review is incomplete: playable_loop_review.json contains invalid JSON',
          ),
          turnStartedEvent(84, 'beegame_continue_after_pause', 'turn-2'),
          toolStartedEvent(85, 'beegame_continue_after_pause', 'tool_write_review', 'Write', 'Write', 'turn-2'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.bootstrapProjectFromIdea({
      idea: 'LLM generated idea',
      root_path: '/tmp/beegame-projects',
    });
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(status.phase).toBe('running');
    expect(status.blocked).toBe(false);
    expect(status.next_action).toBe('Running Write');
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

function verificationRequiredEvent(id: number, sessionId: string) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'verification.required',
    text: 'BeeGame playability verification is required',
    payload: {
      type: 'verification.required',
      artifactPath: 'BEEGAME_PLAYABILITY_REVIEW.md',
      checks: [
        { id: 'clarity_30s', label: 'Clarity within 30 seconds', detail: 'Player understands goal, controls, and feedback quickly.' },
        { id: 'interesting_decision_60s', label: 'First interesting decision within 60 seconds', detail: 'The first minute contains a meaningful player decision.' },
      ],
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function verificationPassedEvent(id: number, sessionId: string) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'verification.required',
    text: 'BeeGame playability verification passed',
    payload: {
      type: 'verification.required',
      artifactPath: 'BEEGAME_PLAYABILITY_REVIEW.md',
      status: 'pass',
      generatedPaths: [
        'traceability_matrix.json',
        'playable_loop_review.md',
        'BEEGAME_PLAYABILITY_REVIEW.md',
      ],
      checks: [
        { id: 'start', label: 'Start playable loop', status: 'pass' },
        { id: 'player_action', label: 'Player action changes state', status: 'pass' },
      ],
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

function workflowPipelineEvent(
  id: number,
  sessionId: string,
  currentPhase: string,
  stages: Array<{ id: string; status: string }>,
) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'workflow.pipeline',
    text: currentPhase,
    payload: {
      type: 'workflow.pipeline',
      currentPhase,
      stages,
    },
    createdAt: `2026-06-21T00:00:${String(id % 60).padStart(2, '0')}.000Z`,
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

function workflowBlockedEvent(
  id: number,
  sessionId: string,
  turnId: string,
  toolName: string,
  reason: string,
  payload: Record<string, unknown> = {},
) {
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
      ...payload,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function workflowFailedEvent(id: number, sessionId: string, turnId: string, error: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'workflow.pipeline',
    text: 'failed',
    payload: {
      type: 'workflow.pipeline',
      status: 'failed',
      error,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function workflowPausedEvent(id: number, sessionId: string, turnId: string, reason: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'system.status',
    text: 'BeeGame workflow paused',
    payload: {
      type: 'workflow.paused',
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
