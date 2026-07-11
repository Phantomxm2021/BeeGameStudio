import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createResourceUploadTask,
  listResourceUploadTasks,
  removeResourceUploadTask,
  saveResourceUploadTask,
} from './resourceUploadQueue'

describe('resource upload queue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a file-backed task recoverable when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const task = createResourceUploadTask('pack-recovery', new File(['asset'], 'tree.glb'), {
      category: 'models',
      folderPath: 'models/environment',
    })
    await saveResourceUploadTask({ ...task, status: 'uploading' })

    await expect(listResourceUploadTasks('pack-recovery')).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        file: expect.objectContaining({ name: 'tree.glb' }),
        status: 'queued',
        destination: { category: 'models', folderPath: 'models/environment' },
      }),
    ])

    await removeResourceUploadTask(task.id)
    await expect(listResourceUploadTasks('pack-recovery')).resolves.toEqual([])
  })
})
