import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beeGameAdapter,
  getBeeGameWorkspaceSettings,
  setBeeGameWorkspaceRoot,
} from './beeGameAdapter';
import { clearSupabaseSession, hydrateSupabaseSessionUser } from './supabaseAuthApi';

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

const makeLlmOptions = (first: Record<string, unknown> = makeLlmOption()) => [
  first,
  makeLlmOption({ id: 'mode_from_llm_2', title: 'Mode From LLM 2' }),
  makeLlmOption({ id: 'mode_from_llm_3', title: 'Mode From LLM 3' }),
];

const createCompletedIntakeJobFetch = (result: Record<string, unknown>) => vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/beegame-intake/jobs' && init?.method === 'POST') {
      return jsonResponse({ jobId: 'intake_job_test', status: 'running' }, 202);
    }
    if (path === '/api/beegame-intake/jobs/intake_job_test') {
      return jsonResponse({ status: 'completed', result });
    }
    return jsonResponse({ error: 'not found' }, 404);
  },
);

const bootstrapResponse = (
  init: RequestInit | undefined,
  options: { sessionId: string; workspacePath: string },
) => {
  const request = JSON.parse(String(init?.body || '{}')) as {
    project?: Record<string, unknown>;
  };
  const project = {
    ...request.project,
    root_path: options.workspacePath,
    runtime_snapshot: { phase_name: 'starting', status: 'running' },
  };
  return jsonResponse({
    project,
    session: {
      id: options.sessionId,
      cwd: options.workspacePath,
      status: 'running',
      turnStatus: 'running',
    },
    binding: {
      projectId: project.id,
      sessionId: options.sessionId,
      workspacePath: options.workspacePath,
    },
    task_id: options.sessionId,
    status: 'starting',
  }, 202);
};

const seedBoundProject = (sessionId: string, workspacePath: string) => {
  const now = 1710000000000;
  const project = {
    id: `project_${sessionId}`,
    name: 'Adapter transport test',
    root_path: workspacePath,
    created_at: now,
    updated_at: now,
  };
  localStorage.setItem('beegame-adapter-projects', JSON.stringify([project]));
  localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
    projectId: project.id,
    sessionId,
    workspacePath,
    language: 'en',
  }]));
  const upstream = globalThis.fetch.bind(globalThis);
  const projectRoot = `/api/projects/${encodeURIComponent(project.id)}`;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === `${projectRoot}/stop`) {
      return upstream(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/stop`, init);
    }
    if (path === `${projectRoot}/package`) {
      return upstream(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/package?workspacePath=${encodeURIComponent(workspacePath)}`, init);
    }
    if (path.startsWith(`${projectRoot}/events`)) {
      const query = new URLSearchParams(path.split('?')[1] || '');
      const response = await upstream(
        `/api/beegame-sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(query.get('after') || '0')}`,
        init,
      );
      if (!response.ok) return response;
      return jsonResponse({
        sessionId,
        workspacePath,
        events: await response.json(),
        recoveredFromTranscript: false,
      });
    }
    if (path.startsWith(`${projectRoot}/transcript`)) {
      const query = new URLSearchParams(path.split('?')[1] || '');
      const base = `/api/beegame-sessions/${encodeURIComponent(sessionId)}/transcript?workspacePath=${encodeURIComponent(workspacePath)}`;
      const paged = `${base}&limit=${encodeURIComponent(query.get('limit') || '300')}${query.get('before') ? `&before=${encodeURIComponent(query.get('before')!)}` : ''}`;
      let response = await upstream(paged, init);
      if (response.status === 404) response = await upstream(base, init);
      if (!response.ok) return response;
      const payload = await response.json();
      const page = Array.isArray(payload)
        ? { events: payload, page: { hasMore: false, nextBeforeId: null } }
        : payload;
      return jsonResponse({ sessionId, workspacePath, ...page });
    }
    if (path === `${projectRoot}/artifact-index`) {
      const response = await upstream(
        `/api/beegame-sessions/${encodeURIComponent(sessionId)}/artifact-index?workspacePath=${encodeURIComponent(workspacePath)}`,
        init,
      );
      if (!response.ok) return response;
      return jsonResponse({ sessionId, workspacePath, artifacts: await response.json() });
    }
    return upstream(input, init);
  });
  return { project };
};

describe('beeGameAdapter prompt rules', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '0');
    clearSupabaseSession();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  it('stops the current project without resolving a browser session binding', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/projects/project_local/stop' && init?.method === 'POST') {
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
      '/api/projects/project_local/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('continues a recoverable workflow through the project resume endpoint once', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.resumeWorkflow('project recovery');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project%20recovery/workflow/resume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not migrate browser-local project metadata into the canonical project repository', async () => {
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

    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('does not fall back to browser-local project storage when the project API is unavailable', async () => {
    localStorage.setItem('beegame-adapter-projects', JSON.stringify([
      { id: 'project_local', name: 'Local Only', created_at: 1700000000000 },
    ]));
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjects()).rejects.toThrow('not found');
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

  it('preserves recoverable authentication outage metadata from fetch routes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      code: 'authentication_unavailable',
      message: 'Authentication service is temporarily unavailable',
      recoverable: true,
      retry_after_ms: 2_000,
    }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.getProjectRuntimeState('project_1')).rejects.toMatchObject({
      status: 503,
      code: 'authentication_unavailable',
      recoverable: true,
      retryAfterMs: 2_000,
    });
  });

  it('does not create a second browser-owned cloud project cache', async () => {
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
    expect(localStorage.getItem('beegame-adapter-projects:user_cloud')).toBeNull();
  });

  it('does not synthesize local game mode options when LLM intake fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({ error: 'not found' }, 404)
        : jsonResponse({ error: 'intake unavailable' }, 500)
    )
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.generateIntakeOptions({ idea: 'idea requiring LLM' }))
      .rejects.toThrow('not found');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/beegame-intake/options', expect.anything());
  });

  it('uses backend error message text when intake returns a structured failure', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/beegame-intake/jobs'
        ? jsonResponse({
          error: 'Insufficient credits',
          message: 'Credit 不足。本次方案生成需要预扣 3 credits，你当前有 0 credits。',
        }, 402)
        : jsonResponse({ error: 'not found' }, 404)
    )
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
            needsClarification: false,
            detectedConstraints: ['Async constraint'],
            recommendedNextStep: 'choose_direction',
            options: makeLlmOptions(llmOption),
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

  it('keeps polling the same intake job when authentication is temporarily unavailable', async () => {
    vi.useFakeTimers();
    try {
      let pollAttempts = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/beegame-intake/jobs' && init?.method === 'POST') {
          return jsonResponse({ jobId: 'intake_job_recoverable', status: 'running' }, 202);
        }
        if (path === '/api/beegame-intake/jobs/intake_job_recoverable') {
          pollAttempts += 1;
          if (pollAttempts === 1) {
            return jsonResponse({
              error: 'Authentication unavailable',
              message: 'Authentication service is temporarily unavailable',
            }, 503);
          }
          return jsonResponse({
            status: 'completed',
            result: {
              maturity: 'directional',
              needsClarification: false,
              detectedConstraints: [],
              recommendedNextStep: 'choose_direction',
              options: makeLlmOptions(),
            },
          });
        }
        return jsonResponse({ error: 'unexpected request' }, 500);
      });
      vi.stubGlobal('fetch', fetchMock);

      const intakePromise = beeGameAdapter.runIdeaIntake({ idea: 'LLM generated idea' });
      await vi.advanceTimersByTimeAsync(1500);
      await expect(intakePromise).resolves.toEqual(expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'mode_from_llm' }),
        ]),
      }));

      expect(fetchMock.mock.calls.filter(([input, init]) =>
            String(input) === '/api/beegame-intake/jobs' && init?.method === 'POST'
      )).toHaveLength(1);
      expect(pollAttempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps intake model behavior out of the browser request', async () => {
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
            needsClarification: false,
            detectedConstraints: [],
            recommendedNextStep: 'choose_direction',
            options: makeLlmOptions(llmOption),
          },
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.runIdeaIntake({
      idea: 'LLM generated idea',
      language: 'zh',
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as {
      idea?: string;
      language?: string;
      clientRequestId?: string;
    };
    expect(requestBody).toEqual({
      idea: 'LLM generated idea',
      language: 'zh',
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
    const fetchMock = createCompletedIntakeJobFetch({
      maturity: 'directional',
      needsClarification: false,
      detectedConstraints: ['LLM constraint'],
      recommendedNextStep: 'choose_direction',
      options: makeLlmOptions(llmOption),
    });
    vi.stubGlobal('fetch', fetchMock);

    const intake = await beeGameAdapter.runIdeaIntake({ idea: 'LLM generated idea' });

    expect(intake).toMatchObject({
      maturity: 'directional',
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
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { idea?: string; language?: string; clientRequestId?: string };
    expect(requestBody).toEqual({ idea: 'LLM generated idea', language: 'zh', clientRequestId: expect.any(String) });
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
    const fetchMock = createCompletedIntakeJobFetch({
      maturity: 'directional',
      needsClarification: false,
      detectedConstraints: [],
      recommendedNextStep: 'choose_direction',
      options: makeLlmOptions(llmOption),
    });
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
    const fetchMock = createCompletedIntakeJobFetch({
      maturity: 'directional',
      needsClarification: false,
      detectedConstraints: [],
      recommendedNextStep: 'choose_direction',
      options: makeLlmOptions(llmOption),
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.runIdeaIntake({ idea: 'Créer un jeu exemple', language: 'fr-FR' });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { idea?: string; language?: string; clientRequestId?: string };
    expect(requestBody).toEqual({ idea: 'Créer un jeu exemple', language: 'fr', clientRequestId: expect.any(String) });
  });

  it('uses the explicit UI language instead of inferring language from idea text', async () => {
    localStorage.setItem('i18nextLng', 'ja');
    const fetchMock = createCompletedIntakeJobFetch({
      maturity: 'directional',
      needsClarification: false,
      detectedConstraints: [],
      recommendedNextStep: 'choose_direction',
      options: makeLlmOptions(makeLlmOption()),
    });
    vi.stubGlobal('fetch', fetchMock);

    await beeGameAdapter.runIdeaIntake({ idea: '制作一个中文游戏' });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as { language?: string };
    expect(requestBody.language).toBe('ja');
  });

  it('rejects structured clarification responses without intake options', async () => {
    const fetchMock = createCompletedIntakeJobFetch({
      maturity: 'vague',
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
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(beeGameAdapter.runIdeaIntake({ idea: 'idea requiring clarification' })).rejects.toThrow(
      'BeeGame intake must return exactly 3 game mode options; received 0',
    );
  });

  it('creates new sessions in a project-specific workspace under the default Projects directory', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_scoped',
          workspacePath: '/tmp/beegame-projects/llm-project',
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

    const startCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/bootstrap' && init?.method === 'POST'
    )
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { projectName?: string };

    expect(startBody.projectName).toBe('llm-project');
    expect(result.project.root_path).toBe('/tmp/beegame-projects/llm-project');
    expect(result.project.name).toBe('LLM Project');
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/model-configs')).toBe(false);
  });

  it('uses the configured workspace root for new projects without replacing it with a project path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_custom_root',
          workspacePath: '/tmp/custom-beegame-projects/arena-prototype',
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

    const settings = await getBeeGameWorkspaceSettings();

    expect(result.project.root_path).toBe('/tmp/custom-beegame-projects/arena-prototype');
    expect(settings.workspacePath).toBe('/tmp/custom-beegame-projects');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/filesystem/default-workspace', expect.anything());
  });

  it('sends a confirmed attachment GDD as the direct build source', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_gdd',
          workspacePath: '/tmp/beegame-projects/confirmed-gdd',
        });
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

    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/bootstrap' && init?.method === 'POST'
    )
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { brief?: Record<string, unknown> };
    expect(body.brief).toMatchObject({
      confirmedGdd: '# Rules\n- Solve the puzzle to win.',
      buildSource: 'gdd',
      analysisId: 'analysis_direct_build',
    });
    expect(JSON.stringify(body)).not.toContain('Save it as docs/GDD.md first');
    expect(JSON.stringify(body)).not.toContain('Do not regenerate a game plan');
  });

  it('keeps the confirmed project title for display and uses the LLM folder name for files', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_safe_path',
          workspacePath: '/tmp/beegame-projects/movement-aim-trainer',
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

    const startCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/bootstrap' && init?.method === 'POST'
    )
    const startBody = JSON.parse(String(startCall?.[1]?.body || '{}')) as { projectName?: string };
    expect(startBody.projectName).toBe('movement-aim-trainer');
    expect(result.project.name).toBe('移动与瞄准训练');
  });

  it('delegates project session recovery to the backend ensure endpoint', async () => {
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

    const { project: legacyProject } = seedBoundProject('beegame_legacy', '/tmp/beegame-projects');
    await beeGameAdapter.sendMessage({
      project_id: legacyProject.id,
      content: '修复蛇会自动增长的问题',
    });

    const ensureCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path).endsWith('/session/ensure') && init?.method === 'POST'
    )
    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/beegame-sessions/beegame_migrated/input' && init?.method === 'POST'
    )
    expect(ensureCall).toBeTruthy();
    expect(inputCall).toBeTruthy();
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

    const { project } = seedBoundProject('beegame_restart', '/tmp/beegame-projects/sample-web-game');
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
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    )).toBe(false);
  });

  it('loads compact chat history from newest to oldest with a stable cursor', async () => {
    const workspacePath = '/tmp/beegame-projects/paged-game';
    const pageRequest = `/api/beegame-sessions/beegame_paged/transcript?workspacePath=${encodeURIComponent(workspacePath)}&limit=300`;
    const olderRequest = `${pageRequest}&before=501`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === pageRequest) {
        return jsonResponse({
          events: [{
            id: 501,
            sessionId: 'beegame_paged',
            turnId: 'turn-new',
            type: 'assistant.message',
            text: 'Newest page.',
            createdAt: '2026-06-21T00:00:02.000Z',
          }],
          page: { hasMore: true, nextBeforeId: 501 },
        });
      }
      if (path === olderRequest) {
        return jsonResponse({
          events: [{
            id: 201,
            sessionId: 'beegame_paged',
            turnId: 'turn-old',
            type: 'assistant.message',
            text: 'Older page.',
            createdAt: '2026-06-20T00:00:02.000Z',
          }],
          page: { hasMore: false, nextBeforeId: 201 },
        });
      }
      if (path === '/api/beegame-sessions/beegame_paged/events?after=501') {
        return jsonResponse([{
          id: 502,
          sessionId: 'beegame_paged',
          turnId: 'turn-live',
          type: 'assistant.message',
          text: 'Live continuation.',
          createdAt: '2026-06-21T00:00:03.000Z',
        }]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { project } = seedBoundProject('beegame_paged', workspacePath);

    const latest = (await beeGameAdapter.getChatHistory(project.id)) as Array<{ content: string }>;
    expect(beeGameAdapter.getChatHistoryPaginationState(project.id)).toEqual({
      initialized: true,
      hasMore: true,
    });
    const live = await beeGameAdapter.pollMessages(project.id, 0);
    const older = await beeGameAdapter.getOlderChatHistory(project.id);
    const exhausted = await beeGameAdapter.getOlderChatHistory(project.id);

    expect(latest.map(message => message.content)).toEqual(['Newest page.']);
    expect(live.lastEventId).toBe(502);
    expect(live.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Live continuation.' }),
    ]));
    expect((older.messages as Array<{ content: string }>).map(message => message.content)).toEqual(['Older page.']);
    expect(older.hasMore).toBe(false);
    expect(beeGameAdapter.getChatHistoryPaginationState(project.id)).toEqual({
      initialized: true,
      hasMore: false,
    });
    expect(exhausted).toEqual({ messages: [], hasMore: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('loads cloud project history through the project-scoped transcript endpoint', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_cloud/transcript?limit=300') {
        return jsonResponse({
          sessionId: 'beegame_cloud_restore',
          workspacePath: '/tmp/beegame-projects/users/user-cloud/cloud-game',
          events: [{
            id: 1,
            sessionId: 'beegame_cloud_restore',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Cloud transcript restored.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          }],
          page: { hasMore: false, nextBeforeId: null },
        });
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
    expect(localStorage.getItem('beegame-adapter-bindings:user_cloud')).toBeNull();
  });

  it('loads a cookie-authenticated project transcript without a browser-readable token', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    const workspacePath = '/tmp/beegame-projects/users/cookie-user/cookie-game';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/auth/session') {
        return jsonResponse({
          authenticated: true,
          expires_at: Date.now() + 3_600_000,
          user: { id: 'cookie-user' },
        });
      }
      if (path === '/api/projects/project_cookie/transcript?limit=300') {
        return jsonResponse({
          sessionId: 'beegame_cookie_restore',
          workspacePath,
          events: [{
            id: 1,
            sessionId: 'beegame_cookie_restore',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Cookie transcript restored.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          }],
          page: { hasMore: false, nextBeforeId: null },
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await hydrateSupabaseSessionUser();
    const history = await beeGameAdapter.getChatHistory('project_cookie');

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'beegame',
        content: 'Cookie transcript restored.',
      }),
    ]));
    expect(localStorage.getItem('beegame_supabase_session')).toBeNull();
    expect(localStorage.getItem('beegame-adapter-bindings:cookie-user')).toBeNull();
  });

  it('uses the server-owned project transcript workspace instead of browser metadata', async () => {
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
      if (path === '/api/projects/project_cloud_migrated/transcript?limit=300') {
        return jsonResponse({
          sessionId: 'beegame_cloud_migrated',
          workspacePath: '/tmp/beegame-projects/users/user-cloud/project_cloud_migrated',
          events: [{
            id: 1,
            sessionId: 'beegame_cloud_migrated',
            turnId: 'turn-1',
            type: 'assistant.message',
            text: 'Migrated project transcript restored.',
            payload: { type: 'assistant.message' },
            createdAt: '2026-06-21T00:00:02.000Z',
          }],
          page: { hasMore: false, nextBeforeId: null },
        });
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
    expect(localStorage.getItem('beegame-adapter-bindings:user_cloud')).toBeNull();
  });

  it('does not infer session identity from a project id or browser-local project record', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
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

    expect(history).toEqual([]);
    expect(JSON.parse(localStorage.getItem('beegame-adapter-bindings') || '[]')).toEqual([]);
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

    const { project } = seedBoundProject('beegame_refresh', '/tmp/beegame-projects/refresh-game');
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

    const { project } = seedBoundProject('beegame_restart', '/tmp/beegame-projects/sample-web-game');
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
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    )).toBe(false);
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

    const { project } = seedBoundProject('beegame_restart', '/tmp/beegame-projects/sample-web-game');
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
    expect(polled.messages.some(message =>
          message.type === 'status' && String(message.content || '').includes('Backend restarted')
    )).toBe(false);
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

    const { project } = seedBoundProject('beegame_stopped', '/tmp/beegame-projects/sample-web-game');
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

    const { project } = seedBoundProject('beegame_preview', '/tmp/beegame-projects/preview-game');
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
          model_config_id: 'model_default',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await beeGameAdapter.getProjectStatus('project_runtime_state');
    expect(status.phase).toBe('running');
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/runtime-snapshot'))).toBe(false);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/events?after='))).toBe(false);
  });

  it('coalesces concurrent runtime-state consumers for the same project', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const statusPromise = beeGameAdapter.getProjectStatus('project_shared_runtime');
    const reviewsPromise = beeGameAdapter.getPendingToolPermissions('project_shared_runtime');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    resolveResponse(jsonResponse({
      project_id: 'project_shared_runtime',
      phase: 'running',
      pending_permissions: [],
    }));
    await expect(statusPromise).resolves.toMatchObject({ project_id: 'project_shared_runtime' });
    await expect(reviewsPromise).resolves.toEqual({ items: [] });
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
    });

    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/beegame-sessions/beegame_new/input' && init?.method === 'POST'
    )
    const ensureCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/project_backend_ensure/session/ensure' && init?.method === 'POST'
    )
    const ensureBody = JSON.parse(String(ensureCall?.[1]?.body || '{}')) as { language?: string };
    expect(ensureBody.language).toBeTruthy();
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string; thinkingMode?: string };
    expect(body.text).toBe('继续任务');
    expect(body.thinkingMode).toBeUndefined();
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    )).toBe(false);
  });

  it('ensures a stopped BeeGame session in the backend before sending a new chat message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/projects' && !init?.method) return jsonResponse([]);
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

    const { project } = seedBoundProject('beegame_stopped', '/tmp/beegame-projects/sample-web-game');
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_stopped',
      workspacePath: '/tmp/beegame-projects/sample-web-game',
    }]));

    await beeGameAdapter.sendMessage({
      project_id: project.id,
      content: 'Continue fixing the game.',
    });

    const ensureCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path).endsWith('/session/ensure') && init?.method === 'POST'
    )
    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/beegame-sessions/beegame_stopped/input' && init?.method === 'POST'
    )
    const inputBody = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { text?: string };
    expect(ensureCall).toBeTruthy();
    expect(inputBody.text).toBe('Continue fixing the game.');
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    )).toBe(false);
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
      if (path === '/api/beegame-sessions/beegame_paused/continue' && init?.method === 'POST') {
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

    const { project } = seedBoundProject('beegame_paused', '/tmp/beegame-projects/mode-from-llm');
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_paused',
      workspacePath: '/tmp/beegame-projects/mode-from-llm',
    }]));

    await beeGameAdapter.continueTask({ project_id: project.id });

    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/beegame-sessions/beegame_paused/continue' && init?.method === 'POST'
    )
    expect(inputCall).toBeTruthy();
    const body = JSON.parse(String(inputCall?.[1]?.body || '{}')) as { language?: string };
    expect(body.language).toBe('zh');
  });

  it('keeps an existing session bound to its configured model before continuing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith('/api/projects/') && path.endsWith('/session/ensure') && init?.method === 'POST') {
        return jsonResponse(projectEnsureResponse(
          path.split('/')[3],
          'beegame_model_old',
          '/tmp/beegame-projects/model-sync-game',
          { modelConfigId: 'llm_old' },
        ));
      }
      if (path === '/api/beegame-sessions/beegame_model_old/continue' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_model_old',
          cwd: '/tmp/beegame-projects/model-sync-game',
          modelConfigId: 'llm_old',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:03.000Z',
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { project } = seedBoundProject('beegame_model_old', '/tmp/beegame-projects/model-sync-game');
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_model_old',
      workspacePath: '/tmp/beegame-projects/model-sync-game',
    }]));

    await beeGameAdapter.continueTask({ project_id: project.id });

    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/model-configs')).toBe(false);
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions/beegame_model_old/model' &&
      init?.method === 'PATCH'
    )).toBe(false);
  });

  it('starts a BeeGame session with structured confirmed product input only', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_brief',
          workspacePath: '/tmp/beegame-projects/mode-from-llm',
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

    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/bootstrap' && init?.method === 'POST'
    )
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as {
      brief?: Record<string, any>;
      language?: string;
    };

    const brief = body.brief || {};
    expect(brief.idea).toBe('LLM generated idea');
    expect(brief.settings).toEqual(expect.objectContaining({
      platform: 'Web',
      inputs: ['Keyboard/mouse', 'Touch'],
    }));
    expect(JSON.stringify(body)).not.toContain('delivery contract');
    expect(JSON.stringify(body)).not.toContain('验收');
    expect(JSON.stringify(body)).not.toContain('subagents');
    expect(JSON.stringify(body)).not.toContain('apps/frontend');
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

    const { project } = seedBoundProject('beegame_display', '/tmp/beegame-projects/display-game');
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: project.id,
      sessionId: 'beegame_display',
      workspacePath: '/tmp/beegame-projects/display-game',
    }]));

    const history = (await beeGameAdapter.getChatHistory(project.id)) as Array<{ sender: string; content: string }>;

    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        content: '用户输入的完整游戏想法',
      }),
    ]));
    expect(history.map(message => message.content).join('\n')).not.toContain('请使用中文与用户沟通');
    expect(history.map(message => message.content).join('\n')).not.toContain('我要做一个完整游戏项目');
  });

  it('sends confirmed build input as structured product data without browser-owned agent policy', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/bootstrap' && init?.method === 'POST') {
        return bootstrapResponse(init, {
          sessionId: 'beegame_english_brief',
          workspacePath: '/tmp/beegame-projects/snake-game',
        });
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

    const inputCall = fetchMock.mock.calls.find(([path, init]) =>
        String(path) === '/api/projects/bootstrap' && init?.method === 'POST'
    )
    const body = JSON.parse(String(inputCall?.[1]?.body ?? '{}')) as { brief?: Record<string, unknown> };
    const brief = body.brief || {};
    expect(brief.idea).toBe('Build a sample game');
    expect(brief.settings).toEqual(expect.objectContaining({ platform: 'Web', dimension: '2D' }));
    expect(JSON.stringify(body)).not.toContain('executable player-path checks');
    expect(JSON.stringify(body)).not.toContain('delivery contract');
    expect(JSON.stringify(body)).not.toContain('Do not count log-only scripts');
  });

  it('sends follow-up messages without repeating session policy blocks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/projects' && !init?.method) return jsonResponse([]);
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
      if ((path === '/api/beegame-sessions/beegame_followup/idea' || path === '/api/beegame-sessions/beegame_followup/input') && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_followup', '/tmp/beegame-projects/followup');
    await beeGameAdapter.sendMessage({
      project_id: result.project.id,
      content: '开始游戏后蛇没有吃食物也会变长，请修复。',
    });

    const inputBodies = fetchMock.mock.calls
      .filter(([path, init]) =>
          String(path) === '/api/beegame-sessions/beegame_followup/input' &&
        init?.method === 'POST'
      )
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as { text?: string });
    const followUp = inputBodies[0]?.text || '';

    expect(followUp).toBe('开始游戏后蛇没有吃食物也会变长，请修复。');
    expect(followUp).not.toContain('Branding rule:');
    expect(followUp).not.toContain('Workspace rule:');
    expect(followUp).not.toContain('Response language:');
  });

  it('keeps repeated tool calls as distinct chat messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects' && !init?.method) return jsonResponse([]);
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
      if (path === '/api/beegame-sessions/beegame_tools/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_tools', '/tmp/beegame-projects');
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

  it('does not create a separate clarification protocol for permission events', async () => {
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
      if (path === '/api/beegame-sessions/beegame_question/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_question', '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);
    const reviews = await beeGameAdapter.getPendingToolPermissions(result.project.id);
    const status = await beeGameAdapter.getProjectStatus(result.project.id);

    expect(polled.messages.some(message => message.type === 'agent_message')).toBe(false);
    expect(polled.messages.some(message => message.type === 'human_gate')).toBe(true);
    expect(reviews.items).toEqual([
      expect.objectContaining({
        gate_id: 'tool_question',
        task_id: 'beegame_question',
        type: 'BEEGAME_PERMISSION',
        title: 'AskUserQuestion permission',
        permission_tool_name: 'AskUserQuestion',
        artifact: expect.objectContaining({
          content: '游戏模式',
        }),
      }),
    ]);
    expect(status.phase).toBe('waiting_approval');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/beegame-sessions/beegame_question/events?after=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('resolves BeeGame permission requests through the project scoped endpoint', async () => {
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

    await expect(beeGameAdapter.resolveToolPermission({
      project_id: 'project_permission',
      gate_id: 'tool_question',
      decision: 'allow',
      scope: 'once',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project_permission/permissions/tool_question',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'allow', remember: false, scope: 'once' }),
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
      if (path === '/api/beegame-sessions/beegame_multi/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_multi', '/tmp/beegame-projects');
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

  it('coalesces historical assistant blocks that share an upstream message id', async () => {
    const sessionId = 'beegame_coalesced';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: sessionId,
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
        });
      }
      if (path === `/api/beegame-sessions/${sessionId}/idea` && init?.method === 'POST') {
        return jsonResponse({
          id: sessionId,
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === `/api/beegame-sessions/${sessionId}`) {
        return jsonResponse({
          id: sessionId,
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === `/api/beegame-sessions/${sessionId}/events?after=0`) {
        return jsonResponse([
          assistantLogicalMessageEvent(30, sessionId, 'turn-1', 'logical-1', 'First', 'First second.'),
          assistantLogicalMessageEvent(31, sessionId, 'turn-1', 'logical-1', ' second.', ' second.'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = seedBoundProject(sessionId, '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    const assistantMessages = polled.messages.filter(message => message.type === 'agent_message');
    expect(assistantMessages).toEqual([
      expect.objectContaining({
        content: 'First second.',
        message_id: `beegame-assistant-${sessionId}-logical-1`,
      }),
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
      if (path === '/api/beegame-sessions/beegame_idle/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_idle', '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    const status = polled.messages.find(message => message.type === 'status');
    expect(status).toEqual(expect.objectContaining({ status: 'idle' }));
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'finished')).toBe(false);
  });

  it('shows an empty native turn as an incomplete system message while keeping the session resumable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/model-configs') {
        return jsonResponse([{ id: 'model_default', isDefault: true }]);
      }
      if (path === '/api/beegame-sessions' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_empty_turn',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'idle',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_empty_turn/idea' && init?.method === 'POST') {
        return jsonResponse({
          id: 'beegame_empty_turn',
          cwd: '/tmp/beegame-projects',
          status: 'running',
          turnStatus: 'running',
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:01.000Z',
        });
      }
      if (path === '/api/beegame-sessions/beegame_empty_turn/events?after=0') {
        return jsonResponse([{
          id: 30,
          sessionId: 'beegame_empty_turn',
          turnId: 'turn-1',
          type: 'turn.empty',
          text: 'Claude Code 已结束本轮，但没有返回最终答复。当前任务可能尚未完成，请在同一会话中继续。',
          payload: { type: 'turn.empty', reason: 'missing_native_final_result' },
          createdAt: '2026-06-21T00:00:02.000Z',
        }]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = seedBoundProject('beegame_empty_turn', '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_message',
        content: expect.stringContaining('没有返回最终答复'),
      }),
      expect.objectContaining({ type: 'status', status: 'idle' }),
    ]));
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'finished')).toBe(false);
  });

  it('does not synthesize delivery evidence from ordinary tool activity', async () => {
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
      if (path === '/api/beegame-sessions/beegame_review/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_review', '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_end', tool: 'Bash' }),
      expect.objectContaining({ type: 'status', status: 'idle' }),
    ]));
    expect(polled.messages.some(message => message.task_kind === 'delivery_review')).toBe(false);
    expect(polled.messages.some(message => message.type === 'status' && message.status === 'finished')).toBe(false);
  });

  it('does not classify failed commands through command-name heuristics', async () => {
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
      if (path === '/api/beegame-sessions/beegame_failed_check/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_failed_check', '/tmp/beegame-projects');
    const polled = await beeGameAdapter.pollMessages(result.project.id, 0);

    expect(polled.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_end', tool: 'Bash', tool_status: 'failed' }),
      expect.objectContaining({ type: 'status', status: 'idle' }),
    ]));
    expect(polled.messages.some(message => message.task_kind === 'last_check_failed')).toBe(false);
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
      if (path === '/api/beegame-sessions/beegame_stream/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_stream', '/tmp/beegame-projects');
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

  it('maps BeeGame thinking events to one redacted start/end lifecycle', async () => {
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

    const { project } = seedBoundProject('beegame_thinking', '/tmp/beegame-projects/thinking');
    const polled = await beeGameAdapter.pollMessages(project.id, 0);

    expect(polled.messages).toHaveLength(2);
    expect(polled.messages[0]).toEqual(expect.objectContaining({
      type: 'think_start',
      sender: 'beegame',
      content: 'Thinking',
      task_kind: 'assistant_thinking',
      message_id: 'beegame-thinking-turn-1',
    }));
    expect(polled.messages[1]).toEqual(expect.objectContaining({
      type: 'think_end',
      sender: 'beegame',
      message_id: 'beegame-thinking-turn-1',
    }));
    expect(JSON.stringify(polled.messages)).not.toContain('private reasoning');
  });

  it('drops runtime output that arrives after its turn has ended', async () => {
    localStorage.setItem('beegame-adapter-bindings', JSON.stringify([{
      projectId: 'project_late_thinking',
      sessionId: 'beegame_late_thinking',
      workspacePath: '/tmp/beegame-projects/late-thinking',
    }]));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/beegame-sessions/beegame_late_thinking/events?after=0') {
        return jsonResponse([
          { id: 40, sessionId: 'beegame_late_thinking', turnId: 'turn-closed', type: 'turn.failed', text: 'Interrupted', createdAt: '2026-06-21T00:00:00.000Z' },
          thinkingEvent(41, 'beegame_late_thinking', 'turn-closed', 'started'),
          thinkingEvent(42, 'beegame_late_thinking', 'turn-closed', 'streaming'),
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    }));

    const polled = await beeGameAdapter.pollMessages('project_late_thinking', 0);
    expect(polled.messages.some(message => message.task_kind === 'assistant_thinking')).toBe(false);
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
      if (path === '/api/beegame-sessions/beegame_order/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_order', '/tmp/beegame-projects');
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
    expect(polled.messages[3].artifact_path).toBe('sample-game/src/main.ts');
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
      if (path === '/api/beegame-sessions/beegame_subagent/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_subagent', '/tmp/beegame-projects');
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
      if (path === '/api/beegame-sessions/beegame_usage/idea' && init?.method === 'POST') {
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
          {
            ...resultEvent(60, 'beegame_usage', 'turn-1', 100, 25),
            text: '',
          },
        ]);
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = seedBoundProject('beegame_usage', '/tmp/beegame-projects');
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
      if (path === '/api/beegame-sessions/beegame_assistant_usage/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_assistant_usage', '/tmp/beegame-projects');
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
      if (path === '/api/beegame-sessions/beegame_observe/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_observe', '/tmp/beegame-projects');
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
      if (path === '/api/beegame-sessions/beegame_gate/idea' && init?.method === 'POST') {
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
          next_action: 'Review BeeGame permission request',
          active_agents: ['beegame'],
        }));
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = seedBoundProject('beegame_gate', '/tmp/beegame-projects');
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
  });

  it('delegates project and runtime cleanup to the project-scoped delete endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects' && !init?.method) return jsonResponse([]);
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
      if (path === '/api/beegame-sessions/beegame_delete/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject('beegame_delete', '/tmp/beegame-projects');

    await beeGameAdapter.deleteProject(result.project.id);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${encodeURIComponent(result.project.id)}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock.mock.calls.some(([path]) => String(path).startsWith('/api/beegame-sessions/'))).toBe(false);
    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
  });

  it('treats an already-missing BeeGame session workspace as deleted locally', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects' && !init?.method) return jsonResponse([]);
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
      if (path === '/api/beegame-sessions/beegame_delete_missing/idea' && init?.method === 'POST') {
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

    const result = seedBoundProject(
      'beegame_delete_missing',
      '/tmp/beegame-projects/sample-level-game',
    );

    await expect(beeGameAdapter.deleteProject(result.project.id)).resolves.toEqual({ ok: true });
    await expect(beeGameAdapter.getProjects()).resolves.toEqual([]);
  });

  it('lists only docs markdown files plus an on-demand project package artifact', async () => {
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

    const { project } = seedBoundProject('beegame_docs', '/tmp/beegame-projects/sample-game');
    const artifacts = await beeGameAdapter.getArtifacts(project.id);

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

    const { project } = seedBoundProject('beegame_absolute_docs', '/tmp/beegame-projects/absolute-docs');
    const artifacts = await beeGameAdapter.getArtifacts(project.id);

    expect(artifacts.map(artifact => artifact.path).filter(Boolean)).toEqual(['docs/GDD.md']);
  });

  it('lists discovered docs but hides internal transcripts from deliverables', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/beegame-sessions/beegame_restored_docs/events?after=0') {
        return jsonResponse([]);
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

    const { project } = seedBoundProject('beegame_restored_docs', '/tmp/beegame-projects/restored-docs');
    const artifacts = await beeGameAdapter.getArtifacts(project.id);

    expect(artifacts.map(artifact => artifact.path).filter(Boolean)).toEqual([
      'docs/GDD.md',
    ]);
    expect(artifacts.map(artifact => artifact.name)).toContain('restored-docs.zip');
    expect(artifacts.map(artifact => artifact.name)).not.toContain('restored-docs__12345678.jsonl');
  });

  it('downloads the project package through the project-scoped endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/projects/project_zip/package') {
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

  it('does not create a runtime session when a read-only package download fails', async () => {
    let packageAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/project_zip_retry/package') {
        packageAttempts += 1;
        return jsonResponse({ error: 'Session not found' }, 404);
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

    await expect(beeGameAdapter.downloadProjectPackage('project_zip_retry'))
      .rejects.toThrow('Session not found');
    expect(packageAttempts).toBe(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project_zip_retry/session/ensure',
      expect.anything(),
    );
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
          version: 8,
          requirements: [{ id: 'title_logo', name: 'Title logo', required: true }],
          resources: [],
          });
      }
      if (path ===
            '/api/projects/project_runtime/assets/resources/title_logo/upload' && init?.method === 'POST') {
        return jsonResponse({
          path: 'public/assets/title-logo.png',
            resource: { id: 'title_logo' },
          manifest: {
            version: 8,
            requirements: [{ id: 'title_logo', required: true }],
            resources: [],
          },
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
    expect(assets.version).toBe(8);
    expect(assets.requirements[0]?.id).toBe('title_logo');
    expect(upload.path).toBe('public/assets/title-logo.png');
  });

  it('accepts transcript recovery from the project-scoped event endpoint', async () => {
    let eventsAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects/project_poll_retry/events?after=0') {
        eventsAttempts += 1;
        return jsonResponse({
          sessionId: 'beegame_poll_retry',
          workspacePath: '/tmp/beegame-projects/poll-retry',
          events: [turnStartedEvent(1, 'beegame_poll_retry', 'turn-1')],
          recoveredFromTranscript: true,
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beeGameAdapter.pollMessages('project_poll_retry', 0);

    expect(result.lastEventId).toBe(1);
    expect(eventsAttempts).toBe(1);
    expect(fetchMock.mock.calls.some(([path, init]) =>
          String(path) === '/api/beegame-sessions' && init?.method === 'POST'
    )).toBe(false);
  });

  it('does not replay a recovered terminal failure as a live dashboard error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project_failed_history/events?after=0') {
        return jsonResponse({
          sessionId: 'beegame_failed_history',
          workspacePath: '/tmp/beegame-projects/failed-history',
          events: [{
            id: 7,
            sessionId: 'beegame_failed_history',
            turnId: 'turn-1',
            type: 'turn.failed',
            text: 'Historical runtime failure',
            createdAt: '2026-07-12T00:00:00.000Z',
          }],
          recoveredFromTranscript: true,
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }));

    const initial = await beeGameAdapter.pollMessages('project_failed_history', 0);

    expect(initial.lastEventId).toBe(7);
    expect(initial.messages).toEqual([]);
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
    expect(status.model_config_id).toBe('llm_current');
    expect(status.context).toEqual(expect.objectContaining({
      token_budget: {
        status: 'tracking',
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
    }));
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

    const status = await beeGameAdapter.getProjectStatus('project_assistant_usage_snapshot');

    expect(status.context?.token_budget).toEqual({
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
    next_action: 'Ready for next request',
    context: null,
    build_report: null,
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

function assistantLogicalMessageEvent(
  id: number,
  sessionId: string,
  turnId: string,
  messageId: string,
  payloadText: string,
  displayText: string,
) {
  return {
    id,
    sessionId,
    turnId,
    type: 'assistant.message',
    text: displayText,
    payload: {
      type: 'assistant',
      message: {
        id: messageId,
        content: [{ type: 'text', text: payloadText }],
      },
    },
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
