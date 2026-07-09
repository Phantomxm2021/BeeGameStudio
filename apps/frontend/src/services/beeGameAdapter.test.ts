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

  it('analyzes uploaded attachments without converting them into intake options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      analysisId: 'analysis_gdd',
      sourceType: 'gdd',
      completeness: 'complete',
      confirmedFacts: [],
      inferredDesign: [],
      missingFields: [],
      conflicts: [],
      gddDraft: '# Confirmed GDD',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const analysis = await beeGameAdapter.analyzeAttachmentBuild({
      attachments: [{
        type: 'file',
        mediaType: 'text/markdown',
        data: 'I0dE',
        filename: 'game-design.md',
      }],
      language: 'zh',
      thinkingMode: 'disabled',
      clientRequestId: 'attachment-analysis-1',
    });

    expect(analysis.completeness).toBe('complete');
    expect(fetchMock).toHaveBeenCalledWith('/api/beegame-intake/analyze-attachments', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      clientRequestId: 'attachment-analysis-1',
      attachments: expect.any(Array),
    }));
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

  it('stops a BeeGame session by resolving the current project binding', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_local',
        sessionId: 'beegame_session_1',
        workspacePath: '/tmp/beegame-projects/local',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/beegame-sessions/beegame_session_1/stop' && init?.method === 'POST') {
        return jsonResponse({ id: 'beegame_session_1', status: 'stopped' });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.stopTask({
      task_id: 'project_local',
      project_id: 'project_local',
    })).resolves.toEqual(expect.objectContaining({
      task_id: 'beegame_session_1',
      state: 'stopped',
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/beegame-sessions/beegame_session_1/stop',
      expect.objectContaining({ method: 'POST' }),
    );
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

  it('does not fall back to local project storage for authenticated cloud sessions', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      { id: 'project_local', name: 'Local Only', created_at: 1700000000000 },
    ]));
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).rejects.toThrow('not found');
  });

  it('scopes cloud project cache to the authenticated user', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/projects') {
        return jsonResponse([
          { id: 'project_cloud', name: 'Cloud Project', created_at: 1710000000000 },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([
      { id: 'project_cloud', name: 'Cloud Project', created_at: 1710000000000 },
    ]);

    expect(localStorage.getItem('beegame-adapter-projects')).toBeNull();
    expect(JSON.parse(localStorage.getItem('beegame-adapter-projects:user_cloud') || '[]')).toEqual([
      { id: 'project_cloud', name: 'Cloud Project', created_at: 1710000000000 },
    ]);
  });

  it('does not synthesize local game mode options when LLM intake fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({ error: 'intake unavailable' }, 500)
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.generateIntakeOptions({ idea: 'idea requiring LLM' }))
      .rejects.toThrow('intake unavailable');
    expect(fetchMock).toHaveBeenCalledWith('/api/beegame-intake/options', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('uses backend error message text when intake returns a structured failure', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({
          error: 'Insufficient credits',
          message: 'Credit 不足。本次方案生成需要预扣 3 credits，你当前有 0 credits。',
        }, 402)
        : jsonResponse({ error: 'not found' }, 404)
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.runIdeaIntake({ idea: 'idea requiring LLM' }))
      .rejects.toThrow('Credit 不足。本次方案生成需要预扣 3 credits，你当前有 0 credits。');
  });


  it('runs BeeGame intake through a short-lived async job when the runtime supports it', async () => {
    const llmOption = makeLlmOption({ id: 'job_mode', title: 'Job Mode' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-intake/jobs' && init?.method === 'POST') {
        return jsonResponse({ jobId: 'intake_job_1', status: 'running' }, 202);
      }
      if (path === '/api/beegame-intake/jobs/intake_job_1') {
        return jsonResponse({
          status: 'completed',
          result: {
            maturity: 'directional',
            needsOptions: true,
            needsClarification: false,
            detectedConstraints: ['Async constraint'],
            recommendedNextStep: 'choose_direction',
            options: [llmOption],
          },
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const intake = await beeGameAdapter.runIdeaIntake({ idea: 'LLM generated idea', language: 'zh' });

    expect(intake.options[0]).toEqual(expect.objectContaining({ id: 'job_mode', title: 'Job Mode' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/beegame-intake/jobs');
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { idea?: string; language?: string; clientRequestId?: string };
    expect(requestBody).toEqual({
      idea: 'LLM generated idea',
      language: 'zh',
      clientRequestId: expect.any(String),
    });
  });

  it('sends selected BeeGame intake thinking mode to the async job', async () => {
    const llmOption = makeLlmOption({ id: 'job_mode', title: 'Job Mode' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-intake/jobs' && init?.method === 'POST') {
        return jsonResponse({ jobId: 'intake_job_1', status: 'running' }, 202);
      }
      if (path === '/api/beegame-intake/jobs/intake_job_1') {
        return jsonResponse({
          status: 'completed',
          result: {
            maturity: 'directional',
            needsOptions: true,
            needsClarification: false,
            detectedConstraints: [],
            recommendedNextStep: 'choose_direction',
            options: [llmOption],
          },
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.runIdeaIntake({
      idea: 'LLM generated idea',
      language: 'zh',
      thinkingMode: 'disabled',
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as {
      idea?: string;
      language?: string;
      thinkingMode?: string;
      clientRequestId?: string;
    };
    expect(requestBody).toEqual({
      idea: 'LLM generated idea',
      language: 'zh',
      thinkingMode: 'disabled',
      clientRequestId: expect.any(String),
    });
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({
          maturity: 'directional',
          needsOptions: true,
          needsClarification: false,
          detectedConstraints: ['LLM constraint'],
          recommendedNextStep: 'choose_direction',
          options: [llmOption],
        })
    ));
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
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { idea?: string; clientRequestId?: string };
    expect(requestBody).toEqual({ idea: 'LLM generated idea', clientRequestId: expect.any(String) });
  });

  it('normalizes snake_case intake setting fields before the UI builds production settings', async () => {
    const llmOption = makeLlmOption({
      recommendedPlatform: undefined,
      recommendedDimension: undefined,
      recommendedGenre: undefined,
      recommendedStyle: undefined,
      recommendedInputs: undefined,
      recommended_platform: 'PC',
      recommended_engine: 'Unity',
      recommended_dimension: '3D',
      recommended_genre: 'Racing',
      recommended_style: 'Realistic',
      recommended_inputs: ['Keyboard/mouse', 'Gamepad'],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({
          maturity: 'directional',
          needsOptions: true,
          needsClarification: false,
          detectedConstraints: [],
          recommendedNextStep: 'choose_direction',
          options: [llmOption],
        })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const intake = await beeGameAdapter.runIdeaIntake({ idea: 'LLM generated idea' });

    expect(intake.options[0]).toEqual(expect.objectContaining({
      recommendedPlatform: 'PC',
      recommendedEngine: 'Unity',
      recommendedDimension: '3D',
      recommendedGenre: 'Racing',
      recommendedStyle: 'Realistic',
      recommendedInputs: ['Keyboard/mouse', 'Gamepad'],
    }));
  });

  it('passes the selected language to BeeGame intake', async () => {
    const llmOption = makeLlmOption();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({
          maturity: 'directional',
          needsOptions: true,
          needsClarification: false,
          detectedConstraints: [],
          recommendedNextStep: 'choose_direction',
          options: [llmOption],
        })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.runIdeaIntake({ idea: '做一个样例游戏', language: 'zh' });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { idea?: string; language?: string; clientRequestId?: string };
    expect(requestBody).toEqual({ idea: '做一个样例游戏', language: 'zh', clientRequestId: expect.any(String) });
  });

  it('rejects structured clarification responses without intake options', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({
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
        })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.runIdeaIntake({ idea: 'idea requiring clarification' })).rejects.toThrow(
      'BeeGame intake did not return game mode options',
    );
  });

  it('creates new sessions in a project-specific workspace under the default Projects directory', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/model-configs') {
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
          cwd: '/tmp/beegame-projects/sample-web-game',
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
        id: 'sample_web',
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
      if (path === '/api/model-configs') {
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

  it('sends a confirmed attachment GDD as the direct build source', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') return jsonResponse({ path: '/tmp/beegame-projects' });
      if (path === '/api/model-configs') return jsonResponse([{ id: 'model_default', isDefault: true }]);
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { workspacePath?: string };
        return jsonResponse({ id: 'beegame_gdd', cwd: body.workspacePath, status: 'running', turnStatus: 'idle' });
      }
      if (path === '/api/beegame-sessions/beegame_gdd/input' && init?.method === 'POST') {
        return jsonResponse({ id: 'beegame_gdd', cwd: '/tmp/beegame-projects/confirmed-gdd', status: 'running', turnStatus: 'running' });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.bootstrapProjectFromBrief({
      idea: 'uploaded design',
      title: 'Confirmed GDD',
      option: makeLlmOption({ title: 'Confirmed GDD' }),
      settings: { platform: '', visualStyle: '', dimension: '', genre: '', inputs: [], scope: '' },
      language: 'en',
      confirmedGdd: '# Rules\n- Solve the puzzle to win.',
      buildSource: 'gdd',
      analysisId: 'analysis_direct_build',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_gdd/input' && init?.method === 'POST'
    ));
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string };
    expect(body.text).toContain('Save it as docs/GDD.md first');
    expect(body.text).toContain('# Rules');
    expect(body.text).toContain('Do not regenerate a game plan');
  });

  it('keeps the confirmed project title for display and uses the LLM folder name for files', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/filesystem/default-workspace') {
        return jsonResponse({ path: '/tmp/beegame-projects' });
      }
      if (path === '/api/model-configs') {
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

  it('delegates legacy project session recovery to the backend ensure endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse({
          session: {
            id: 'beegame_migrated',
            cwd: '/tmp/beegame-projects/llm-project',
            modelConfigId: 'model_default',
            status: 'running',
            turnStatus: 'idle',
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z',
          },
          binding: {
            projectId: path.split('/')[3],
            sessionId: 'beegame_migrated',
            workspacePath: '/tmp/beegame-projects/llm-project',
          },
          previousSessionId: 'beegame_legacy',
        });
      }
      if (path === '/api/beegame-sessions/beegame_migrated/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_migrated',
          cwd: '/tmp/beegame-projects/sample-web-game',
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

    const ensureCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path).endsWith('/session/ensure') && init?.method === 'POST'
    ));
    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_migrated/input' && init?.method === 'POST'
    ));
    const bindings = JSON.parse(localStorage.getItem('beegame-adapter-bindings') || '[]') as Array<{
      sessionId?: string;
      workspacePath?: string;
    }>;

    expect(ensureCall).toBeTruthy();
    expect(inputCall).toBeTruthy();
    expect(bindings[0]).toEqual(expect.objectContaining({
      sessionId: 'beegame_migrated',
      workspacePath: '/tmp/beegame-projects/llm-project',
    }));
  });

  it('loads chat history from a persisted transcript after the backend restarts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsample-web-game') {
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
      name: 'sample-web-game',
      root_path: '/tmp/beegame-projects/sample-web-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
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

  it('restores a cloud project binding from session metadata when local binding is missing', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_cloud/sessions/latest') {
        return jsonResponse({
          id: 'beegame_cloud_restore',
          projectId: 'project_cloud',
          workspacePath: '/tmp/beegame-projects/users/user-cloud/cloud-game',
          status: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_cloud_restore/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fusers%2Fuser-cloud%2Fcloud-game') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_cloud_restore',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Cloud transcript restored.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const history = await beeGameAdapter.getChatHistory('project_cloud');

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'beegame',
        content: 'Cloud transcript restored.',
      }),
    ]));
    expect(localStorage.getItem('beegame-adapter-bindings')).toBeNull();
    expect(JSON.parse(localStorage.getItem('beegame-adapter-bindings:user_cloud') || '[]')).toEqual([
      {
        projectId: 'project_cloud',
        sessionId: 'beegame_cloud_restore',
        workspacePath: '/tmp/beegame-projects/users/user-cloud/cloud-game',
      },
    ]);
  });

  it('uses project root_path instead of stale cloud session workspace when restoring migrated projects', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));
    localStorage.setItem('beegame-adapter-projects:user_cloud', JSON.stringify([
      {
        id: 'project_cloud_migrated',
        name: 'Cloud Migrated',
        root_path: '/tmp/beegame-projects/cloud-migrated',
        created_at: 1710000000000,
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_cloud_migrated/sessions/latest') {
        return jsonResponse({
          id: 'beegame_cloud_migrated',
          projectId: 'project_cloud_migrated',
          workspacePath: '/tmp/beegame-projects/users/user-cloud/project_cloud_migrated',
          status: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_cloud_migrated/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fcloud-migrated') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_cloud_migrated',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Migrated project transcript restored.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const history = await beeGameAdapter.getChatHistory('project_cloud_migrated');

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'beegame',
        content: 'Migrated project transcript restored.',
      }),
    ]));
    expect(JSON.parse(localStorage.getItem('beegame-adapter-bindings:user_cloud') || '[]')).toEqual([
      {
        projectId: 'project_cloud_migrated',
        sessionId: 'beegame_cloud_migrated',
        workspacePath: '/tmp/beegame-projects/cloud-migrated',
      },
    ]);
  });

  it('infers the original BeeGame session from migrated project ids when local binding is missing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_beegame_legacy/sessions/latest') {
        return jsonResponse({ error: 'not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_legacy/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Flegacy-game') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_legacy',
            turnId: 'turn-1',
            type: 'user.message',
            text: 'Existing user request.',
            payload: { type: 'user.message' },
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          {
            id: 2,
            sessionId: 'beegame_legacy',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Existing project history.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([{
      id: 'project_beegame_legacy',
      name: 'legacy-game',
      root_path: '/tmp/beegame-projects/legacy-game',
      created_at: 1710000000000,
    }]));

    const history = await beeGameAdapter.getChatHistory('project_beegame_legacy');

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        content: 'Existing user request.',
      }),
      expect.objectContaining({
        sender: 'beegame',
        content: 'Existing project history.',
      }),
    ]));
    expect(JSON.parse(localStorage.getItem('beegame-adapter-bindings') || '[]')).toEqual([
      {
        projectId: 'project_beegame_legacy',
        sessionId: 'beegame_legacy',
        workspacePath: '/tmp/beegame-projects/legacy-game',
      },
    ]);
  });

  it('prefers persisted transcript history over incomplete runtime events after refresh', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_refresh/events?after=0') {
        return jsonResponse([
          {
            id: 2,
            sessionId: 'beegame_refresh',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Runtime only assistant message.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      if (path === '/api/beegame-sessions/beegame_refresh/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Frefresh-game') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_refresh',
            turnId: 'turn-1',
            type: 'user.message',
            text: 'Fix the input lag.',
            payload: { type: 'user.message' },
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          {
            id: 2,
            sessionId: 'beegame_refresh',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Transcript assistant message.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'refresh-game',
      root_path: '/tmp/beegame-projects/refresh-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_refresh',
      workspacePath: '/tmp/beegame-projects/refresh-game',
    }]));

    const history = await beeGameAdapter.getChatHistory(project.id);

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        content: 'Fix the input lag.',
      }),
      expect.objectContaining({
        sender: 'beegame',
        content: 'Transcript assistant message.',
      }),
    ]));
    expect(history).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: 'Runtime only assistant message.',
      }),
    ]));
  });

  it('does not replace the persisted binding during read-only status sync after the backend restarts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          phase: 'idle',
          active_agents: [],
          next_action: 'Ready for next request',
        }));
      }
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsample-web-game') {
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
      name: 'sample-web-game',
      root_path: '/tmp/beegame-projects/sample-web-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
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
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          phase: 'idle',
          active_agents: [],
          next_action: 'Ready for next request',
        }));
      }
      if (path === '/api/beegame-sessions/beegame_restart/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_restart/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fsample-web-game') {
        return jsonResponse(transcript);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'sample-web-game',
      root_path: '/tmp/beegame-projects/sample-web-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_restart',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
    }]));

    const status = await beeGameAdapter.getProjectStatus(project.id);
    const polled = await beeGameAdapter.pollMessages(project.id, 0);

    expect(status.phase).toBe('idle');
    expect(status.active_agents).toEqual([]);
    expect(status.next_action).toBe('Ready for next request');
    expect(polled.messages.some(message => (
      message.type === 'status' && String(message.content || '').includes('Backend restarted')
    ))).toBe(false);
  });

  it('treats a stopped session as idle even when the transcript turn never completed', async () => {
    const transcript = [
      turnStartedEvent(1, 'beegame_stopped', 'turn-1'),
      assistantMessageEvent(2, 'beegame_stopped', 'turn-1', 'Starting final verification.'),
      toolStartedEvent(3, 'beegame_stopped', 'tool_write_3', 'Write', 'Writing final notes.', 'turn-1'),
      sessionStoppedEvent(4, 'beegame_stopped', 'turn-1'),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          phase: 'idle',
          active_agents: [],
          next_action: 'Ready for input',
          model_config_id: 'model_default',
        }));
      }
      if (path === '/api/beegame-sessions/beegame_stopped/events?after=0') {
        return jsonResponse(transcript);
      }
      if (path === '/api/beegame-sessions/beegame_stopped') {
        return jsonResponse({ id: 'beegame_stopped', modelConfigId: 'model_default' });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'sample-web-game',
      root_path: '/tmp/beegame-projects/sample-web-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_stopped',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
    }]));

    const status = await beeGameAdapter.getProjectStatus(project.id);

    expect(status.phase).toBe('idle');
    expect(status.active_agents).toEqual([]);
    expect(status.next_action).toBe('Ready for input');
  });

  it('derives the build report preview URL from the managed preview host', async () => {
    const transcript = [
      turnStartedEvent(1, 'beegame_preview', 'turn-1'),
      bashCompletedEvent(
        2,
        'beegame_preview',
        'turn-1',
        'bun run dev -- --host 127.0.0.1 --port 5178',
        'Vite ready in 320ms\nLocal: http://127.0.0.1:5178/',
      ),
      bashCompletedEvent(3, 'beegame_preview', 'turn-1', 'bun run build', 'Build completed successfully.'),
      assistantMessageEvent(4, 'beegame_preview', 'turn-1', 'The playable game is delivered and available for preview.'),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          build_report: {
            status: 'passed',
            build_url: 'http://127.0.0.1:63100/',
            agents: ['dashboard-preview'],
          },
        }));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'preview-game',
      root_path: '/tmp/beegame-projects/preview-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_preview',
      workspacePath: '/tmp/beegame-projects/preview-game',
    }]));

    const status = await beeGameAdapter.getProjectStatus(project.id);

    expect(status.build_report).toMatchObject({
      status: 'passed',
      build_url: 'http://127.0.0.1:63100/',
      agents: ['dashboard-preview'],
    });
  });

  it('reads project status from the backend runtime-state endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_runtime_state/runtime-state') {
        return jsonResponse({
          project_id: 'project_runtime_state',
          phase: 'running',
          blocked: false,
          active_agents: ['beegame'],
          updated_at: '2026-06-21T00:00:04.000Z',
          approval_required: false,
          next_action: 'BeeGame is processing',
          context: {
            phase: 'running',
            token_budget: {
              status: 'tracking',
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          },
          build_report: null,
          review_status: null,
          model_config_id: 'model_default',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await beeGameAdapter.getProjectStatus('project_runtime_state');
    const phases = await beeGameAdapter.getWorkflowPhases('project_runtime_state') as { phase_name: string };
    const usage = await beeGameAdapter.getTokenUsage('project_runtime_state');

    expect(status.phase).toBe('running');
    expect(phases.phase_name).toBe('running');
    expect(usage).toEqual({
      status: 'tracking',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/runtime-snapshot'))).toBe(false);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/events?after='))).toBe(false);
  });

  it('delegates missing-session recovery to the backend ensure endpoint before sending input', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/project_backend_ensure/session/ensure' && init?.method === 'POST') {
        return jsonResponse({
          session: {
            id: 'beegame_new',
            cwd: '/tmp/beegame-projects/sample-web-game',
            status: 'running',
            turnStatus: 'idle',
            createdAt: '2026-06-21T00:00:03.000Z',
            updatedAt: '2026-06-21T00:00:03.000Z',
          },
          binding: {
            projectId: 'project_backend_ensure',
            sessionId: 'beegame_new',
            workspacePath: '/tmp/beegame-projects/sample-web-game',
          },
          previousSessionId: 'beegame_previous',
        });
      }
      if (path === '/api/beegame-sessions/beegame_new/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_new',
          cwd: '/tmp/beegame-projects/sample-web-game',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:03.000Z',
          updatedAt: '2026-06-21T00:00:04.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.sendMessage({
      project_id: 'project_backend_ensure',
      content: '继续任务',
      thinkingMode: 'disabled',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_new/input' && init?.method === 'POST'
    ));
    const ensureCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/projects/project_backend_ensure/session/ensure' && init?.method === 'POST'
    ));
    const ensureBody = JSON.parse(String(ensureCall?.[1]?.body || '{}')) as { language?: string };
    expect(ensureBody.language).toBeTruthy();
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as {
      text?: string;
      thinkingMode?: string;
    };
    expect(body.text).toBe('继续任务');
    expect(body.thinkingMode).toBe('disabled');
    expect(fetchMock.mock.calls.some(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ))).toBe(false);
  });

  it('ensures a stopped BeeGame session in the backend before sending a new chat message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          path.split('/')[3],
          'beegame_stopped',
          '/tmp/beegame-projects/sample-web-game',
          { modelConfigId: 'model_default' },
        ));
      }
      if (path === '/api/beegame-sessions/beegame_stopped/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_stopped',
          cwd: '/tmp/beegame-projects/sample-web-game',
          status: 'running',
          turnStatus: 'running',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'sample-web-game',
      root_path: '/tmp/beegame-projects/sample-web-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_stopped',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
    }]));

    await beeGameAdapter.sendMessage({
      project_id: project.id,
      content: 'Continue fixing the game.',
    });

    const ensureCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path).endsWith('/session/ensure') && init?.method === 'POST'
    ));
    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_stopped/input' && init?.method === 'POST'
    ));
    const inputBody = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string };
    expect(ensureCall).toBeTruthy();
    expect(inputBody.text).toBe('Continue fixing the game.');
    expect(fetchMock.mock.calls.some(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ))).toBe(false);
  });

  it('sends continue input for an existing idle session with transcript context', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          path.split('/')[3],
          'beegame_paused',
          '/tmp/beegame-projects/mode-from-llm',
        ));
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
    expect(body.text).toBe('继续任务');
  });

  it('syncs an existing session to the current default model before continuing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([
          {
            id: 'llm_new',
            name: 'New Model',
            provider: 'openai-compatible',
            apiKeyPreview: 'sk-...',
            models: { balanced: 'new-balanced-model' },
            isDefault: true,
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z',
          },
        ]);
      }
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          path.split('/')[3],
          'beegame_model_old',
          '/tmp/beegame-projects/model-sync-game',
          { modelConfigId: 'llm_old' },
        ));
      }
      if (
        path === '/api/beegame-sessions/beegame_model_old/model' &&
        init?.method === 'PATCH'
      ) {
        return jsonResponse({
          id: 'beegame_model_old',
          cwd: '/tmp/beegame-projects/model-sync-game',
          modelConfigId: 'llm_new',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:02.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_model_old/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_model_old',
          cwd: '/tmp/beegame-projects/model-sync-game',
          modelConfigId: 'llm_new',
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
      name: 'Model Sync Game',
      root_path: '/tmp/beegame-projects/model-sync-game',
    });
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_model_old',
      workspacePath: '/tmp/beegame-projects/model-sync-game',
    }]));

    await beeGameAdapter.continueTask({ project_id: project.id });

    const patchCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_model_old/model' &&
      init?.method === 'PATCH'
    ));
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body || '{}'))).toEqual({
      modelConfigId: 'llm_new',
    });
    const inputCallIndex = fetchMock.mock.calls.findIndex(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_model_old/input' &&
      init?.method === 'POST'
    ));
    const patchCallIndex = fetchMock.mock.calls.findIndex(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_model_old/model' &&
      init?.method === 'PATCH'
    ));
    expect(patchCallIndex).toBeGreaterThan(-1);
    expect(inputCallIndex).toBeGreaterThan(patchCallIndex);
  });

  it('starts a BeeGame session from a confirmed brief and rejects host source paths in the prompt', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as {
      text?: string;
      displayText?: string;
      displayKind?: string;
    };

    expect(body.text).toContain('我要做一个完整游戏项目。');
    expect(body).toMatchObject({
      displayText: 'LLM generated idea',
      displayKind: 'confirmed_brief',
    });
    expect(body.text).toContain('请像在终端里协作一样');
    expect(body.text).toContain('当前游戏方向和构建设置已经由用户确认');
    expect(body.text).toContain('不要重新进入需求头脑风暴、视觉 companion、方案审批或“是否要继续”的确认流程');
    expect(body.text).toContain('请直接开始写项目文档并实现');
    expect(body.text).not.toContain('Confirmed BeeGame build brief');
    expect(body.text).not.toContain('Completion contract');
    expect(body.text).not.toContain('Workspace rule:');
    expect(body.text).not.toContain('Branding rule:');
    expect(body.text).toContain('平台：Web');
    expect(body.text).toContain('输入方式：Keyboard/mouse, Touch');
    expect(body.text).toContain('请先在 docs/ 下写清项目资源');
    expect(body.text).toContain('美术方向');
    expect(body.text).toContain('UI/UX');
    expect(body.text).toContain('placeholder/asset slots');
    expect(body.text).toContain('assets/asset-manifest.json');
    expect(body.text).toContain('2D/3D/动画/材质/VFX/音频/字体/数据/本地化');
    expect(body.text).toContain('React/Web 等普通文件项目使用 filesystem');
    expect(body.text).toContain('Unity/Godot/Unreal/Blender 等需要编辑器上下文的项目可声明 mcp');
    expect(body.text).toContain('必须区分“本次交付已实现”和“后续路线图”');
    expect(body.text).toContain('不要把 roadmap 写成已交付能力');
    expect(body.text).toContain('docs 里的 acceptance/checklist 只能作为验收标准');
    expect(body.text).toContain('不要预先打勾或写成已通过');
    expect(body.text).toContain('方便替换的 placeholder 或 asset slot');
    expect(body.text).toContain('不要强行使用某个固定平台、包管理器、测试框架或浏览器');
    expect(body.text).toContain('不能只用类型检查、lint、构建命令、空测试或模型自评证明游戏完成');
    expect(body.text).toContain('启动/进入体验、理解目标、执行核心操作、看到反馈、达到胜负/进度变化，并能重开、继续或恢复');
    expect(body.text).toContain('可执行的玩家路径验证');
    expect(body.text).toContain('测试脚本必须包含断言');
    expect(body.text).toContain('不能只打印 true/false、success 或截图日志就当作通过');
    expect(body.text).toContain('交付前必须做文档与代码一致性检查');
    expect(body.text).toContain('修 bug、继续任务或调整已有项目时，必须补最小复现、回归测试或对应玩家路径验证');
    expect(body.text).toContain('交付前请使用可用的游戏验收指导或自检清单');
    expect(body.text).toContain('最终总结必须分为：已实现、已验证证据、未验证/已知缺口');
    expect(body.text).not.toContain('Implemented');
    expect(body.text).not.toContain('Verified with evidence');
    expect(body.text).not.toContain('Not verified / Known gaps');
    expect(body.text).not.toContain('Create useful project documents under ./docs/');
    expect(body.text).not.toContain('Use docs as project resources, not as chat-only summaries.');
    expect(body.text).not.toContain('Use chat only for a short progress note or summary after the files are written.');
    expect(body.text).not.toContain('Core Loop');
    expect(body.text).not.toContain('Fun Hook');
    expect(body.text).not.toContain('Risk/Reward');
    expect(body.text).not.toContain('First 3 Minutes');
    expect(body.text).not.toContain('Playability Acceptance Checklist');
    expect(body.text).not.toContain('machine-readable verifier');
    expect(body.text).not.toContain('You may use available subagents when the task genuinely benefits from delegation');
    expect(body.text).not.toContain('Use the runtime agent planning and review flow during implementation.');
    expect(body.text).not.toContain("Use BeeGame's own planning");
    expect(body.text).not.toContain('Plan, implement, check, and fix the project using your own normal workflow.');
    expect(body.text).not.toContain('invoke the beegame-game-acceptance skill');
    expect(body.text).not.toContain('If the skill returns FAIL');
    expect(body.text).not.toContain('If it returns BLOCKED');
    expect(body.text).not.toContain('Do not treat a normal assistant turn ending');
    expect(body.text).toContain('实现后请使用当前项目自己的工具链和目标平台选择合适的检查与验证方式');
    expect(body.text).not.toContain('Do not force a specific package manager, browser tool, engine, framework, or test runner');
    expect(body.text).not.toContain('Do not create, edit, or suggest using BeeGame dashboard or host application source paths.');
    expect(body.text).not.toContain('apps/frontend');
    expect(body.text).not.toContain('apps/dashboard');
    expect(body.text).not.toContain('/packages/');
    expect(body.text).not.toContain('current working directory is already the project directory')
    expect(body.text).not.toContain('Do not create another top-level folder')
    expect(body.text).not.toContain('./sample-game');
    expect(body.text).not.toContain('./games/sample');
  });

  it('restores the visible idea from transcript display metadata instead of the transport prompt', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_display/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fdisplay-game') {
        return jsonResponse([
          {
            id: 1,
            sessionId: 'beegame_display',
            turnId: 'turn-1',
            type: 'user.message',
            text: '请使用中文与用户沟通。\n我要做一个完整游戏项目。\n原始想法：用户输入的完整游戏想法',
            payload: {
              type: 'user.message',
              displayText: '用户输入的完整游戏想法',
              displayKind: 'confirmed_brief',
            },
            createdAt: '2026-06-21T00:00:01.000Z',
          },
          assistantMessageEvent(2, 'beegame_display', 'turn-1', '我会开始规划。'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.createProject({
      name: 'display-game',
      root_path: '/tmp/beegame-projects/display-game',
    });
    const project = (await beeGameAdapter.getProjects())[0];
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_display',
      workspacePath: '/tmp/beegame-projects/display-game',
    }]));

    const history = await beeGameAdapter.getChatHistory(project.id) as Array<{ sender: string; content: string }>;

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        content: '用户输入的完整游戏想法',
      }),
    ]));
    expect(history.map(message => message.content).join('\n')).not.toContain('请使用中文与用户沟通');
    expect(history.map(message => message.content).join('\n')).not.toContain('我要做一个完整游戏项目');
  });

  it('does not encourage subagents when the BeeGame subagent setting is disabled', async () => {
    localStorage.setItem('beegame-adapter-subagents-enabled', '0');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_brief',
          cwd: '/tmp/beegame-projects/sample-game',
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
      idea: '做一个样例游戏',
      title: '样例游戏',
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
    expect(body.text).not.toContain('Plan and implement directly in this session unless the user explicitly asks for subagents.');
    expect(body.text).not.toContain('You may use available subagents when the task genuinely benefits from delegation');
  });

  it('keeps English build prompts explicit about executable evidence', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_english_brief',
          cwd: '/tmp/beegame-projects/english-game',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_english_brief/input' && init?.method === 'POST') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.bootstrapProjectFromBrief({
      idea: 'Build a sample game',
      title: 'Snake Game',
      option: makeLlmOption({ title: 'Snake Game' }),
      settings: {
        platform: 'Web',
        visualStyle: 'Pixel',
        dimension: '2D',
        genre: 'Arcade',
        inputs: ['Keyboard/mouse'],
        scope: 'Playable demo',
        notes: 'Fast restart loop',
      },
      language: 'en',
      root_path: '/tmp/beegame-projects',
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) => (
      String(path) === '/api/beegame-sessions/beegame_english_brief/input' &&
      init?.method === 'POST'
    ));
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as { text?: string };

    expect(body.text).toContain('executable player-path checks');
    expect(body.text).toContain('must contain assertions');
    expect(body.text).toContain('fail with a non-zero exit status');
    expect(body.text).toContain('Do not count log-only scripts');
    expect(body.text).toContain('docs-to-code consistency review');
    expect(body.text).toContain('minimal reproduction, regression test, or matching player-path validation');
    expect(body.text).toContain('Implemented');
    expect(body.text).toContain('Verified with evidence');
    expect(body.text).toContain('Not verified / Known gaps');
  });

  it('keeps intake prompts free of package-name branding policy blocks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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

    expect(body.text).not.toContain('Do not apply BeeGame branding to code identifiers');
    expect(body.text).not.toContain('Never invent or rewrite package scopes such as @beegame/*');
    expect(body.text).not.toContain('use the real package name @ant/ink');
  });

  it('sends follow-up messages without repeating session policy blocks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          path.split('/')[3],
          'beegame_followup',
          '/tmp/beegame-projects/followup',
          { modelConfigId: 'model_default' },
        ));
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects/followup',
          modelConfigId: 'model_default',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_followup/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects/followup',
          modelConfigId: 'model_default',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_followup') {
        return jsonResponse({
          id: 'beegame_followup',
          cwd: '/tmp/beegame-projects/followup',
          modelConfigId: 'model_default',
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
      root_path: '/tmp/beegame-projects/followup',
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
      if (path === '/api/model-configs') {
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

  it('treats AskUserQuestion as a clarification review instead of a chat message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          phase: 'waiting_approval',
          blocked: true,
          approval_required: true,
          next_action: 'Review BeeGame permission request',
          active_agents: ['beegame'],
          pending_permissions: [{
            id: 'tool_question',
            session_id: 'beegame_question',
            event_id: 12,
            tool_name: 'AskUserQuestion',
            message: '游戏模式',
            created_at: '2026-06-21T00:00:04.000Z',
            input: {
              questions: [{
                header: '游戏模式',
                question: '你想做单人模式还是双人模式？',
                options: [
                  { label: '单人模式' },
                  { label: '双人模式' },
                ],
              }],
            },
          }],
        }));
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

    expect(polled.messages.some(message => message.type === 'agent_message')).toBe(false);
    expect(polled.messages.some(message => message.type === 'human_gate')).toBe(false);
    expect(reviews.items).toEqual([
      expect.objectContaining({
        gate_id: 'tool_question',
        task_id: 'beegame_question',
        type: 'INTENT_CLARIFICATION',
        gate_kind: 'beegame_permission',
        title: '游戏模式',
        status: 'awaiting_approval',
        artifact: expect.objectContaining({
          title: '游戏模式',
          content: expect.stringContaining('你想做单人模式还是双人模式？'),
        }),
        summary: expect.objectContaining({
          next_action: expect.stringContaining('你想做单人模式还是双人模式？'),
        }),
      }),
    ]);
    expect(reviews.items[0].artifact.content).toContain('单人模式');
    expect(reviews.items[0].artifact.content).toContain('双人模式');
    expect(status.approval_required).toBe(true);
    expect(status.phase).toBe('waiting_approval');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/beegame-sessions/beegame_question/events?after=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('approves BeeGame permission requests through the project scoped endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/project_permission/permissions/tool_question' && init?.method === 'POST') {
        return jsonResponse({ resolved: true });
      }
      if (path.includes('/api/beegame-sessions/') && path.includes('/permissions/')) {
        return jsonResponse({ error: 'legacy session permission endpoint should not be used' }, 500);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.approvePlan({
      project_id: 'project_permission',
      gate_id: 'tool_question',
      action: 'approve',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project_permission/permissions/tool_question',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('keeps multiple final assistant messages in the same turn instead of overwriting them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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
          assistantMessageEvent(22, 'beegame_multi', 'turn-1', '最后整理验证结果。'),
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
      '最后整理验证结果。',
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
      if (path === '/api/model-configs') {
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

  it('shows an evidence review reminder with tool evidence when a turn ends successfully', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_review',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_review/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_review',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_review/events?after=0') {
        return jsonResponse([
          bashCompletedEvent(40, 'beegame_review', 'turn-1', 'game-engine verify', 'Verified.'),
          turnCompletedEvent(41, 'beegame_review', 'turn-1'),
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

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_message',
        sender: 'system',
        task_kind: 'delivery_review',
        content: expect.stringContaining('Evidence for review.'),
      }),
      expect.objectContaining({ type: 'status', status: 'idle' }),
    ]));
    expect(polled.messages.find(message => message.task_kind === 'delivery_review')?.content)
      .toContain('game-engine verify');
    expect(polled.messages.find(message => message.task_kind === 'delivery_review')?.content)
      .toContain('Agent claims without matching evidence should be treated as unverified');
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'finished')).toBe(false);
  });

  it('shows a recoverable alert when a turn ends after a failed validation command', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_failed_check',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_failed_check/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_failed_check',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_failed_check/events?after=0') {
        return jsonResponse([
          bashFailedEvent(
            40,
            'beegame_failed_check',
            'turn-1',
            'game-engine build',
            'Exit code 1\nCould not resolve entry module "index.html".',
          ),
          turnCompletedEvent(41, 'beegame_failed_check', 'turn-1'),
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

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_message',
        sender: 'system',
        task_kind: 'last_check_failed',
        requires_user_action: true,
        next_action: 'continue_from_last_failed_check',
        content: expect.stringContaining('Last check failed'),
      }),
      expect.objectContaining({ type: 'status', status: 'idle' }),
    ]));
  });

  it('hides streaming partials and shows only the final assistant message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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

  it('maps BeeGame thinking events to redacted status messages', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_thinking',
        sessionId: 'beegame_thinking',
        workspacePath: '/tmp/beegame-projects/thinking',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_thinking/events?after=0') {
        return jsonResponse([
          thinkingEvent(30, 'beegame_thinking', 'turn-1', 'started'),
          thinkingEvent(31, 'beegame_thinking', 'turn-1', 'streaming'),
          thinkingEvent(32, 'beegame_thinking', 'turn-1', 'ended'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const polled = await beeGameAdapter.pollMessages('project_thinking', 0);

    expect(polled.messages).toHaveLength(1);
    expect(polled.messages[0]).toEqual(expect.objectContaining({
      type: 'agent_message',
      sender: 'beegame',
      content: 'Thinking',
      task_kind: 'assistant_thinking',
      message_id: 'beegame-event-31',
    }));
    expect(JSON.stringify(polled.messages)).not.toContain('private reasoning');
  });

  it('keeps assistant and tool messages in BeeGame event order', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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
    expect(polled.messages[0].content).toContain('Target: sample-game/src/main.ts');
    expect(polled.messages[0]).toEqual(expect.objectContaining({
      tool: 'Read',
      tool_status: 'running',
      tool_detail: 'Target: sample-game/src/main.ts',
      is_subagent_tool: false,
    }));
    expect(polled.messages[1].content).toContain('Status: completed');
    expect(polled.messages[1].content).toContain('Target: sample-game/src/main.ts');
    expect(polled.messages[1]).toEqual(expect.objectContaining({
      tool: 'Read',
      tool_status: 'completed',
      tool_detail: 'Target: sample-game/src/main.ts',
    }));
    expect(polled.messages[3].content).toContain('Target: sample-game/src/main.ts');
  });

  it('formats Agent tool events as subagent cards', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
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
      if (path === '/api/model-configs') {
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

  it('maps BeeGame assistant message usage into token usage messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_assistant_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_assistant_usage/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_assistant_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_assistant_usage') {
        return jsonResponse({
          id: 'beegame_assistant_usage',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_assistant_usage/events?after=0') {
        return jsonResponse([
          assistantUsageEvent(60, 'beegame_assistant_usage', 'turn-1', 100, 25),
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
        type: 'agent_message',
        content: 'Built with assistant usage.',
      }),
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
      if (path === '/api/model-configs') {
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
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          context: {
            bundle_id: 'beegame-runtime-beegame_observe',
            status: 'initialized',
            selected_skills: [
              'Context collapse',
              'History snip',
              'Token budget',
              'Monitor tool',
            ],
            token_budget: {
              status: 'tracking',
              prompt_tokens: 200,
              completion_tokens: 50,
              total_tokens: 250,
            },
          },
        }));
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
      if (path === '/api/model-configs') {
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
      if (path.startsWith('/api/projects/') && path.endsWith('/runtime-state')) {
        return jsonResponse(projectRuntimeState(path.split('/')[3], {
          phase: 'waiting_approval',
          blocked: true,
          approval_required: true,
          next_action: 'Review BeeGame permission request',
          active_agents: ['beegame'],
        }));
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
        message_id: 'beegame-permission-beegame_gate-tool_53',
        content: 'Write game files?',
        requires_user_action: true,
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
      if (path === '/api/model-configs') {
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
        return jsonResponse({ deleted: true, deletedArtifactPaths: ['/tmp/beegame-projects/sample-game'] });
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
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete_missing',
          cwd: '/tmp/beegame-projects/sample-level-game',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_delete_missing/input' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_delete_missing',
          cwd: '/tmp/beegame-projects/sample-level-game',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (
        path === '/api/beegame-sessions/beegame_delete_missing?deleteArtifacts=1&workspacePath=%2Ftmp%2Fbeegame-projects%2Fsample-level-game' &&
        init?.method === 'DELETE'
      ) {
        return jsonResponse({
          error: "ENOENT: no such file or directory, lstat '/tmp/beegame-projects/sample-level-game'",
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
        projectFolderName: 'sample-level-game',
      },
    } as any);

    await expect(beeGameAdapter.deleteProject(result.project.id)).resolves.toEqual({ ok: true });
    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
  });

  it('deletes stale local project records when their old workspace is outside the current default workspace', async () => {
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      {
        id: 'project_legacy_path',
        name: 'Legacy Path',
        root_path: '/app/Projects/legacy-path',
        created_at: 1710000000000,
        updated_at: 1710000000000,
      },
    ]));
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_legacy_path',
        sessionId: 'beegame_legacy_path',
        workspacePath: '/app/Projects/legacy-path',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (
        path === '/api/beegame-sessions/beegame_legacy_path?deleteArtifacts=1&workspacePath=%2Fapp%2FProjects%2Flegacy-path' &&
        init?.method === 'DELETE'
      ) {
        return jsonResponse({
          error: 'Workspace path must stay inside the default Projects directory: /srv/beegame/projects',
        }, 400);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.deleteProject('project_legacy_path')).resolves.toEqual({ ok: true });

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
    expect(localStorage.getItem('beegame-adapter-bindings')).toBe('[]');
  });

  it('lists only docs markdown files plus an on-demand project package artifact', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_docs',
        sessionId: 'beegame_docs',
        workspacePath: '/tmp/beegame-projects/sample-game',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/beegame-sessions/beegame_docs/events?after=0') {
        return jsonResponse([
          writeFileEvent(1, 'beegame_docs', 'docs/GDD.md'),
          writeFileEvent(2, 'beegame_docs', 'docs/TECH_SPEC.md'),
          writeFileEvent(3, 'beegame_docs', 'src/main.ts'),
          writeFileEvent(4, 'beegame_docs', 'package.json'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = await beeGameAdapter.getArtifacts('project_docs');

    expect(artifacts.map(artifact => artifact.path).filter(Boolean)).toEqual([
      'docs/GDD.md',
      'docs/TECH_SPEC.md',
    ]);
    expect(artifacts.map(artifact => artifact.name)).toContain('sample-game.zip');
    expect(artifacts.find(artifact => artifact.package_download)).toEqual(expect.objectContaining({
      artifact_type: 'Project Package',
    }));
  });

  it('lists docs markdown artifacts when tool events use absolute workspace paths', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_absolute_docs',
        sessionId: 'beegame_absolute_docs',
        workspacePath: '/tmp/beegame-projects/absolute-docs',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/beegame-sessions/beegame_absolute_docs/events?after=0') {
        return jsonResponse([
          writeFileEvent(1, 'beegame_absolute_docs', '/tmp/beegame-projects/absolute-docs/docs/GDD.md'),
          writeFileEvent(2, 'beegame_absolute_docs', '/tmp/beegame-projects/absolute-docs/src/main.ts'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = await beeGameAdapter.getArtifacts('project_absolute_docs');

    expect(artifacts.map(artifact => artifact.path).filter(Boolean)).toEqual(['docs/GDD.md']);
  });

  it('lists discovered docs but hides internal transcripts from deliverables', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_restored_docs',
        sessionId: 'beegame_restored_docs',
        workspacePath: '/tmp/beegame-projects/restored-docs',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/beegame-sessions/beegame_restored_docs/events?after=0') {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (url === '/api/beegame-sessions/beegame_restored_docs/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Frestored-docs') {
        return jsonResponse([]);
      }
      if (url === '/api/beegame-sessions/beegame_restored_docs/artifact-index?workspacePath=%2Ftmp%2Fbeegame-projects%2Frestored-docs') {
        return jsonResponse([
          {
            path: 'docs/GDD.md',
            name: 'GDD.md',
            artifact_type: 'Document',
            created_at: '2026-06-30T00:00:00.000Z',
          },
          {
            path: 'transcripts/restored-docs__12345678.jsonl',
            name: 'restored-docs__12345678.jsonl',
            artifact_type: 'Transcript',
            created_at: '2026-06-30T00:00:01.000Z',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = await beeGameAdapter.getArtifacts('project_restored_docs');

    expect(artifacts.map(artifact => artifact.path).filter(Boolean)).toEqual([
      'docs/GDD.md',
    ]);
    expect(artifacts.map(artifact => artifact.name)).toContain('restored-docs.zip');
    expect(artifacts.map(artifact => artifact.name)).not.toContain('restored-docs__12345678.jsonl');
  });

  it('downloads the project package through the bound BeeGame session', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_zip',
        sessionId: 'beegame_zip',
        workspacePath: '/tmp/beegame-projects/zip-game',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/beegame-sessions/beegame_zip/package?workspacePath=%2Ftmp%2Fbeegame-projects%2Fzip-game') {
        return new Response('PK zip', {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="zip-game.zip"',
          },
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.downloadProjectPackage('project_zip');

    expect(result.filename).toBe('zip-game.zip');
    await expect(readBlobText(result.blob)).resolves.toBe('PK zip');
  });

  it('recovers the BeeGame session and retries when package download returns not found', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_zip_retry',
        sessionId: 'beegame_zip_retry',
        workspacePath: '/tmp/beegame-projects/zip-retry',
      },
    ]));
    let packageAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_zip_retry/package?workspacePath=%2Ftmp%2Fbeegame-projects%2Fzip-retry') {
        packageAttempts += 1;
        if (packageAttempts === 1) {
          return jsonResponse({ error: 'Session not found' }, 404);
        }
        return new Response('PK retry zip', {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="zip-retry.zip"',
          },
        });
      }
      if (path === '/api/projects/project_zip_retry/session/ensure' && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          'project_zip_retry',
          'beegame_zip_retry',
          '/tmp/beegame-projects/zip-retry',
        ));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.downloadProjectPackage('project_zip_retry');

    expect(result.filename).toBe('zip-retry.zip');
    await expect(readBlobText(result.blob)).resolves.toBe('PK retry zip');
    expect(packageAttempts).toBe(2);
  });

  it('manages preview and deployment through project scoped endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/project_runtime/preview' && init?.method === 'POST') {
        return jsonResponse({
          sessionId: 'beegame_runtime',
          status: 'running',
          url: 'http://127.0.0.1:63220/',
        });
      }
      if (path === '/api/projects/project_runtime/preview/restart' && init?.method === 'POST') {
        return jsonResponse({
          sessionId: 'beegame_runtime',
          status: 'running',
          url: 'http://127.0.0.1:63221/',
        });
      }
      if (path === '/api/projects/project_runtime/preview' && init?.method === 'DELETE') {
        return jsonResponse({
          sessionId: 'beegame_runtime',
          status: 'stopped',
          url: '',
        });
      }
      if (path === '/api/projects/project_runtime/deployments' && init?.method === 'POST') {
        return jsonResponse({
          id: 'deploy_project',
          sessionId: 'beegame_runtime',
          workspacePath: '/tmp/beegame-projects/runtime',
          status: 'succeeded',
          url: '/deployments/deploy_project/',
          buildCommand: 'npm run build',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
          deployedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/projects/project_runtime/deployments' && !init?.method) {
        return jsonResponse([]);
      }
      if (path === '/api/projects/project_runtime/deployments/deploy_project/rollback' && init?.method === 'POST') {
        return jsonResponse({
          id: 'deploy_rollback',
          sessionId: 'beegame_runtime',
          workspacePath: '/tmp/beegame-projects/runtime',
          status: 'succeeded',
          url: '/deployments/deploy_rollback/',
          buildCommand: 'rollback',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
          deployedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === '/api/projects/project_runtime/assets' && !init?.method) {
        return jsonResponse({
          version: 1,
          slots: [{ id: 'title_logo', name: 'Title logo' }],
        });
      }
      if (path === '/api/projects/project_runtime/assets/title_logo/upload' && init?.method === 'POST') {
        return jsonResponse({
          path: 'public/assets/title-logo.png',
          slot: { id: 'title_logo' },
          manifest: { version: 1, slots: [{ id: 'title_logo' }] },
        });
      }
      if (path.includes('/api/beegame-sessions/') && (path.includes('/preview') || path.includes('/deployments') || path.includes('/assets'))) {
        return jsonResponse({ error: 'legacy session runtime endpoint should not be used' }, 500);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await beeGameAdapter.startProjectPreview('project_runtime');
    const restarted = await beeGameAdapter.restartProjectPreview('project_runtime');
    const stopped = await beeGameAdapter.stopProjectPreview('project_runtime');
    const deployments = await beeGameAdapter.listProjectDeployments('project_runtime');
    const deployment = await beeGameAdapter.deployProject('project_runtime');
    const rollback = await beeGameAdapter.rollbackProjectDeployment('project_runtime', 'deploy_project');
    const assets = await beeGameAdapter.getProjectAssets('project_runtime');
    const upload = await beeGameAdapter.uploadProjectAsset(
      'project_runtime',
      'title_logo',
      new File(['logo-bytes'], 'title-logo.png', { type: 'image/png' }),
    );

    expect(preview.url).toBe('http://127.0.0.1:63220/');
    expect(restarted.url).toBe('http://127.0.0.1:63221/');
    expect(stopped.status).toBe('stopped');
    expect(deployments).toEqual([]);
    expect(deployment.url).toBe('/deployments/deploy_project/');
    expect(rollback.url).toBe('/deployments/deploy_rollback/');
    expect(assets.slots[0]?.id).toBe('title_logo');
    expect(upload.path).toBe('public/assets/title-logo.png');
  });

  it('falls back to transcript when event polling sees a missing BeeGame session', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_poll_retry',
        sessionId: 'beegame_poll_retry',
        workspacePath: '/tmp/beegame-projects/poll-retry',
      },
    ]));
    let eventsAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/beegame-sessions/beegame_poll_retry/events?after=0') {
        eventsAttempts += 1;
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_poll_retry/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fpoll-retry') {
        return jsonResponse([
          turnStartedEvent(1, 'beegame_poll_retry', 'turn-1'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.pollMessages('project_poll_retry', 0);

    expect(result.lastEventId).toBe(1);
    expect(eventsAttempts).toBe(1);
    expect(fetchMock.mock.calls.some(([path, init]) => (
      String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    ))).toBe(false);
  });

  it('does not keep polling missing sessions after read-only status falls back to transcript', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_status_cache',
        sessionId: 'beegame_status_cache',
        workspacePath: '/tmp/beegame-projects/status-cache',
      },
    ]));
    let eventsAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_status_cache/runtime-state') {
        return jsonResponse(projectRuntimeState('project_status_cache', {
          phase: 'idle',
          active_agents: [],
        }));
      }
      if (path === '/api/beegame-sessions/beegame_status_cache/events?after=0') {
        eventsAttempts += 1;
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      if (path === '/api/beegame-sessions/beegame_status_cache/transcript?workspacePath=%2Ftmp%2Fbeegame-projects%2Fstatus-cache') {
        return jsonResponse([
          turnStartedEvent(1, 'beegame_status_cache', 'turn-1'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.getProjectStatus('project_status_cache');
    await beeGameAdapter.getProjectStatus('project_status_cache');

    expect(eventsAttempts).toBe(0);
  });

  it('uses persisted runtime snapshot for model phase and token usage when the live session is gone', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_snapshot',
        sessionId: 'beegame_snapshot',
        workspacePath: '/tmp/beegame-projects/snapshot-game',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_snapshot/runtime-state') {
        return jsonResponse(projectRuntimeState('project_snapshot', {
          phase: 'implementation',
          model_config_id: 'llm_current',
          context: {
            phase: 'implementation',
            token_budget: {
              status: 'tracking',
              prompt_tokens: 120,
              completion_tokens: 30,
              total_tokens: 150,
            },
          },
        }));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await beeGameAdapter.getProjectStatus('project_snapshot');
    const phases = await beeGameAdapter.getWorkflowPhases('project_snapshot') as { phase_name: string };
    const usage = await beeGameAdapter.getTokenUsage('project_snapshot');

    expect(status.model_config_id).toBe('llm_current');
    expect(status.context).toEqual(expect.objectContaining({
      token_budget: {
        status: 'tracking',
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
    }));
    expect(phases.phase_name).toBe('implementation');
    expect(usage).toEqual({
      status: 'tracking',
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });
  });

  it('prefers transcript assistant usage over stale zero runtime snapshot', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([
      {
        projectId: 'project_assistant_usage_snapshot',
        sessionId: 'beegame_assistant_usage_snapshot',
        workspacePath: '/tmp/beegame-projects/assistant-usage-snapshot',
      },
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_assistant_usage_snapshot/runtime-state') {
        return jsonResponse(projectRuntimeState('project_assistant_usage_snapshot', {
          context: {
            token_budget: {
              status: 'tracking',
              prompt_tokens: 100,
              completion_tokens: 25,
              total_tokens: 125,
            },
          },
        }));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const usage = await beeGameAdapter.getTokenUsage('project_assistant_usage_snapshot');

    expect(usage).toEqual({
      status: 'tracking',
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function projectRuntimeState(
  projectId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    project_id: projectId,
    phase: 'idle',
    blocked: false,
    blocked_reason: null,
    active_agents: [],
    updated_at: '2026-06-21T00:00:00.000Z',
    approval_required: false,
    next_action: 'Ready for next request',
    context: null,
    build_report: null,
    review_status: null,
    model_config_id: null,
    ...overrides,
  };
}

function projectEnsureResponse(
  projectId: string,
  sessionId: string,
  workspacePath: string,
  sessionOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    session: {
      id: sessionId,
      cwd: workspacePath,
      status: 'running',
      turnStatus: 'idle',
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:01.000Z',
      ...sessionOverrides,
    },
    binding: {
      projectId,
      sessionId,
      workspacePath,
    },
  };
}

function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
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

function thinkingEvent(id: number, sessionId: string, turnId: string, status: 'started' | 'streaming' | 'ended') {
  return {
    id,
    sessionId,
    turnId,
    type: 'assistant.thinking',
    text: 'Thinking',
    payload: {
      type: 'assistant.thinking',
      status,
    },
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

function sessionStoppedEvent(id: number, sessionId: string, turnId: string) {
  return {
    id,
    sessionId,
    turnId,
    type: 'session.stopped',
    text: 'BeeGame session stopped',
    payload: { type: 'session.stopped' },
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
        : { file_path: '/tmp/beegame-projects/sample-game/src/main.ts' },
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

function assistantUsageEvent(id: number, sessionId: string, turnId: string, inputTokens: number, outputTokens: number) {
  return {
    id,
    sessionId,
    turnId,
    type: 'assistant.message',
    text: 'Built with assistant usage.',
    payload: {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Built with assistant usage.' }],
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
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
    text: 'Turn ended',
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
      input: { file_path: 'sample-game/src/main.ts' },
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
        : { file_path: '/tmp/beegame-projects/sample-game/src/main.ts' },
      output: text,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}

function writeFileEvent(id: number, sessionId: string, filePath: string) {
  return {
    id,
    sessionId,
    turnId: 'turn-1',
    type: 'tool.completed',
    text: `Write completed: ${filePath}`,
    payload: {
      type: 'tool.completed',
      toolUseID: `tool_write_${id}`,
      toolName: 'Write',
      input: { file_path: filePath },
      output: `Created ${filePath}`,
    },
    createdAt: `2026-06-21T00:00:${String(id).padStart(2, '0')}.000Z`,
  };
}
