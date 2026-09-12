import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevProjectPurgePanel } from './DevProjectPurgePanel'
import { authenticatedFetch } from '../../../services/apiClient'
import i18n, { supportedI18nLanguages } from '../../../i18n'

vi.mock('../../../services/apiClient', () => ({ authenticatedFetch: vi.fn() }))
const request = vi.mocked(authenticatedFetch)
const plan = { projectCount: 2, projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }
beforeEach(() => { request.mockReset() })

describe('development project purge panel', () => {
  it('is hidden when the server feature is disabled', async () => {
    request.mockResolvedValue(new Response('', { status: 404 }))
    const { container } = render(<DevProjectPurgePanel lang="en" onDeleted={vi.fn()} />)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(container).toBeEmptyDOMElement()
  })
  it('requires a fresh plan and confirmation before one destructive request', async () => {
    request.mockResolvedValueOnce(Response.json(plan)).mockResolvedValueOnce(Response.json(plan))
      .mockResolvedValueOnce(Response.json({ deleted: 2, failed: 0 }))
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<DevProjectPurgePanel lang="en" onDeleted={refresh} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Development/test: delete all projects' }))
    expect(await screen.findByText(/Permanently delete this account’s 2 projects/)).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete all projects' }))
    await screen.findByText('Deleted 2 projects; 0 failed. Check the remaining list.')
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(request.mock.calls[2]![1]!.body))).toEqual({ confirmation: 'DELETE_ALL_MY_PROJECTS', projectIds: ['a', 'b'] })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('invalidates a stale plan and refreshes after the server refuses it', async () => {
    request.mockResolvedValueOnce(Response.json(plan)).mockResolvedValueOnce(Response.json(plan))
      .mockResolvedValueOnce(Response.json({ code: 'PROJECT_PURGE_LIST_CHANGED' }, { status: 409 }))
    render(<DevProjectPurgePanel lang="en" onDeleted={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Development/test: delete all projects' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete all projects' }))
    await screen.findByText('The project list changed. Review the list again before confirming.')
    expect(screen.queryByRole('button', { name: 'Permanently delete all projects' })).not.toBeInTheDocument()
  })
  it('supplies all developer controls and warnings in every supported language', () => {
    for (const lang of supportedI18nLanguages) {
      for (const key of ['button', 'confirm', 'delete', 'cancel', 'pending', 'result', 'changed', 'failed']) {
        expect(typeof i18n.getResource(lang, 'landing', 'intake.devProjectPurge.' + key)).toBe('string')
      }
    }
  })
})
