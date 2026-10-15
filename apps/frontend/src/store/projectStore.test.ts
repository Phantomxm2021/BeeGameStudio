import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

const {
  getPendingToolPermissions,
  getProjectStatus,
  getProjectRuntimeState,
  getProjects,
  getProjectPage,
  getProjectMetadata,
  openProject,
  bootstrapProjectFromBrief,
  deleteProjectRequest,
  chatActions,
  updateTokenUsage,
} = vi.hoisted(() => ({
  getPendingToolPermissions: vi.fn(),
  getProjectStatus: vi.fn(),
  getProjectRuntimeState: vi.fn(),
  getProjects: vi.fn(),
  getProjectPage: vi.fn(),
  getProjectMetadata: vi.fn(),
  openProject: vi.fn(),
  bootstrapProjectFromBrief: vi.fn(),
  deleteProjectRequest: vi.fn(),
  chatActions: {
    clearMessages: vi.fn(),
    addMessage: vi.fn(),
  },
  updateTokenUsage: vi.fn(),
}))

vi.mock('../services/api', async () => {
  const actual =
    await vi.importActual<typeof import('../services/api')>('../services/api')
  return {
    ...actual,
    api: {
      getPendingToolPermissions,
      getProjectStatus,
      getProjectRuntimeState,
      getProjects,
      getProjectPage,
      getProjectMetadata,
      openProject,
      bootstrapProjectFromBrief,
      deleteProject: deleteProjectRequest,
    },
  }
})

vi.mock('./chatStore', () => ({
  useChatStore: {
    getState: () => chatActions,
  },
}))

vi.mock('./systemStore', () => ({
  useSystemStore: {
    getState: () => ({ updateTokenUsage }),
  },
}))

import { useProjectStore } from './projectStore'

describe('projectStore pending review normalization', () => {
  let storageData: Map<string, string>

  beforeEach(() => {
    localStorage.clear()
    getPendingToolPermissions.mockReset()
    getProjectStatus.mockReset()
    getProjectRuntimeState.mockReset()
    getProjects.mockReset()
    getProjectPage.mockReset()
    getProjectMetadata.mockReset()
    getProjectPage.mockResolvedValue({ items: [], hasMore: false })
    getProjectMetadata.mockImplementation(async (id: string) => ({ id, name: id, created_at: 1 }))
    getProjectRuntimeState.mockImplementation(async (projectId: string) => ({
      status: await getProjectStatus(projectId),
      pendingPermissions: (await getPendingToolPermissions(projectId)).items || [],
    }))
    openProject.mockReset()
    openProject.mockResolvedValue({})
    bootstrapProjectFromBrief.mockReset()
    deleteProjectRequest.mockReset()
    deleteProjectRequest.mockResolvedValue({ ok: true })
    chatActions.clearMessages.mockReset()
    chatActions.addMessage.mockReset()
    updateTokenUsage.mockReset()
    storageData = new Map<string, string>()
    useProjectStore.persist.setOptions({
      storage: createJSONStorage(() => ({
        getItem: (name: string) => storageData.get(name) ?? null,
        setItem: (name: string, value: string) => {
          storageData.set(name, value)
        },
        removeItem: (name: string) => {
          storageData.delete(name)
        },
      })),
    })
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      isLoading: false,
      hasLoadedProjects: false,
      projectsHasMore: false,
      projectsTotal: null,
      pagedProjectIds: [],
      isLoadingMoreProjects: false,
      isOpeningProject: false,
      pendingPermissions: [],
      projectStatus: null,
      showToastError: null,
      showToastSuccess: null,
    })
    useProjectStore.persist.clearStorage()
  })

  it('does not inject a duplicate user message after the server has persisted the bootstrap idea', async () => {
    const project = { id: 'new-project', name: 'Game', created_at: 1 }
    bootstrapProjectFromBrief.mockResolvedValue({ project, task_id: 'task-1', status: 'started' })
    getProjects.mockResolvedValue([project])
    getPendingToolPermissions.mockResolvedValue({ items: [] })
    await useProjectStore.getState().bootstrapProjectFromBrief({
      idea: '做一个超级马里奥游戏', option: { title: 'Platformer' }, settings: { platform: 'web' },
    } as Parameters<ReturnType<typeof useProjectStore.getState>['bootstrapProjectFromBrief']>[0])
    expect(chatActions.clearMessages).toHaveBeenCalledOnce()
    expect(chatActions.addMessage.mock.calls.filter(([message]) => message.sender === 'user')).toHaveLength(0)
  })

  it('bulk deletes unique IDs without navigating or toasting for unrelated projects', async () => {
    const projects = ['one', 'two', 'keep'].map(id => ({ id, name: id, created_at: 1 }))
    const toast = vi.fn()
    useProjectStore.setState({ projects, pagedProjectIds: ['one', 'two', 'keep'], projectsTotal: 100, activeProjectId: 'keep', showToastSuccess: toast })
    window.history.replaceState({}, '', '/?project=keep&editor=ui')
    const navigate = vi.spyOn(window.history, 'replaceState')
    try {
      expect(await useProjectStore.getState().deleteProjects(['one', 'one', 'two'])).toEqual({ deletedIds: ['one', 'two'], failedIds: [] })
      expect(deleteProjectRequest.mock.calls).toEqual([['one'], ['two']])
      expect(useProjectStore.getState().projects.map(project => project.id)).toEqual(['keep'])
      expect(useProjectStore.getState().pagedProjectIds).toEqual(['keep'])
      expect(useProjectStore.getState().projectsTotal).toBe(98)
      expect(useProjectStore.getState().activeProjectId).toBe('keep')
      expect(navigate).not.toHaveBeenCalled()
      expect(chatActions.clearMessages).not.toHaveBeenCalled()
      expect(toast).not.toHaveBeenCalled()
    } finally { navigate.mockRestore() }
  })

  it('retains remotely failed projects and decrements the total only for successes', async () => {
    const projects = ['one', 'two'].map(id => ({ id, name: id, created_at: 1 }))
    useProjectStore.setState({ projects, pagedProjectIds: ['one', 'two'], projectsTotal: 2, activeProjectId: 'two' })
    deleteProjectRequest.mockImplementation(async (id: string) => { if (id === 'two') throw new Error('Denied') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await useProjectStore.getState().deleteProjects(['one', 'two'])).toEqual({ deletedIds: ['one'], failedIds: ['two'] })
      expect(useProjectStore.getState().projects.map(project => project.id)).toEqual(['two'])
      expect(useProjectStore.getState().projectsTotal).toBe(1)
      expect(useProjectStore.getState().activeProjectId).toBe('two')
      expect(useProjectStore.getState().isLoading).toBe(false)
      expect(chatActions.clearMessages).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it('updates the active route once after the whole batch, never to another selected project', async () => {
    const projects = ['one', 'two', 'keep'].map(id => ({ id, name: id, created_at: 1 }))
    useProjectStore.setState({ projects, projectsTotal: 3, activeProjectId: 'one' })
    window.history.replaceState({}, '', '/?project=one')
    const navigate = vi.spyOn(window.history, 'replaceState')
    deleteProjectRequest.mockImplementation(async () => {
      expect(useProjectStore.getState().activeProjectId).toBe('one')
      expect(navigate).not.toHaveBeenCalled()
    })
    try {
      await useProjectStore.getState().deleteProjects(['one', 'two'])
      expect(useProjectStore.getState().activeProjectId).toBe('keep')
      expect(navigate).toHaveBeenCalledOnce()
      expect(new URL(window.location.href).searchParams.get('project')).toBe('keep')
      expect(chatActions.clearMessages).toHaveBeenCalledOnce()
    } finally { navigate.mockRestore() }
  })

  it('clears the last active project after deletion and makes an empty batch a no-op', async () => {
    useProjectStore.setState({ projects: [{ id: 'one', name: 'One', created_at: 1 }], activeProjectId: 'one', projectsTotal: 1 })
    window.history.replaceState({}, '', '/?project=one')
    await useProjectStore.getState().deleteProjects(['one'])
    expect(useProjectStore.getState().activeProjectId).toBeNull()
    expect(useProjectStore.getState().projectsTotal).toBe(0)
    expect(new URL(window.location.href).searchParams.has('project')).toBe(false)
    expect(chatActions.clearMessages).toHaveBeenCalledOnce()
    deleteProjectRequest.mockClear()
    expect(await useProjectStore.getState().deleteProjects([])).toEqual({ deletedIds: [], failedIds: [] })
    expect(deleteProjectRequest).not.toHaveBeenCalled()
  })

  it('does not use the last active project as browser navigation state', () => {
    useProjectStore.setState({ activeProjectId: 'project_from_other_account' })

    expect(JSON.parse(storageData.get('project-storage') || '{}')).toEqual({
      state: {},
      version: 0,
    })
  })

  it('restores a project only when the URL explicitly selects it', async () => {
    getProjectPage.mockResolvedValue({ items: [
      { id: 'proj_1', name: 'One', created_at: 1 },
      { id: 'proj_2', name: 'Two', created_at: 2 },
    ], hasMore: false })
    useProjectStore.setState({ activeProjectId: 'proj_1' })

    window.history.replaceState({}, '', '/')
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBeNull()

    window.history.replaceState({}, '', '/?project=proj_2&editor=scene')
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBe('proj_2')
  })

  it('loads project history by page and restores a deep-linked project outside the first page', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${index}`,
      created_at: 100 - index,
    }))
    const secondPage = Array.from({ length: 20 }, (_, index) => ({
      id: `project-${index + 20}`,
      name: `Project ${index + 20}`,
      created_at: 80 - index,
    }))
    getProjectPage.mockResolvedValueOnce({ items: firstPage, hasMore: true, total: 100 })
      .mockResolvedValueOnce({ items: secondPage, hasMore: false, total: 100 })
    getProjectMetadata.mockResolvedValue({ id: 'project-90', name: 'Old Project', created_at: 10 })
    window.history.replaceState({}, '', '/?project=project-90')

    await useProjectStore.getState().loadProjects()

    expect(getProjectPage).toHaveBeenCalledWith(0)
    expect(getProjectMetadata).toHaveBeenCalledWith('project-90')
    expect(useProjectStore.getState().projects).toHaveLength(21)
    expect(useProjectStore.getState().activeProjectId).toBe('project-90')
    expect(useProjectStore.getState().pagedProjectIds).toHaveLength(20)
    expect(useProjectStore.getState().projectsTotal).toBe(100)

    await useProjectStore.getState().loadMoreProjects()

    expect(getProjectPage).toHaveBeenCalledWith(20)
    expect(useProjectStore.getState().projects).toHaveLength(41)
    expect(useProjectStore.getState().projectsHasMore).toBe(false)
  })

  it('tracks project opening while switching projects', async () => {
    let resolveOpen: (value: unknown) => void = () => undefined
    openProject.mockReturnValue(
      new Promise(resolve => {
        resolveOpen = resolve
      }),
    )
    useProjectStore.setState({ activeProjectId: 'proj_old' })

    const promise = useProjectStore.getState().setActiveProject('proj_new')
    await vi.waitFor(() =>
      expect(useProjectStore.getState().isOpeningProject).toBe(true),
    )

    expect(openProject).toHaveBeenCalledWith('proj_new')
    expect(useProjectStore.getState().activeProjectId).toBe('proj_old')

    resolveOpen({})
    await promise

    expect(useProjectStore.getState().isOpeningProject).toBe(false)
    expect(useProjectStore.getState().activeProjectId).toBe('proj_new')
    expect(useProjectStore.getState().projectStatus).toBeNull()
    expect(useProjectStore.getState().pendingPermissions).toEqual([])
    expect(chatActions.clearMessages).toHaveBeenCalled()
  })

  it('times out project opening and releases the opening lock', async () => {
    vi.useFakeTimers()
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    try {
      openProject.mockReturnValue(new Promise(() => undefined))
      useProjectStore.setState({ activeProjectId: 'proj_old' })

      const promise = useProjectStore
        .getState()
        .setActiveProject('proj_timeout')
      const rejection = promise.catch(error => error)
      expect(useProjectStore.getState().isOpeningProject).toBe(true)

      await vi.advanceTimersByTimeAsync(10_000)

      const error = await rejection
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Project open timed out')
      expect(useProjectStore.getState().isOpeningProject).toBe(false)
      expect(useProjectStore.getState().activeProjectId).toBe('proj_old')
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps current status and shows a toast when project status loading fails', async () => {
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const showToastError = vi.fn()
    useProjectStore.setState({
      showToastError,
      projectStatus: {
        project_id: 'proj_1',
        phase: 'running',
        blocked: false,
        next_action: 'running',
      },
    })
    getProjectStatus.mockRejectedValue(new Error('database unavailable'))

    await useProjectStore.getState().loadProjectStatus('proj_1')

    expect(useProjectStore.getState().projectStatus?.next_action).toBe(
      'running',
    )
    expect(showToastError).toHaveBeenCalledWith(
      expect.stringContaining('后端状态不可用'),
    )
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to load project status for project proj_1:',
      expect.any(Error),
    )
    errorLog.mockRestore()
  })

  it('updates project status and pending reviews from one runtime snapshot', async () => {
    getProjectRuntimeState.mockResolvedValueOnce({
      status: {
        project_id: 'proj_1',
        phase: 'running',
        blocked: false,
        context: {
          token_budget: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
          },
        },
      },
      pendingPermissions: [{ gate_id: 'permission_1' }],
    })

    await useProjectStore.getState().loadProjectRuntimeState('proj_1')

    expect(getProjectRuntimeState).toHaveBeenCalledTimes(1)
    expect(getProjectRuntimeState).toHaveBeenCalledWith('proj_1')
    expect(useProjectStore.getState().projectStatus?.phase).toBe('running')
    expect(useProjectStore.getState().pendingPermissions).toEqual([
      { gate_id: 'permission_1' },
    ])
    expect(updateTokenUsage).toHaveBeenCalledWith(
      {
        cached_input_tokens: 0,
        completion_tokens: 30,
        input_tokens: 120,
        output_tokens: 30,
        prompt_tokens: 120,
        total_tokens: 150,
      },
      'proj_1',
    )
  })

  it('coalesces concurrent runtime snapshot loads for the same project', async () => {
    let resolveRequest!: (value: {
      status: { project_id: string; phase: string; blocked: boolean }
      pendingPermissions: Array<{ gate_id: string }>
    }) => void
    getProjectRuntimeState.mockReturnValueOnce(
      new Promise(resolve => {
        resolveRequest = resolve
      }),
    )

    const first = useProjectStore.getState().loadProjectRuntimeState('proj_1')
    const second = useProjectStore.getState().loadProjectRuntimeState('proj_1')
    expect(getProjectRuntimeState).toHaveBeenCalledTimes(1)

    resolveRequest({
      status: { project_id: 'proj_1', phase: 'running', blocked: false },
      pendingPermissions: [{ gate_id: 'permission_1' }],
    })
    await Promise.all([first, second])

    expect(useProjectStore.getState().projectStatus?.phase).toBe('running')
    expect(useProjectStore.getState().pendingPermissions).toEqual([
      { gate_id: 'permission_1' },
    ])
  })

  it('does not flood the console when authentication context is temporarily unavailable', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    getProjectRuntimeState.mockRejectedValueOnce(
      Object.assign(
        new Error('Authentication service is temporarily unavailable'),
        {
          status: 503,
          code: 'authentication_unavailable',
          recoverable: true,
          retryAfterMs: 2_000,
        },
      ),
    )

    await expect(
      useProjectStore.getState().loadProjectRuntimeState('proj_1'),
    ).rejects.toMatchObject({ code: 'authentication_unavailable' })

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('does not let a stale runtime response overwrite the newly active project', async () => {
    let resolveRequest!: (value: {
      status: { project_id: string; phase: string; blocked: boolean }
      pendingPermissions: Array<{ gate_id: string }>
    }) => void
    useProjectStore.setState({ activeProjectId: 'proj_1' })
    getProjectRuntimeState.mockReturnValueOnce(
      new Promise(resolve => {
        resolveRequest = resolve
      }),
    )

    const request = useProjectStore.getState().loadProjectRuntimeState('proj_1')
    useProjectStore.setState({
      activeProjectId: 'proj_2',
      projectStatus: null,
      pendingPermissions: [],
    })
    resolveRequest({
      status: { project_id: 'proj_1', phase: 'running', blocked: false },
      pendingPermissions: [{ gate_id: 'stale_permission' }],
    })
    await request

    expect(useProjectStore.getState().projectStatus).toBeNull()
    expect(useProjectStore.getState().pendingPermissions).toEqual([])
  })

  it('stores canonical pending tool permissions', async () => {
    getPendingToolPermissions.mockResolvedValue({
      items: [
        {
          gate_id: 'gate_1',
          type: 'BEEGAME_PERMISSION',
          task_id: 'session_1',
          title: 'Write permission',
          permission_tool_name: 'Write',
          summary: {
            block_reason: 'Write game files?',
            next_action: 'Allow or deny the tool call.',
          },
        },
      ],
    })

    await useProjectStore.getState().loadPendingPermissions('proj_1')

    expect(useProjectStore.getState().pendingPermissions).toEqual([{
      gate_id: 'gate_1',
      type: 'BEEGAME_PERMISSION',
      task_id: 'session_1',
      title: 'Write permission',
      permission_tool_name: 'Write',
      summary: {
        block_reason: 'Write game files?',
        next_action: 'Allow or deny the tool call.',
      },
    }])
  })

  it('stores only the canonical project runtime status fields', async () => {
    getProjectStatus.mockResolvedValue({
      project_id: 'proj_1',
      phase: 'IMPLEMENTATION',
      blocked: false,
      next_action: 'Continue implementation',
      build_report: {
        status: ' passed ',
        entrypoint: ' dist/web/index.html ',
        generated_paths: [' dist/web/index.html '],
      },
    })
    await useProjectStore.getState().loadProjectStatus('proj_1')

    expect(useProjectStore.getState().projectStatus).toMatchObject({
      project_id: 'proj_1',
      phase: 'IMPLEMENTATION',
      blocked: false,
      next_action: 'Continue implementation',
      build_report: {
        status: 'passed',
        entrypoint: 'dist/web/index.html',
        generated_paths: ['dist/web/index.html'],
      },
    })
  })

  it('removes and restores pending reviews by gate id', () => {
    useProjectStore.setState({
      pendingPermissions: [
        { gate_id: 'gate_1', artifact_id: 'art_1' },
        { gate_id: 'gate_2', artifact_id: 'art_2' },
      ],
    })

    useProjectStore.getState().removePendingPermission('gate_1')

    expect(useProjectStore.getState().pendingPermissions).toEqual([
      expect.objectContaining({ gate_id: 'gate_2' }),
    ])

    useProjectStore
      .getState()
      .upsertPendingPermission({ gate_id: 'gate_1', artifact_id: 'art_1' })

    expect(useProjectStore.getState().pendingPermissions).toEqual([
      expect.objectContaining({ gate_id: 'gate_1' }),
      expect.objectContaining({ gate_id: 'gate_2' }),
    ])
  })
})
